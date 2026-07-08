import { CONFIG } from './config.js';

const INTENT_PATTERNS = {
    Procedure: ['how', 'steps', 'process', 'prepare', 'perform'],
    Comparison: ['compare', 'difference', 'versus', 'vs'],
    Risk: ['risk', 'issue', 'problem', 'concern'],
    Summary: ['summarise', 'summary', 'overview'],
    Question: []
};

export async function preprocessQuery(query) {
    const intent = detectIntent(query);
    const rewrittenQueries = rewriteQuery(query);

    return {
        originalQuery: query,
        intent,
        rewrittenQueries,
        searchTerms: [query, ...rewrittenQueries]
    };
}

function detectIntent(query) {
    const lower = query.toLowerCase();

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
        if (patterns.some(pattern => lower.includes(pattern))) {
            return intent;
        }
    }

    return 'Question';
}

function rewriteQuery(query) {
    const terms = query.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3);

    return [
        query,
        ...terms.slice(0, 3),
        terms.join(' ')
    ].filter((value, index, array) => value && array.indexOf(value) === index);
}

export function compressContext(results, maxChunks = 4) {
    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, maxChunks);
}
