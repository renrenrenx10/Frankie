
// ── Answer template renderer ──────────────────────────────────────────────────
// Takes KB results + intent + mode and returns structured HTML.
// Works entirely in local mode — no Claude required.

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function bold(text) {
    // Convert **x** markdown to <strong>
    return String(text || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function sourceTag(result) {
    const s = (result.source || result.source_file || 'Knowledge Base')
        .replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
    return `<span class="tmpl-source">${esc(s)}</span>`;
}

function snippetSentences(text, max = 3) {
    // Split on sentence boundaries, return first max sentences
    const sentences = (text || '').split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);
    return sentences.slice(0, max).join(' ');
}

// ── Intent renderers ──────────────────────────────────────────────────────────

function renderProcedure(results, mode) {
    const top = results[0];
    const text = top.text || '';

    // Extract steps — look for numbered patterns or sentence-split
    const numbered = text.match(/(?:^|\n)\s*(\d+[\.\)])\s+(.+)/gm);
    const steps = numbered
        ? numbered.map(s => s.replace(/^\s*\d+[\.\)]\s*/, '').trim()).filter(Boolean)
        : snippetSentences(text, 5).split('. ').filter(s => s.length > 15);

    const modeNote = {
        scc:      'Review each step for evidence of compliance — look for documented procedures and records.',
        osv:      'Prepare evidence for each step before your OSV. Your SCC will expect to see documented proof.',
        readiness:'Work through these steps in order to build your programme readiness.',
        company:  'Follow these steps to meet F4N requirements in this area.'
    }[mode] || '';

    return `
        <div class="tmpl tmpl-procedure">
            <div class="tmpl-header">
                <span class="tmpl-icon">📋</span>
                <span class="tmpl-title">Process Steps</span>
                ${sourceTag(top)}
            </div>
            ${modeNote ? `<p class="tmpl-note">${esc(modeNote)}</p>` : ''}
            <ol class="tmpl-steps">
                ${steps.map(s => `<li>${bold(esc(s))}</li>`).join('')}
            </ol>
            ${results.length > 1 ? `<p class="tmpl-also">Also referenced in: ${results.slice(1, 3).map(sourceTag).join(' ')}</p>` : ''}
        </div>`;
}

function renderRisk(results, mode) {
    const rows = results.slice(0, 4).map(r => {
        const text = (r.text || '').slice(0, 200).trim();
        const source = (r.source || r.source_file || 'KB').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
        // Try to infer a mitigation from the text — look for "should", "must", "ensure"
        const mitigationMatch = text.match(/(?:should|must|ensure|require)[^.]+\./i);
        const mitigation = mitigationMatch ? mitigationMatch[0].trim() : 'Verify with your SCC.';
        const threat = text.replace(mitigationMatch?.[0] || '', '').slice(0, 120).trim() || text.slice(0, 120);
        return { threat, mitigation, source };
    });

    const modeNote = {
        scc:      '⚠ Review each area for scoring evidence. Flag any gaps to the programme team.',
        osv:      '⚠ Have documented mitigations ready for each risk area before your OSV.',
        readiness:'These are areas to address before entering the F4N programme.',
        company:  'Address each of these areas to maintain F4N compliance.'
    }[mode] || '';

    return `
        <div class="tmpl tmpl-risk">
            <div class="tmpl-header">
                <span class="tmpl-icon">⚠</span>
                <span class="tmpl-title">Risk Areas</span>
            </div>
            ${modeNote ? `<p class="tmpl-note tmpl-note--risk">${esc(modeNote)}</p>` : ''}
            <div class="tmpl-risk-table">
                <div class="tmpl-risk-row tmpl-risk-header">
                    <div>Risk / Area</div>
                    <div>Mitigation / Action</div>
                </div>
                ${rows.map(r => `
                <div class="tmpl-risk-row">
                    <div class="tmpl-risk-threat">${bold(esc(r.threat))}… <span class="tmpl-source">${esc(r.source)}</span></div>
                    <div class="tmpl-risk-mitigation">${bold(esc(r.mitigation))}</div>
                </div>`).join('')}
            </div>
        </div>`;
}

