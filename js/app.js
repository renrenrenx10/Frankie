
import { CONFIG, ConfigManager, refreshConfig } from './config.js';
import { RequestManager } from './requestManager.js';
import { escapeHtml } from './utils.js';
import { initialiseUI, appendMessage, updateMessage, updateRail, updateSuggestions, setLoadStatus, getActiveMode, renderRecentPanel } from './ui.js';
import { searchKnowledgeBase, getKbStats, normaliseScore } from './retrieval.js';
import { preprocessQuery } from './preprocessing.js';
import { streamClaude, generateWithClaude } from './claude.js';
import { routeModel, modelLabel } from './modelRouter.js';
import { streamResponse, renderResponse } from './streaming.js';
import { createPipelineBar, advancePipeline, completePipeline } from './pipeline.js';
import { renderEvidencePanel } from './evidence.js';
import { applyTemplate } from './templates.js';
import { saveExchange, clearAllHistory } from './history.js';

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initialiseUI();
    bindComposer();
    renderRecentPanel();
    bootKnowledgeBase().catch(err => {
        console.error('Frankie: KB boot failed:', err);
        setLoadStatus('KB offline');
    });
});

async function bootKnowledgeBase() {
    setLoadStatus('Loading knowledge…');
    try {
        const stats = await getKbStats();
        const chunkEl  = document.getElementById('chunkCount');
        const fileEl   = document.getElementById('fileCount');
        const legacyEl = document.getElementById('legacyCount');
        if (chunkEl)  chunkEl.textContent  = stats.totalChunks.toLocaleString();
        if (fileEl)   fileEl.textContent   = stats.sourceFiles.toLocaleString();
        if (legacyEl) legacyEl.textContent = stats.legacyCount.toLocaleString();
        setLoadStatus(stats.totalChunks > 0 ? 'Knowledge ready' : 'KB offline — 0 chunks loaded');
    } catch (err) {
        console.error('Frankie: KB boot error:', err);
        ['chunkCount', 'fileCount', 'legacyCount'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '!';
        });
        setLoadStatus('KB offline');
    }
}

function bindComposer() {
    const composer = document.getElementById('composer');
    const inputEl  = document.getElementById('input');
    const sendBtn  = document.getElementById('send');

    if (!composer || !inputEl) return;

    composer.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = inputEl.value.trim();
        if (!query) return;
        inputEl.value = '';
        if (sendBtn) sendBtn.disabled = true;
        await handleQuery(query);
        if (sendBtn) sendBtn.disabled = false;
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            composer.dispatchEvent(new Event('submit'));
        }
    });
}

// ── Session memory ────────────────────────────────────────────────────────────

const conversationHistory = [];
const MAX_HISTORY = 4;

function addToHistory(role, content) {
    conversationHistory.push({ role, content });
    // Size-based trimming — keep last MAX_HISTORY * 2 entries (user+assistant pairs)
    if (conversationHistory.length > MAX_HISTORY * 2) {
        conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY * 2);
    }
}

function getHistoryForClaude() {
    // Exclude the last entry (current user message, which we pass separately)
    return conversationHistory.slice(0, -1);
}

export function clearHistory() {
    conversationHistory.length = 0;
}

export { clearAllHistory };

// getActiveMode() — now lives in ui.js

// ── Confidence thresholds ─────────────────────────────────────────────────────

const CONFIDENCE = { LOW: 0.3, MEDIUM: 0.6 };

function confidenceProfile(score, resultCount) {
    if (resultCount === 0)             return 'none';
    if (score < CONFIDENCE.LOW)        return 'low';
    if (score < CONFIDENCE.MEDIUM)     return 'medium';
    return 'high';
}

// ── Core query pipeline ───────────────────────────────────────────────────────

