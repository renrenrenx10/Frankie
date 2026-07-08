# Frankie — Build Status & Roadmap
*Last updated: June 2026*

---

## What Frankie Is

Frankie is NucCol's AI chatbot for the F4N (Fit for Nuclear) programme. It runs as a static web app at `index.html` with a local knowledge base in `kb/`. It uses Claude API for answers, Groq for preprocessing, and hybrid keyword + vector retrieval.

**Stack:** Vanilla JS · Claude API · Groq API · OpenAI embeddings · JSON knowledge base

---

## Features — Status

### Feature 1 — Guided Document Vault
**Status: PLANNED**
Frankie-guided document drafting against SCC-verified templates. Output: Word docs built to F4N scoring criteria.

### Feature 2 — Pre-Meeting & Pre-OSV Pack
**Status: PLANNED**
Auto-generated gap report + SCC briefing pack from a company's scores and uploaded docs (SharePoint integration).

### Feature 3 — ISO 19443 Position Tool ✅ BUILT (June 2026)
**Status: LIVE in Frankie**

Maps a company's F4N/BE scores against all 33 ISO 19443 clauses to give a clause-level RAG position.

**What was built:**
- `js/iso19443-drawer.js` — full IIFE drawer, ~550 lines. Styled to match `assessment-drawer.js` exactly (assess-* CSS classes, pill section bar, stacked option buttons, feedback blocks).
- `kb/iso19443_mapping.json` — 66 questions: 28 BE (pulled from real F4N questions), 32 NSS (Fit for Nuclear scored questions), 6 GAP (new questions covering ISO 19443 clauses not in F4N). Each question has 4 options scored 0/2/7/10 with feedback. Maps to 33 ISO 19443 clause IDs.
- `kb/handbook_url_map.json` — 72 URL slugs mapped to HandbookDrawer chapter IDs (e.g. `"strategy-leadership-mission-vision-values": "STR05"`). Enables inline handbook lookup without leaving Frankie.

**How it works:**
1. Intro screen explains purpose (F4N scores as baseline, additional questions for uncovered clauses)
2. User works through 14 sections (6 BE, 7 NSS, 1 Additional) via pill navigation bar
3. Results show:
   - RAG dial (Red/Amber/Green) with % score
   - **"Areas covered by F4N Scoring"** — collapsible clause cards with BE/NSS question scores
   - **"Gaps"** — per-clause cards with NucCol notes, handbook links (→ HandbookDrawer), Frankie buttons. If no handbook chapter: "Whoops, even we have gaps! Ask Frankie"
4. Handbook links open `HandbookDrawer.open(chapterId)` inline — 72/88 URLs mapped, rest fall back to Frankie
5. "Ask Frankie →" pre-fills chat with gap-specific prompt
6. State preserved when user closes and reopens drawer

**Triggered from:** Supplier Tools section in `index.html` — `window.Iso19443Drawer.open()`

**TO DO: Link to SCC backend**
When a company completes the assessment, POST their clause-level results (scores, RAG position, gaps) to the SCC backend so the assigned SCC sees the company's self-assessed ISO 19443 position alongside their F4N scores.
- Needs: SCC portal API endpoint, Azure AD / Entra SSO auth, company ID from session
- Trigger: on results view load, or explicit "Submit to SCC" button
- Payload: `{ companyId, date, ragScore, clauseScores: {}, gapClauses: [] }`

### Feature 4 — Skills & SQEP Gap Diagnostic
**Status: PLANNED**

### Feature 5 — Compliance Training Quizzes
**Status: PLANNED**

### Feature 6 — Social Value Finder ✅ BUILT (June 2026)
**Status: LIVE in Frankie**
Postcode-based tool generating 20 local social value opportunities (charities, sports clubs, schools, community groups). Uses postcodes.io + Claude Haiku. `js/social-value-drawer.js`, `css/social-value.css`.

### Feature 7 — Evidence Vault ✅ BUILT (June 2026)
**Status: LIVE in Frankie + SCC portal**

Companies upload assessment evidence documents against each BE question. SCC portal has a live view.

**Company side (Frankie — index.html):**
- "Evidence Vault" button in Supplier Tools → opens drawer
- 6 tabs (BE sections) × 10 questions each — shows question, evidence type required, upload button
- Files stored in Supabase Storage bucket `evidence-docs` at `{userId}/{section-slug}/{filename}`
- `_profile.json` written per company to map userId → company name
- Auth bridged from members.html via localStorage: `frankieUserId`, `frankieUserToken`, `frankieCompanyName`
- Files: `js/evidence-vault-drawer.js`, `css/evidence-vault.css`, `kb/be_evidence_map.json`

