// ── Frankie Token Monitor ─────────────────────────────────────────────────────
// Shared across index.html and scc.html via localStorage.
// Sets window.TM — loaded as a plain (non-module) script.
// Usage: window.TM?.log({ api, model, prompt_tokens, completion_tokens, source })
(function () {
  'use strict';

  const STORE_KEY  = 'frankie_token_log';
  const MAX_ENTRIES = 500;

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch { return []; }
  }

  function save(entries) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(entries)); }
    catch (e) { console.warn('TM: localStorage write failed', e); }
  }

  window.TM = {
    /**
     * Log one API call.
     * @param {object} opts
     *   api: 'claude' | 'groq' | 'openai-embed' | 'brave'
     *   model: string
     *   prompt_tokens: number
     *   completion_tokens: number
     *   source: 'frankie' | 'scc'   (auto-detected if omitted)
     *   note: string (optional, e.g. drawer name)
     */
    log(opts) {
      const src = opts.source ||
        (window.location.pathname.toLowerCase().includes('scc') ? 'scc' : 'frankie');
      const pt = opts.prompt_tokens    || 0;
      const ct = opts.completion_tokens || 0;
      const entries = load();
      entries.push({
        ts:                Date.now(),
        api:               opts.api   || 'unknown',
        model:             opts.model || '',
        prompt_tokens:     pt,
        completion_tokens: ct,
        total_tokens:      pt + ct,
        source:            src,
        note:              opts.note || ''
      });
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      save(entries);
    },

    getAll() { return load(); },

    clear() { save([]); },

    /** Aggregate stats by API. */
    stats() {
      const entries = load();
      const apis = {};
      let total_tokens = 0;
      for (const e of entries) {
        if (!apis[e.api]) apis[e.api] = { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        apis[e.api].calls++;
        apis[e.api].prompt_tokens     += e.prompt_tokens;
        apis[e.api].completion_tokens += e.completion_tokens;
        apis[e.api].total_tokens      += e.total_tokens;
        total_tokens += e.total_tokens;
      }
      return {
        entries,
        apis,
        total_calls:  entries.length,
        total_tokens
      };
    }
  };
})();