async function handleQuery(query) {
    // Start a new request — cancels any previous in-flight request
    const { requestId, signal } = RequestManager.start();

    window.frankieLastQuery = query;   // exposed for PlantDrawer search pre-fill
    addToHistory('user', query);
    appendMessage('user', `<p>${escapeHtml(query)}</p>`);

    const pipelineBar    = createPipelineBar();
    const botDiv         = appendMessage('assistant', '');
    const bubble         = botDiv._bubble;
    bubble.prepend(pipelineBar);

    const answerContainer = document.createElement('div');
    answerContainer.className = 'answer-body';
    bubble.appendChild(answerContainer);

    try {
        refreshConfig();

        // ── Stage 1: Preprocess (local — Groq removed, not cost-effective for this task) ──
        advancePipeline(pipelineBar, 'preprocess');
        const processed = await preprocessQuery(query);

        // Guard: abort if a newer request started
        if (!RequestManager.isActive(requestId)) return;

        // ── Stage 2: Search (parallelised) ────────────────────────────────
        advancePipeline(pipelineBar, 'search');
        const searchQueries = (processed.searchTerms || [query]).slice(0, 3);

        // Run all searches in parallel
        const searchResults = await Promise.all(
            searchQueries.map(term => searchKnowledgeBase(term, CONFIG.maxSources))
        );

        if (!RequestManager.isActive(requestId)) return;

        // Deduplicate and merge results
        const seen = new Set();
        let _chunkIdx = 0;
        let allResults = [];

        for (const sr of searchResults) {
            for (const chunk of (sr.results || [])) {
                const key = chunk.id || (chunk.text || '').slice(0, 80) || String(_chunkIdx++);
                if (!seen.has(key)) {
                    seen.add(key);
                    allResults.push(chunk);
                }
            }
        }

        allResults = allResults.sort((a, b) => b.score - a.score).slice(0, CONFIG.maxSources);

        // Normalise confidence: 0 ≤ confidence ≤ 1
        const confidence   = normaliseScore(allResults.length ? allResults[0].score : 0);
        const confProfile  = confidenceProfile(confidence, allResults.length);

        // Attach normalised score to every result
        allResults = allResults.map(r => ({
            ...r,
            normalizedScore: normaliseScore(r.score)
        }));

        const totalGated = searchResults.reduce((n, r) => n + (r.gatedHits || 0), 0);
        updateRail(allResults);

        // ── Suggested follow-up questions (from top result metadata) ──────
        const suggestions = _buildSuggestions(allResults, processed.intent);
        updateSuggestions(suggestions);

        // ── Stage 3: Route ────────────────────────────────────────────────
        // High confidence (≥ 0.6) → Haiku (cheap, KB has the answer)
        // Medium / low confidence  → Sonnet (needs more reasoning with weak context)
        advancePipeline(pipelineBar, 'route');
        const useClaude  = ConfigManager.useClaude && !!CONFIG.claudeApiKey;
        const activeMode = getActiveMode();
        const { route, model: routedModel } = routeModel(confidence, useClaude);

        if (!RequestManager.isActive(requestId)) return;

        // ── Stage 4: Generate + Render (interleaved for streaming) ────────
        advancePipeline(pipelineBar, 'generate');

        // Confidence badge — insert before answerContainer so it appears above
        if (confProfile === 'low' || confProfile === 'none') {
            const badge = document.createElement('div');
            badge.className = 'conf-badge conf-badge--low';
            badge.innerHTML = '⚠ Low confidence match — treat this as a starting point only';
            bubble.insertBefore(badge, answerContainer);
        } else if (confProfile === 'medium') {
            const badge = document.createElement('div');
            badge.className = 'conf-badge conf-badge--medium';
            badge.innerHTML = '~ Moderate match — verify key details with your SCC';
            bubble.insertBefore(badge, answerContainer);
        }

        let answerText  = null;
        let answerError = null;
        let usedClaude  = false;

        if (useClaude && (route === 'claude' || route === 'hybrid')) {
            try {
                // ── True SSE streaming: tokens appear as they arrive ──────
                advancePipeline(pipelineBar, 'render');
                answerText = await streamClaude(
                    answerContainer,
                    query, allResults, getHistoryForClaude(), activeMode, confProfile,
                    signal, requestId, routedModel
                );
                usedClaude = !!answerText;
            } catch (err) {
                answerError = err.message;
                console.warn('Frankie: Claude streaming failed, falling back to local:', err.message);
            }
        }

        if (!RequestManager.isActive(requestId)) return;

        // Show error note if Claude failed but we have a fallback
        if (answerError && useClaude) {
            const errNote = document.createElement('div');
            errNote.className = 'conf-badge conf-badge--low';
            errNote.innerHTML = `⚠ ${escapeHtml(answerError)}`;
            bubble.insertBefore(errNote, answerContainer);
        }

        // Local fallback — only reached if Claude wasn't used or failed
        if (!usedClaude) {
            answerText = buildLocalAnswer(query, allResults, processed.intent, confidence, confProfile);

            // ── Stage 5: Render (local) ───────────────────────────────────
            advancePipeline(pipelineBar, 'render');

            const templateHtml = confProfile !== 'none'
                ? applyTemplate(allResults, processed.intent, activeMode)
                : null;

            if (templateHtml) {
                if (RequestManager.isActive(requestId)) {
                    answerContainer.innerHTML = templateHtml;
                }
            } else {
                await streamResponse(answerContainer, answerText, 12, requestId);
            }
        }

        addToHistory('assistant', answerText || '');
        completePipeline(pipelineBar);

        if (!RequestManager.isActive(requestId)) return;

        // Evidence panel — same for all routes
        const evidenceHtml = renderEvidencePanel(allResults);
        if (evidenceHtml) {
            const ep = document.createElement('div');
            ep.innerHTML = evidenceHtml;
            bubble.appendChild(ep.firstElementChild);
        }

        // Model tag
        const tag = document.createElement('div');
        tag.className = 'model-tag';
        const historyDepth = conversationHistory.length - 1;
        const contextNote  = historyDepth > 0
            ? ` · ${Math.floor(historyDepth / 2)} prior exchange${historyDepth > 2 ? 's' : ''} in context`
            : '';
        const modeNote  = ` · ${activeMode} mode`;
        const confNote  = confProfile !== 'high' ? ` · ${confProfile} confidence` : '';
        const routeNote = usedClaude ? `Answered via ${modelLabel(routedModel)}` : 'Answered from local KB';
        tag.textContent = routeNote + modeNote + confNote + contextNote;
        bubble.appendChild(tag);

        // Persist exchange
        saveExchange(query, bubble.innerHTML, activeMode, confProfile);

        // Upgrade prompt (free tier gated content)
        const activeTier = ConfigManager.tier;
        if (activeTier === 'free' && totalGated > 0) {
            const upgrade = document.createElement('div');
            upgrade.className = 'upgrade-prompt';
            upgrade.innerHTML = `
                <span class="upgrade-icon">🔒</span>
                <span class="upgrade-text">${totalGated} more relevant source${totalGated > 1 ? 's' : ''} available to Members — including worked examples, SCC guidance, and reference documentation.</span>
                <button class="upgrade-btn" type="button" onclick="document.querySelector('[data-tier=member]')?.click()">Switch to Member</button>
            `;
            bubble.appendChild(upgrade);
        }

    } catch (err) {
        if (!RequestManager.isActive(requestId)) return;
        completePipeline(pipelineBar);
        answerContainer.innerHTML = `<p class="error">Something went wrong: ${escapeHtml(err.message)}</p>`;
        console.error('Frankie: pipeline error', err);
    }
}

