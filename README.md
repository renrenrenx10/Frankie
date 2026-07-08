# Frankie Stage 2 Complete + Stage 3 Started

## Status

Stage 2 is now complete against the roadmap gate:

- The knowledge base is chunked and metadata-rich.
- Retrieval ranks matched chunks from the JSON corpus, external local JSON files, and retained legacy knowledge.
- Answers display trust indicators: confidence, sources used, match score, and detected intent.
- Citations and the source rail expose matched source files, sections, content types, question IDs, and programme metadata.

Stage 3 has been started:

- Queries are preprocessed before retrieval.
- Local preprocessing rewrites the search query and detects intent when no Groq key is available.
- Optional Groq preprocessing can rewrite, classify, and set a 3-4 source compression target.
- Claude context is compressed to the top preprocessed source set before final answer generation.

## Structure

```text
index.html
css/styles.css
js/app.js
js/config.js
js/chat.js
js/retrieval.js
js/ui.js
js/legacy-app.js
kb/*.json
docs/architecture.md
```

## API Configuration

The app works locally without API keys.

- Claude API: optional final answer generation from matched Frankie context.
- Groq API: optional query rewriting, intent detection, and context compression before retrieval.

Keys are stored in browser local storage for local testing only.

## Stage 3 Next Work

1. Move Groq preprocessing into its own `js/groq.js` module.
2. Move Claude calls into `js/claude.js`.
3. Move active retrieval/UI code out of `legacy-app.js` once behaviour is stable.
4. Add a visible pipeline display: preprocessing, searching, ranking, compressing, generating.
5. Add an expandable evidence panel with matched text and chunk scores.


## Groq Setup

1. Obtain a Groq API key.
2. Open `js/config.js`.
3. Set:

```javascript
groqApiKey: 'your-groq-api-key'
```

If no key is supplied, Frankie automatically falls back to local preprocessing.
