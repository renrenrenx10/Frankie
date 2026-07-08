# CHANGELOG

## v2.0.0 — Production Hardening Refactor (2026-06-11)

### New Files
- `js/requestManager.js` — Centralised AbortController lifecycle, stale-render prevention, per-request tracking.

### Modified Files

#### `js/app.js`
- Integrated `RequestManager.start()` at the top of `handleQuery()` — every new query cancels prior in-flight request.
- Added `requestId` guard (`RequestManager.isActive`) before each stage and every DOM write to prevent stale renders.
- **Parallelised retrieval**: replaced sequential `for` loop with `Promise.all(searchQueries.map(...))`.
- Normalised confidence: all `confidence` values now clamped to `0–1` via `Math.max(0, Math.min(score/10,1))`.
- Added `normalizedScore` property to every result chunk.
- Passed `signal` from RequestManager to `generateWithClaude()` and `rewriteWithGroq()`.
- Separated Claude failure (non-fatal) from pipeline failure — shows error note but still renders local fallback.
- Size-based conversation history trimming (no assumption of paired messages).
- Unified render path: both Claude and local responses now use the same `streamResponse` / `applyTemplate` pipeline.

#### `js/groq.js` (full rewrite)
- Replaced fragile single-controller pattern with per-call abort + external signal forwarding.
- Structured HTTP error handling: 401, 403, 429, 5xx, network, timeout each produce distinct messages.
- Safe JSON parsing with `data?.choices?.[0]?.message?.content` guard.
- **Always resolves** — preprocessing failures fall back to `{ intent, rewrittenQueries, compressedContext }` and NEVER crash chat.
- Timeout: 30 000 ms.

#### `js/claude.js` (full rewrite)
- Accepts `signal` parameter from RequestManager.
- Structured HTTP error handling: 401, 403, 429, 5xx.
- Timeout: 60 000 ms.
- Returns `null` on abort (caller falls back to local KB).

#### `js/streaming.js` (updated)
- `streamResponse()` now accepts optional `requestId` — aborts word-loop if request is no longer active.
- Added `renderResponse()` — instant (non-animated) render using same `formatText` pipeline.
- Both functions are exported for use as the unified renderer.

#### `js/evidence.js` (enhanced)
- Each evidence card now displays:
  - **Source** (full filename)
  - **Score** (normalised `0.000–1.000`)
  - **Chunk** (ID prefix or index)
  - **Matched Content** (220-char snippet with label)
- Confidence colour-coded: green ≥ 0.7, amber ≥ 0.4, red < 0.4.

#### `js/config.js` (refactored)
- Introduced full `ConfigManager` class with typed accessors (`getBool`, `get`, `set`, `remove`).
- Legacy `CONFIG` object and `refreshConfig()` retained for backwards compatibility.
- Removed `sessionStorage` (was inconsistent with `localStorage` usage elsewhere); unified to `localStorage`.

#### `js/modelRouter.js`
- No changes required — already guards `if (confidence === 0) return 'local'`.

#### `js/history.js`
- No changes required — already uses size-based `splice` trimming.

#### `css/styles.css`
- Added `.evidence-meta`, `.evidence-snippet-label`, `.evidence-conf--{high,medium,low}` rules.

### Preserved (no changes)
- `js/legacy-app.js` — KB data, confirmed active in retrieval pipeline.
- `js/retrieval.js` — already parallelised KB loading; hybrid search logic preserved.
- `js/pipeline.js` — no changes.
- `js/preprocessing.js` — no changes.
- `js/ui.js` — no changes.
- `js/templates.js` — no changes.
- `js/history.js` — no changes.
- `kb/*.json` — untouched.
- `index.html` — no changes (single ES module entry point preserved).