// ── Local fallback answer builder ─────────────────────────────────────────────
// Produces a digest-style answer: intro sentence → 2-3 sentence summary → source link.
// Raw KB chunks are never dumped directly; text is trimmed to clean sentence boundaries.

function buildLocalAnswer(query, results, intent, confidence, confProfile = 'high') {
    const mode = getActiveMode();

    if (!results.length || confProfile === 'none') {
        const noResultMsg = {
            scc:      `Nothing in the F4N knowledge base matched "${query}" strongly enough to cite. Check the portal scoring criteria directly, or raise it with the programme team.`,
            osv:      `No specific OSV guidance found for "${query}". Raise this with your SCC before the visit — it's better to ask in advance than be caught out on the day.`,
            readiness:`Nothing specific found for "${query}" — this may be outside the core F4N readiness scope. Your SCC can advise whether it's relevant to your entry point.`,
            company:  `I couldn't find anything in the F4N knowledge base that directly addresses "${query}". Try rephrasing, or speak to your SCC — they'll be able to point you to the right part of the programme.`
        };
        return noResultMsg[mode] || noResultMsg.company;
    }

    const topResult = results[0];
    const rawText   = (topResult.text || '').trim();
    const source    = (topResult.source || topResult.source_file || 'the knowledge base')
                        .replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
    const section   = topResult.section || '';

    // ── Digest: trim to clean sentence boundaries (≤ 3 sentences, ≤ 280 chars) ──
    const digest = _digestSnippet(rawText, 3, 280);

    // ── Confidence caveat (appended after digest, not before raw text) ────────
    const caveat = confProfile === 'low'
        ? '\n\n*Low confidence match — verify this with your SCC before acting on it.*'
        : confProfile === 'medium'
            ? '\n\n*Moderate match — check key details with your SCC.*'
            : '';

    // ── Intro sentence: plain English framing keyed on intent + mode ──────────
    const topic = section ? `**${section}**` : `**${query}**`;

    const introMap = {
        company: {
            Procedure:  `Here's what F4N guidance covers on implementing ${topic}:`,
            Risk:       `F4N flags the following risk area relating to ${topic}:`,
            Comparison: `Here's how F4N compares options for ${topic}:`,
            Summary:    `F4N summary for ${topic}:`,
            Question:   `Based on the F4N knowledge base, here's what's relevant to ${topic}:`
        },
        scc: {
            Procedure:  `F4N process overview for ${topic} (check for scoring evidence):`,
            Risk:       `⚠ Red flag area — ${topic}:`,
            Comparison: `Scoring comparison for ${topic}:`,
            Summary:    `SCC summary — ${topic}:`,
            Question:   `From the F4N KB (SCC view) on ${topic}:`
        },
        osv: {
            Procedure:  `Checklist for ${topic} — prepare the following before your OSV:`,
            Risk:       `OSV risk area — have evidence ready for ${topic}:`,
            Comparison: `Verification comparison for ${topic}:`,
            Summary:    `OSV prep summary — ${topic}:`,
            Question:   `F4N KB guidance on ${topic} for your OSV:`
        },
        readiness: {
            Procedure:  `What implementing ${topic} involves for F4N readiness:`,
            Risk:       `Something to be aware of regarding ${topic} as you prepare:`,
            Comparison: `How options compare for ${topic} in the F4N context:`,
            Summary:    `Readiness summary — ${topic}:`,
            Question:   `F4N programme guidance on ${topic}:`
        }
    };

    const modeMap = introMap[mode] || introMap.company;
    const intro   = modeMap[intent] || modeMap.Question;

    // ── Source attribution with "Read more" hint ──────────────────────────────
    const sourceLabel = source !== 'the knowledge base'
        ? `*Source: ${source}* — expand the evidence panel below for full extracts.`
        : `*Source: F4N knowledge base* — expand the evidence panel below for full extracts.`;

    return `${intro}\n\n${digest}${caveat}\n\n${sourceLabel}`;
}