function renderComparison(results, mode) {
    // Take up to 4 results and compare them as distinct items
    const items = results.slice(0, 4).map(r => ({
        label: (r.source || r.source_file || 'Item').replace(/\.[a-z]+$/i, '').replace(/_/g, ' '),
        section: r.section || r.content_type || '',
        text: (r.text || '').slice(0, 180).trim(),
        score: r.score || 0
    }));

    const modeNote = {
        scc:      'Compare scoring criteria across these areas and check for consistency in the supplier submission.',
        osv:      'Review each area — your OSV may cover all of these, so prepare evidence for each.',
        readiness:'These areas may differ in how much preparation they require. Prioritise the highest scoring gaps.',
        company:  'Each of these areas has distinct requirements — make sure you\'re addressing all of them.'
    }[mode] || '';

    return `
        <div class="tmpl tmpl-comparison">
            <div class="tmpl-header">
                <span class="tmpl-icon">⇄</span>
                <span class="tmpl-title">Comparison</span>
            </div>
            ${modeNote ? `<p class="tmpl-note">${esc(modeNote)}</p>` : ''}
            <div class="tmpl-comp-grid">
                ${items.map(item => `
                <div class="tmpl-comp-card">
                    <div class="tmpl-comp-label">${esc(item.label)}</div>
                    ${item.section ? `<div class="tmpl-comp-section">${esc(item.section)}</div>` : ''}
                    <div class="tmpl-comp-text">${bold(esc(item.text))}…</div>
                </div>`).join('')}
            </div>
        </div>`;
}

function renderSummary(results, mode) {
    const points = results.slice(0, 5).map(r => {
        const text = snippetSentences(r.text, 2);
        const source = (r.source || r.source_file || 'KB').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
        return { text, source };
    });

    const modeNote = {
        scc:      'Key points from across the knowledge base. Verify each against the portal before scoring.',
        osv:      'Summary of relevant guidance. Use this to structure your OSV preparation checklist.',
        readiness:'Here\'s what the F4N programme covers in this area.',
        company:  'Key points from F4N documentation on this topic.'
    }[mode] || '';

    return `
        <div class="tmpl tmpl-summary">
            <div class="tmpl-header">
                <span class="tmpl-icon">◉</span>
                <span class="tmpl-title">Summary</span>
            </div>
            ${modeNote ? `<p class="tmpl-note">${esc(modeNote)}</p>` : ''}
            <ul class="tmpl-bullets">
                ${points.map(p => `
                <li>
                    <span class="tmpl-bullet-text">${bold(esc(p.text))}</span>
                    <span class="tmpl-source">${esc(p.source)}</span>
                </li>`).join('')}
            </ul>
        </div>`;
}

function renderQuestion(results, mode) {
    // Digest — intro sentence + 2-3 clean sentences, then source + "expand for more"
    const top     = results[0];
    const section = top.section || '';
    const digest  = snippetSentences(top.text, 3);

    const modeIntro = {
        scc:      section ? `F4N guidance on **${section}** (SCC view):` : 'From the F4N knowledge base (SCC view):',
        osv:      section ? `F4N guidance on **${section}** for your OSV:` : 'Relevant F4N guidance for your OSV preparation:',
        readiness:section ? `F4N programme guidance on **${section}**:` : 'Based on F4N programme guidance:',
        company:  section ? `F4N guidance on **${section}**:` : 'Based on the F4N knowledge base:'
    }[mode] || 'Based on the F4N knowledge base:';

    const moreNote = results.length > 1
        ? ` &nbsp;<span class="tmpl-also-inline">+${results.length - 1} more source${results.length > 2 ? 's' : ''} in evidence panel below</span>`
        : ' &nbsp;<span class="tmpl-also-inline">Expand evidence panel below for full extract</span>';

    return `
        <div class="tmpl tmpl-question">
            <p class="tmpl-intro">${bold(esc(modeIntro))}</p>
            <p class="tmpl-body">${bold(esc(digest))}</p>
            <p class="tmpl-footer">${sourceTag(top)}${moreNote}</p>
        </div>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function applyTemplate(results, intent, mode) {
    if (!results?.length) return null;

    switch (intent) {
        case 'Procedure':   return renderProcedure(results, mode);
        case 'Risk':        return renderRisk(results, mode);
        case 'Comparison':  return renderComparison(results, mode);
        case 'Summary':     return renderSummary(results, mode);
        default:            return renderQuestion(results, mode);
    }
}
