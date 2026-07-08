// ── ConfigManager ─────────────────────────────────────────────────────────────
// Centralised configuration: model selection, retrieval settings, feature flags.
// API keys are now held as Cloudflare Worker secrets — not stored client-side.

export class ConfigManager {
    // ── Storage helpers (kept for non-key values) ─────────────────────────

    static get(key, defaultValue = '') {
        return localStorage.getItem(key) ?? defaultValue;
    }

    static set(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.warn('ConfigManager: localStorage write failed', e);
        }
    }

    static getBool(key, defaultValue = false) {
        const stored = localStorage.getItem(key);
        if (stored === null) return defaultValue;
        return stored === 'true';
    }

    static remove(key) {
        localStorage.removeItem(key);
    }

    // ── API Keys — always resolved via Cloudflare Worker ─────────────────
    // Return a non-empty sentinel so any key-presence checks still pass.

    static get claudeApiKey() { return 'worker'; }
    static get groqApiKey()   { return 'worker'; }

    static get claudeModel() {
        return ConfigManager.get('frankieClaudeModel', 'claude-sonnet-4-6');
    }

    static get groqModel() {
        return ConfigManager.get('frankieGroqModel', 'llama-3.1-8b-instant');
    }

    // ── Feature flags — on by default, SCC-controlled via localStorage ───────
    // localStorage value 'false' (string) disables; anything else (or absent) = enabled.

    static get useClaude() { return localStorage.getItem('frankieClaudeEnabled') !== 'false'; }
    static get useGroq()   { return localStorage.getItem('frankieGroqEnabled')   !== 'false'; }

    static get tier() {
        return ConfigManager.get('frankieTier', 'free');
    }

    // ── Retrieval settings ────────────────────────────────────────────────

    static get maxSources() { return 5; }
    static get confidenceThreshold() { return 0.7; }
}

// ── Backwards-compatible CONFIG object ───────────────────────────────────────

export const CONFIG = {
    get claudeApiKey()          { return ConfigManager.claudeApiKey; },
    get claudeModel()           { return ConfigManager.claudeModel; },
    get groqApiKey()            { return ConfigManager.groqApiKey; },
    get groqModel()             { return ConfigManager.groqModel; },
    get maxSources()            { return ConfigManager.maxSources; },
    get confidenceThreshold()   { return ConfigManager.confidenceThreshold; },
    modelMode: 'hybrid'
};

export function refreshConfig() { return CONFIG; }
