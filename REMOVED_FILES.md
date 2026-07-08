# REMOVED FILES

## Summary

No files were removed in this refactor.

---

## Dead Code Analysis

### `js/chat.js`
**Status: RETAINED**
Contains a single stub `initialiseChat()` function with a comment that it re-exports from `app.js` for backwards compatibility.
- References checked: not imported by any current module.
- Risk of removal: LOW — but as it's < 5 lines and carries a clear backwards-compat comment, it is left in place.
- Action: retained as-is; documented for future cleanup.

### `js/pipeline.js`
**Status: RETAINED — ACTIVELY USED**
- Imported by `app.js` via `createPipelineBar`, `advancePipeline`, `completePipeline`.
- Provides the visual pipeline progress bar for every query.

### `js/templates.js`
**Status: RETAINED — ACTIVELY USED**
- Imported by `app.js` via `applyTemplate`.
- Renders structured local responses (procedure, risk, comparison, summary intents).

### `js/modelSelector.js`
**Status: RETAINED**
- `createModelSelector` is not currently imported by any production module.
- The UI mode-switching is handled by `.mode-btn` click handlers in `ui.js`.
- Risk of removal: LOW — retained for potential future use; documented as a candidate for cleanup in v2.1.

### `js/legacy-app.js`
**Status: RETAINED — CRITICAL KB DATA**
- Confirmed: contains 2.4 MB of serialised knowledge base chunks (legacy F4N programme verification reports, scoring breakdowns).
- These chunks are loaded by `retrieval.js` via `KB_FILES` array (`loadKnowledgeBase()`), which fetches them as JSON.
- **NOT dead code.** Removal would eliminate a significant portion of the knowledge base.
- No modifications made.

---

## Files Reviewed and Cleared

| File | Decision | Reason |
|------|----------|--------|
| `js/chat.js` | Retained | Backwards-compat stub; negligible size |
| `js/pipeline.js` | Retained | Actively used |
| `js/templates.js` | Retained | Actively used |
| `js/modelSelector.js` | Retained | Not currently imported but may be used in future |
| `js/legacy-app.js` | **Must retain** | Live KB data loaded by retrieval.js |
| `js/app.js` | Retained + refactored | Main entry point |
