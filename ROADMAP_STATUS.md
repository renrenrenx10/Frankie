# Frankie — Roadmap Status

## Core Platform Phases

### Phase 1 — Codebase split        ✅ DONE
### Phase 2 — Retrieval / chunking  ✅ DONE
### Phase 3 — Groq preprocessing    ✅ DONE & VERIFIED
### Phase 4 — Streaming / pipeline / evidence  ✅ DONE & WIRED
### Phase 5 — Hybrid model routing  ✅ DONE & VERIFIED
### Phase 6 — claude.js module      ✅ DONE
### Phase 7 — Documentation         ✅ DONE

---

## Features

### Feature 3 — ISO 19443 Position Tool  ✅ BUILT (June 2026)

Maps a company's F4N/BE scores against all 33 ISO 19443 clauses to give a clause-level RAG position.

**Key files:**
- `js/iso19443-drawer.js` — IIFE drawer, styled to match assessment-drawer.js (assess-* CSS classes, pill nav, stacked option buttons, feedback blocks)
- `kb/iso19443_mapping.json` — 66 questions (28 BE real F4N questions, 32 NSS, 6 GAP additional), 33 ISO 19443 clauses
- `kb/handbook_url_map.json` — 72 URL slugs mapped to HandbookDrawer chapter IDs

**Results screen shows:**
1. RAG dial + distribution bar
2. "Areas covered by F4N Scoring" — collapsible clause cards with per-question scores
3. "Gaps" — clause cards with NucCol notes, inline handbook links, Frankie buttons

**Triggered from:** `window.Iso19443Drawer.open()` in index.html Supplier Tools section.

**TO DO: Link to SCC backend**
POST clause-level results to SCC portal when company views results so assigned SCC sees their ISO 19443 position alongside F4N scores. Needs: SCC API endpoint, Azure AD auth, company ID from session. Payload: `{ companyId, date, ragScore, clauseScores: {}, gapClauses: [] }`.

---

### Feature 1 — Guided Document Vault       ⏳ PLANNED
### Feature 2 — Pre-Meeting / Pre-OSV Pack  ⏳ PLANNED (needs SharePoint MCP)
### Feature 4 — Skills & SQEP Diagnostic    ⏳ PLANNED
### Feature 5 — Compliance Training Quizzes ⏳ PLANNED
### Feature 6 — Social Value Finder         ⏳ PLANNED
### Feature 7 — Document Upload & Review    ⏳ PLANNED

---

## Phase 2 Detail
- IMP-05 Embeddings retrieval    ✅ DONE (`scripts/precompute_embeddings.py` → `kb/kb_vectors.json`)
- IMP-06 Persistent history      ✅ DONE (`js/history.js`)
- IMP-07 Tier enforcement        ✅ DONE (free / member tiers in `retrieval.js`)

## Other completed items
- Self-assessment drawer (BE + F4N) — `js/assessment-drawer.js`
- Handbook drawer — `js/handbook-drawer.js`, `HandbookDrawer.open(chapterId)`
- ISO 19443 ↔ F4N clause mapping spreadsheet — `frankie_ISO_mapping.xlsx`

---
*See `FRANKIE_STATUS.md` for full feature detail and file map.*
