// ── Evidence panel renderer  ──────────────────────────────────────────────────
// v3.0  Source canonicalisation: any legacy source_file name is remapped to
//        frankie_normalized_kb.json before rendering. The evidence panel will
//        never show frankie4_kb, frankie_master_kb, COMPANIES, etc.

import { normaliseScore } from './retrieval.js';

// ── Legacy → canonical source mapping ────────────────────────────────────────

const LEGACY_BASENAMES = new Set([
    'frankie4_kb',
    'frankie_master_kb',
    'COMPANIES',
    'PLANT_TREE',
    'ZONE_INFO',
    'COMPANY_DICT',
]);

const CANONICAL = 'frankie_normalized_kb.json';

/** Strip directory path, strip extension, then check against the legacy list. */
function canonicalSource(raw) {
    if (!raw) return CANONICAL;
    const base = String(raw).split('/').pop();            // basename with ext
    const stem = base.replace(/\.[^.]+$/, '');            // basename without ext
    if (LEGACY_BASENAMES.has(base) || LEGACY_BASENAMES.has(stem)) return CANONICAL;
    return base; // return just the basename — no path noise in the UI
}

// ── Main render export ────────────────────────────────────────────────────────

/**
 * Render an expandable evidence panel for retrieved KB results.
 *
 * @param {object[]} results  KB search results
 * @returns {string}          HTML string
 */
export function renderEvidencePanel(results) {
    if (!results?.length) return '';

    const cards = results.slice(0, 5).map((r, i) => {
        const rawSrc  = r.source || r.source_file || CANONICAL;
        const source  = canonicalSource(rawSrc);
        const shortSrc = source.replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');

        const normalised = r.normalizedScore !== undefined
            ? r.normalizedScore
            : normaliseScore(r.score);
        const pct = Math.round(normalised * 100);

        const chunkRef = r.id ? String(r.id).slice(0, 8) : `#${i + 1}`;
        const snippet  = (r.text || '').slice(0, 220).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const truncated = (r.text || '').length > 220;

        return `
        <div class="evidence-card">
          <div class="evidence-header">
            <span class="evidence-num">${i + 1}</span>
            <span class="evidence-source" title="${esc(source)}">${esc(shortSrc)}</span>
            ${r.content_type ? `<span class="evidence-type">${esc(r.content_type.replace(/_/g, ' '))}</span>` : ''}
            <span class="evidence-conf ${confClass(normalised)}" title="Normalised confidence">${pct}%</span>
          </div>
          <div class="evidence-meta">
            <span class="evidence-file"><strong>Source:</strong> ${esc(source)}</span>
            <span class="evidence-score"><strong>Score:</strong> ${normalised.toFixed(3)}</span>
            <span class="evidence-chunk"><strong>Chunk:</strong> ${esc(chunkRef)}</span>
          </div>
          ${r.section     ? `<div class="evidence-section">${esc(r.section)}</div>` : ''}
          ${r.question_id ? `<div class="evidence-qid">Question ID: ${esc(r.question_id)}</div>` : ''}
          <div class="evidence-snippet-label">Matched Content:</div>
          <div class="evidence-snippet">${snippet}${truncated ? '…' : ''}</div>
        </div>`;
    }).join('');

    return `<details class="evidence-panel">
      <summary>${results.length} source${results.length !== 1 ? 's' : ''} in evidence — frankie_normalized_kb.json</summary>
      <div class="evidence-list">${cards}</div>
    </details>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function confClass(score) {
    if (score >= 0.7) return 'evidence-conf--high';
    if (score >= 0.4) return 'evidence-conf--medium';
    return 'evidence-conf--low';
}
