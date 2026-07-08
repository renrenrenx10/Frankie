// ── Persistent conversation history ──────────────────────────────────────────
// Saves up to 20 Q&A pairs to localStorage.
// renderRecentPanel() lives in ui.js (sidebar accordion owner).
// This module exports saveExchange and clearAllHistory only.

const STORAGE_KEY  = 'frankieHistory';
const MAX_SESSIONS = 20;

function loadSessions() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function saveSessions(sessions) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
        const pruned = sessions.slice(-Math.floor(MAX_SESSIONS / 2));
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned)); } catch {}
    }
}

export function saveExchange(query, answerHtml, mode, confProfile) {
    const sessions = loadSessions();
    sessions.push({ id: Date.now(), date: new Date().toISOString(), mode, confProfile, query, answerHtml });
    if (sessions.length > MAX_SESSIONS) sessions.splice(0, sessions.length - MAX_SESSIONS);
    saveSessions(sessions);
    // Refresh the sidebar panel
    import('./ui.js').then(m => m.renderRecentPanel?.());
}

export function clearAllHistory() {
    localStorage.removeItem(STORAGE_KEY);
    import('./ui.js').then(m => m.renderRecentPanel?.());
}

// Kept for any legacy callers
export function renderRecentPanel() {
    import('./ui.js').then(m => m.renderRecentPanel?.());
}
