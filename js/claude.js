// ── Claude integration ────────────────────────────────────────────────────────
// Generates answers using Anthropic's Claude API.
// Supports true SSE streaming via streamClaude(); non-streaming via generateWithClaude().
// Hardened: timeout (60 s), HTTP error codes, abort-safe.

import { CONFIG } from './config.js';
import { formatText } from './streaming.js';

const CLAUDE_TIMEOUT_MS = 60000;
const WORKER_URL = 'https://ch.rene-dorset.workers.dev';

// ── Mode-specific system prompts ──────────────────────────────────────────────

const SHARED_KNOWLEDGE = `
Your knowledge base includes:
- F4N programme guidance, scoring criteria, evidence requirements, and OSV preparation
- The nuclear plant hierarchy (sites, buildings, systems, components, commodities) — use this to answer questions about where specific components, equipment, or commodities are found in a nuclear plant
- Nuclear supply chain company profiles, procurement portals, and funding sources
- Business Excellence and Fit for Nuclear assessment question sets
- The NucCol member handbook covering strategy, process, people, QHSE, and supply chain

When the retrieved sources contain relevant information — including plant hierarchy data, company profiles, or handbook content — use it to give a direct, specific answer. Never deflect a question you have source data for.`;

const MODE_PROMPTS = {
    company: `You are Frankie, an F4N (Fit for Nuclear) intelligence assistant in Company Mode.
Your job is to give practical, actionable guidance to a supplier working through the F4N programme or seeking to understand the nuclear sector.
- Answer in plain, direct language a business owner or operations manager can act on.
- Focus on what the company needs to DO, not just what the criteria say.
- If evidence is required, name the specific documents or artefacts they should produce.
- If asked about nuclear plant components, systems, or commodity locations, answer directly using the plant hierarchy data in your sources.
- Cite your sources by name at the end.
- Keep answers concise — 3 to 5 short paragraphs maximum.
- You have memory of the recent conversation; use it to handle follow-up questions naturally.
${SHARED_KNOWLEDGE}`,

    scc: `You are Frankie, an F4N (Fit for Nuclear) intelligence assistant in SCC Mode.
You are supporting a Supply Chain Coordinator reviewing a supplier's submission.
- Lead with red flags, scoring gaps, and areas of concern first.
- Reference the relevant score criteria (0 / 2 / 7 / 10) where applicable.
- Flag any self-score vs verified score discrepancies the context suggests.
- Use precise programme terminology (SQEP, CFSI, OSV, CSIP, portal).
- Be analytical and objective — this is a verification context, not a coaching one.
- Cite sources by name.
- You have memory of the recent conversation; use it to handle follow-up questions naturally.
${SHARED_KNOWLEDGE}`,

    osv: `You are Frankie, an F4N (Fit for Nuclear) intelligence assistant in OSV Prep Mode.
You are helping a supplier prepare for their Onsite Verification visit.
- Structure answers as checklists where possible — specific things to have ready, documents to locate, evidence to prepare.
- Be concrete: name the exact records, certificates, and artefacts the SCC will want to see.
- Flag anything that commonly trips up companies at OSV stage.
- Use an encouraging but honest tone — this is high stakes preparation.
- Cite sources by name.
- You have memory of the recent conversation; use it to build a running OSV prep picture across questions.
${SHARED_KNOWLEDGE}`,

    readiness: `You are Frankie, an F4N (Fit for Nuclear) intelligence assistant in Readiness Mode.
You are helping a company understand where they stand before formally entering the F4N programme.
- Use plain, accessible language — assume the user is new to nuclear supply chain requirements.
- Frame answers around readiness gaps and what to prioritise first.
- Be encouraging and constructive — this is a diagnostic, not a judgement.
- Avoid heavy jargon; explain acronyms on first use.
- Keep answers brief and focused on the most important next steps.
- Cite sources by name.
- You have memory of the recent conversation; use it to build a coherent readiness picture.
${SHARED_KNOWLEDGE}`
};

const DEFAULT_PROMPT = MODE_PROMPTS.company;

// ── Shared request builder ────────────────────────────────────────────────────

function buildRequestBody(query, sources, history, mode, confProfile, stream = false, modelOverride = null) {
    const systemPrompt = (MODE_PROMPTS[mode] || DEFAULT_PROMPT) + (
        confProfile === 'low'
            ? '\n\nIMPORTANT: The knowledge base match for this query is weak. Lead your answer by clearly stating that you did not find a strong source, summarise what you did find, and direct the user to their SCC or the F4N portal for verification. Do not present a weak match as authoritative.'
            : confProfile === 'medium'
                ? '\n\nNote: The knowledge base match is moderate. Include a brief note that the user should verify key details with their SCC before acting on this.'
                : ''
    );

    const sourceSummary = sources
        .slice(0, 5)
        .map((s, i) => {
            // KB chunks store content in 'content' (often JSON); fall back to 'text'
            let body = s.content || s.text || '';
            // If it's a JSON string, try to extract readable text from it
            if (body.startsWith('{') || body.startsWith('[')) {
                try {
                    const parsed = JSON.parse(body);
                    body = JSON.stringify(parsed, null, 1).slice(0, 600);
                } catch { body = body.slice(0, 600); }
            } else {
                body = body.slice(0, 600);
            }
            return `[Source ${i + 1}] ${s.title || s.source || 'KB'}:\n${body}`;
        })
        .join('\n\n');

    return {
        model: modelOverride || CONFIG.claudeModel || 'claude-sonnet-4-6',
        max_tokens: 800,
        stream,
        system: systemPrompt,
        messages: [
            ...history,
            { role: 'user', content: `Context:\n${sourceSummary}\n\nQuestion: ${query}` }
        ]
    };
}

