# Frankie Architecture

## Current Flow

```text
User
  |
  v
UI
  |
  v
Groq/local preprocessing
  - query rewriting
  - intent detection
  - context compression target
  |
  v
Knowledge retrieval
  - chunk ranking
  - source scoring
  - confidence calculation
  |
  v
Local Frankie answer
  |
  +--> Claude answer generation, optional
  |
  v
Citations + confidence + source rail
```

## Stage 2 Completion

- `frankie4_kb.json` is the primary chunked knowledge corpus.
- Chunk metadata includes source, section, content type, programme version, audience, category, question ID, reference-only flag, text, word count, and indexing date.
- The live UI displays confidence, sources used, match score, and intent for each answer.
- The source rail displays matched evidence metadata.

## Stage 3 Start

- Groq preprocessing is optional and controlled from the sidebar.
- If Groq is disabled or unavailable, a local preprocessing fallback keeps the pipeline usable.
- Claude context is compressed to the top 3-4 sources after preprocessing.

## Known Technical Debt

- The active production logic still lives in `legacy-app.js` for compatibility.
- `chat.js`, `ui.js`, and `retrieval.js` are present as modular targets, but the live behaviour should be migrated into them during Stage 3/4 hardening.
- Direct browser calls to AI APIs are suitable for local demos only; production deployment should use a server-side proxy.
