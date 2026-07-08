// ── Streaming renderer ────────────────────────────────────────────────────────
// Simulates token-by-token streaming for all response types.
// Abort-safe: honours requestId guard so stale responses never render.

import { RequestManager } from './requestManager.js';

/**
 * Stream text into a container element word-by-word.
 *
 * @param {HTMLElement} container
 * @param {string}      text
 * @param {number}      [delayMs=12]   — ms between words
 * @param {number}      [requestId]    — if provided, aborts if no longer active
 */
export async function streamResponse(container, text, delayMs = 12, requestId) {
    if (!container) return;
    container.innerHTML = '';

    const words = text.split(' ');
    let accumulated = '';

    for (const word of words) {
        // Stale-render guard
        if (requestId !== undefined && !RequestManager.isActive(requestId)) {
            return;
        }

        accumulated += (accumulated ? ' ' : '') + word;
        container.innerHTML = formatText(accumulated) + '<span class="cursor">▌</span>';

        const messages = document.getElementById('messages');
        if (messages) messages.scrollTop = messages.scrollHeight;

        await new Promise(r => setTimeout(r, delayMs));
    }

    // Final render without cursor — only if still active
    if (requestId === undefined || RequestManager.isActive(requestId)) {
        container.innerHTML = formatText(accumulated);
    }
}

// ── Shared markdown formatter ─────────────────────────────────────────────────
// Used by streamResponse AND renderResponse for consistency.

export function formatText(text) {
    return String(text || '')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
        .replace(/^/, '<p>')
        .replace(/$/, '</p>');
}

/**
 * Render response text into container immediately (no streaming animation).
 * Uses the same formatText so output is visually identical to streamed output.
 */
export function renderResponse(container, text, requestId) {
    if (!container) return;
    if (requestId !== undefined && !RequestManager.isActive(requestId)) return;
    container.innerHTML = formatText(text);
}
