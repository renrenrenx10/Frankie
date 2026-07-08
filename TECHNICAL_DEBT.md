# TECHNICAL DEBT

## Priority 1 — Address Soon

### TD-001: `localStorage` vs `sessionStorage` inconsistency in `config.js`
The original `ConfigManager.get/set` used `sessionStorage`, but `ui.js` and `retrieval.js` read/write keys directly via `localStorage`. This refactor unified everything to `localStorage` (keys persist across tabs/reloads), but the original intent of ephemeral session storage for keys was not fully investigated.
- **Risk**: API keys now persist across browser sessions, which may be intentional for UX but is worth a deliberate decision.
- **Action**: Confirm persistence intent with product owner; document it.

### TD-002: `js/modelSelector.js` — unused export
`createModelSelector()` is exported but not imported by any current module. Mode switching is handled in `ui.js` via `.mode-btn` buttons.
- **Action**: Either wire it up or remove in v2.1.

### TD-003: `js/chat.js` — stub module
Contains only a no-op `initialiseChat()`. If nothing imports it, safe to delete.
- **Action**: Confirm no external consumers before removal.

---

## Priority 2 — Planned Improvements

### TD-004: Retrieval parallelism is per-query, not per-KB-file
`searchKnowledgeBase()` already calls `loadKnowledgeBase()` which parallel-fetches all KB files. The parallelism added in this refactor is at the query level. Single-term searches still execute all KB files sequentially during the scoring phase (in-memory).
- **Action**: Future: consider a Web Worker for scoring to keep the main thread free.

### TD-005: No streaming for Claude responses in the true sense
`streamResponse()` splits already-received text word-by-word. True token streaming requires the Anthropic streaming API (`stream: true`, reading SSE chunks). The current approach is a UX simulation.
- **Action**: Evaluate real streaming API for Claude responses in v2.1.

### TD-006: `embedQuery()` uses `localStorage` for OpenAI key (different from other keys)
The vector embedding key is stored under `frankieOpenAIEmbedKey` and read directly in `retrieval.js` via `localStorage.getItem()`, bypassing `ConfigManager`.
- **Action**: Migrate to `ConfigManager.get('frankieOpenAIEmbedKey')`.

### TD-007: `history.js` has its own `escapeHtml` — duplicated across modules
Three copies of `escapeHtml` exist: `app.js`, `history.js`, and implicitly `evidence.js`.
- **Action**: Extract to a shared `utils.js` module.

### TD-008: No request cancellation for KB vector embedding fetch
`embedQuery()` in `retrieval.js` has no abort signal or timeout.
- **Action**: Add signal + 10 s timeout to `embedQuery()`.

---

## Priority 3 — Low Urgency

### TD-009: `applyTemplate()` in `templates.js` doesn't accept `requestId`
Template rendering is synchronous so stale renders aren't currently possible, but if templates ever become async, the guard would be missing.

### TD-010: `pipeline.js` `STAGES` array is static
Adding a new pipeline stage requires editing two places (STAGES array + call sites in `app.js`).

### TD-011: Evidence score uses `/10` normalisation assumption
`evidence.js` and `app.js` both normalise `score / 10` to get `0–1`. This works because keyword scores are calibrated to ~10 max. If the scoring algorithm changes, this constant needs updating in two places.
- **Action**: Export a `normaliseScore(raw)` helper from `retrieval.js`.
