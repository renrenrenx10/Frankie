// ── Shared utilities ──────────────────────────────────────────────────────────

/**
 * Escape HTML special characters to prevent injection.
 */
export function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