/**
 * Trim raw KB text to a clean digest:
 * - Split on sentence boundaries (. ! ?)
 * - Keep up to maxSentences sentences whose total length ≤ maxChars
 * - Never cut mid-sentence
 */
function _digestSnippet(text, maxSentences = 3, maxChars = 280) {
    if (!text) return '';

    // Split on sentence-ending punctuation followed by whitespace or end-of-string
    // Keep the delimiter attached to the preceding sentence
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];

    let digest = '';
    let count  = 0;

    for (const s of sentences) {
        const trimmed = s.trim();
        if (!trimmed) continue;
        if (count >= maxSentences) break;
        if (digest.length + trimmed.length > maxChars && count > 0) break;
        digest += (digest ? ' ' : '') + trimmed;
        count++;
    }

    return digest || text.slice(0, maxChars).trim();
}


// ── Suggested follow-up question builder ─────────────────────────────────────
// Generates 3 contextual follow-up questions from the top KB result.

function _buildSuggestions(results, intent) {
    if (!results?.length) return [];

    const top     = results[0];
    const section = top.section || '';
    const ct      = top.content_type || '';
    const qid     = top.question_id  || '';

    const pool = [];

    // Section-based follow-ups
    if (section) {
        pool.push(`What evidence is needed for ${section}?`);
        pool.push(`How is ${section} scored in F4N?`);
        pool.push(`What does a good ${section} submission look like?`);
    }

    // Content-type follow-ups
    if (ct === 'scoring_rubric' || ct === 'worked_example') {
        pool.push('What score would I get for this currently?');
        pool.push("What's the difference between a score of 7 and 10?");
    }
    if (ct === 'osv_guidance') {
        pool.push('What should I prepare before my OSV visit?');
        pool.push('What documents does the SCC typically ask for?');
    }
    if (ct === 'evidence_guide') {
        pool.push('What format should my evidence be in?');
        pool.push('How much evidence is enough?');
    }
    if (ct === 'training_content') {
        pool.push('Is there a worked example for this topic?');
        pool.push('What are the key risks in this area?');
    }

    // Question ID follow-ups
    if (qid) {
        pool.push(`Show me a worked example for ${qid}`);
        pool.push(`What does a score of 7 look like for ${qid}?`);
    }

    // Generic fallbacks
    pool.push('What are the most common gaps at OSV?');
    pool.push('What does CFSI mean for my business?');
    pool.push('How do I raise my score in this area?');

    // Return first 3 unique suggestions
    return [...new Set(pool)].slice(0, 3);
}