function buildFetchOptions(body, signal) {
    return {
        method: 'POST',
        signal,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
    };
}

function handleHttpError(response) {
    switch (response.status) {
        case 401: throw new Error('Invalid Claude API key. Check your key in Settings.');
        case 403: throw new Error('Claude access denied. Verify your account permissions.');
        case 429: throw new Error('Claude rate limit exceeded. Please wait a moment and try again.');
        default:
            if (response.status >= 500) {
                throw new Error('Claude service temporarily unavailable. Falling back to local KB answer.');
            }
            throw new Error(`Claude API error (HTTP ${response.status}).`);
    }
}

// ── True SSE streaming ────────────────────────────────────────────────────────

/**
 * Stream a Claude response directly into a container element as tokens arrive.
 * Returns the full accumulated text (for history), or null on abort/error.
 *
 * @param {HTMLElement}  container
 * @param {string}       query
 * @param {object[]}     sources
 * @param {object[]}     history
 * @param {string}       mode
 * @param {string}       confProfile
 * @param {AbortSignal}  [signal]
 * @param {number}       [requestId]   — stale-render guard
 * @returns {Promise<string|null>}
 */
export async function streamClaude(container, query, sources, history = [], mode = 'company', confProfile = 'high', signal, requestId, modelOverride = null) {
    const { RequestManager } = await import('./requestManager.js');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

    if (signal) {
        if (signal.aborted) { clearTimeout(timeout); return null; }
        signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const messagesEl = document.getElementById('messages');

    try {
        const response = await fetch(
            `${WORKER_URL}/claude/v1/messages`,
            buildFetchOptions(buildRequestBody(query, sources, history, mode, confProfile, true, modelOverride), controller.signal)
        );

        if (!response.ok) handleHttpError(response);

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let buffer = '';
        let _inputTokens = 0, _outputTokens = 0;

        container.innerHTML = '<span class="cursor">▌</span>';

        while (true) {
            // Stale-render guard on each chunk
            if (requestId !== undefined && !RequestManager.isActive(requestId)) {
                reader.cancel();
                return null;
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE lines are separated by \n\n
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line for next chunk

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') break;

                try {
                    const evt = JSON.parse(data);
                    // Anthropic streaming: content_block_delta events carry the text
                    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                        accumulated += evt.delta.text;
                        container.innerHTML = formatText(accumulated) + '<span class="cursor">▌</span>';
                        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
                    }
                    // Capture token counts from usage events
                    if (evt.type === 'message_start' && evt.message?.usage) {
                        _inputTokens = evt.message.usage.input_tokens || 0;
                    }
                    if (evt.type === 'message_delta' && evt.usage) {
                        _outputTokens = evt.usage.output_tokens || 0;
                    }
                } catch {
                    // Malformed SSE line — skip
                }
            }
        }

        // Final render — remove cursor
        if (requestId === undefined || RequestManager.isActive(requestId)) {
            container.innerHTML = formatText(accumulated);
            if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        // Log token usage
        window.TM?.log({
            api:               'claude',
            model:             buildRequestBody(query, sources, [], mode, confProfile, true, modelOverride).model,
            prompt_tokens:     _inputTokens,
            completion_tokens: _outputTokens,
            source:            'frankie',
            note:              'stream'
        });

        return accumulated || null;

    } catch (err) {
        if (err.name === 'AbortError') {
            const timedOut = !signal || !signal.aborted;
            if (timedOut) throw new Error('Claude request timed out. Falling back to local KB answer.');
            return null;
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

// ── Non-streaming fallback ────────────────────────────────────────────────────
// Used when streaming is unavailable or for history-building after a stream.

export async function generateWithClaude(query, sources, history = [], mode = 'company', confProfile = 'high', signal) {

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

    if (signal) {
        if (signal.aborted) { clearTimeout(timeout); return null; }
        signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
        const response = await fetch(
            `${WORKER_URL}/claude/v1/messages`,
            buildFetchOptions(buildRequestBody(query, sources, history, mode, confProfile, false), controller.signal)
        );

        if (!response.ok) handleHttpError(response);

        const data = await response.json();
        if (!data?.content?.[0]?.text) {
            console.warn('Frankie: unexpected Claude response structure', data);
            return null;
        }
        // Log token usage
        if (data.usage) {
            window.TM?.log({
                api:               'claude',
                model:             data.model || 'claude',
                prompt_tokens:     data.usage.input_tokens  || 0,
                completion_tokens: data.usage.output_tokens || 0,
                source:            'frankie',
                note:              'non-stream'
            });
        }
        return data.content[0].text;

    } catch (err) {
        if (err.name === 'AbortError') {
            const timedOut = !signal || !signal.aborted;
            if (timedOut) throw new Error('Claude request timed out. Falling back to local KB answer.');
            return null;
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}