**SCC side (scc.html):**
- Evidence Vault nav item → reads all company folders from Supabase Storage
- Shows company name (from `_profile.json`), expandable file list per BE section
- Files opened via Supabase signed URLs (1hr expiry) using `db.storage.createSignedUrl()`
- Auth: Supabase `signInWithPassword` with `@nuccol.co.uk` email; RLS policy restricts to NucCol staff

**SCC Dashboard (scc.html — Companies screen):**
- Live evidence activity panel: companies active, total files, avg sections done, last upload date
- Company progress cards: progress bar, 6 section dots (green/grey), file count, last active, "View →" link
- Auto-populates from Supabase on login; ↻ Refresh button
- Manual CRM grid below (localStorage) for SCC-managed company records + assessments

**Supabase setup required:**
- Bucket: `evidence-docs` (private)
- RLS policy: `@nuccol.co.uk` emails can read all; companies can read/write own folder (`auth.uid()::text`)
- SCC user: create with `@nuccol.co.uk` email in Supabase Auth dashboard

---

## Core Platform — Status

| Phase | Description | Status |
|---|---|---|
| 1 | Codebase split | ✅ Done |
| 2 | Retrieval / chunking + embeddings | ✅ Done |
| 3 | Groq preprocessing | ✅ Done |
| 4 | Streaming / pipeline / evidence rail | ✅ Done |
| 5 | Hybrid model routing | ✅ Done |
| 6 | claude.js module | ✅ Done |
| 7 | Documentation | ✅ Done |
| — | Assessment drawer (BE + F4N self-assessment) | ✅ Done |
| — | Handbook drawer (inline handbook viewer) | ✅ Done |
| — | ISO 19443 Position tool | ✅ Done (June 2026) |
| — | Social Value Finder | ✅ Done (June 2026) |
| — | Evidence Vault (company upload + SCC view) | ✅ Done (June 2026) |
| — | SCC Dashboard — live evidence activity | ✅ Done (June 2026) |
| — | SCC Portal — Supabase auth (replaces hardcoded gate) | ✅ Done (June 2026) |

---

## Key Files Reference

```
index.html                        Main app shell + drawer trigger buttons
js/app.js                         Main entry point
js/assessment-drawer.js           BE + F4N self-assessment drawer (style reference)
js/iso19443-drawer.js             ISO 19443 Position tool drawer
js/handbook-drawer.js             Inline handbook viewer
js/website-review.js              Website review tool
js/social-value-drawer.js         Social Value Finder drawer
js/due-diligence-drawer.js        Supplier Intelligence drawer
js/evidence-vault-drawer.js       Evidence Vault — company doc uploads to Supabase Storage
js/retrieval.js                   Hybrid keyword + cosine search
js/modelRouter.js                 Claude / Groq routing logic
css/evidence-vault.css            Evidence Vault drawer styles
css/social-value.css              Social Value Finder styles
css/due-diligence.css             Supplier Intel styles
kb/assessment_data.json           BE + F4N question data
kb/iso19443_mapping.json          ISO 19443 question mapping (66 questions, 33 clauses)
kb/handbook_url_map.json          URL slug → HandbookDrawer chapter ID (72 entries)
kb/be_evidence_map.json           BE section evidence requirements (section → questions → evidence type + examples)
kb/frankie_normalized_kb.json     Main knowledge base
kb/kb_vectors.json                Precomputed embeddings
scc.html                          SCC Staff Portal — Supabase auth, company CRM, assessments, evidence vault view, live dashboard
```

---

## Open To-Dos

1. **ISO 19443 → SCC backend** — POST results to SCC portal on completion (see Feature 3 above)
2. **Handbook URL coverage** — 16/88 ISO 19443 question URLs still unmapped (Security of Information chapter doesn't exist in handbook yet)
3. **Evidence Vault — load existing uploads on open** — when a company reopens the vault, show previously uploaded files with ticks (currently starts fresh each time)
4. **Wire Frankie into live members portal** — Frankie currently runs locally; needs embedding in `nuccol.co.uk/members.html` or linked from it
5. **Feature 1 (Guided Document Vault)** — next major build
6. **Feature 2 (Pre-OSV Pack)** — requires SharePoint MCP connector
