// ── Groq integration ──────────────────────────────────────────────────────────
// Handles query preprocessing / rewriting via Groq LLM.
// Hardened: structured error codes, timeout (30 s), abort-safe, fallback-safe.

import { CONFIG } from './config.js';

const GROQ_TIMEOUT_MS = 30000;
const WORKER_URL = 'https://ch.rene-dorset.workers.dev';

const FALLBACK_RESULT = {
    intent: 'Question',
    rewrittenQueries: [],
    compressedContext: ''
};

/**
 * Call Groq to rewrite/classify a query.
 * Always resolves — preprocessing failures NEVER crash the chat.
 *
 * @param {string} query
 * @param {AbortSignal} [signal]  — from RequestManager
 * @returns {Promise<{intent, rewrittenQueries, compressedContext}>}
 */
export async function enhanceWithGroq(query, signal) {

    const controller = new AbortController();
    // Merge external abort with our local timeout abort
    const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    // Forward external abort signal into our controller
    if (signal) {
        if (signal.aborted) {
            clearTimeout(timeout);
            return FALLBACK_RESULT;
        }
        signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
        const response = await fetch(`${WORKER_URL}/groq/openai/v1/chat/completions`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: CONFIG.groqModel,
                messages: [
                    {
                        role: 'system',
                        content: 'Return JSON only with fields: intent (string), rewrittenQueries (string[]), compressedContext (string).'
                    },
                    { role: 'user', content: query }
                ],
                response_format: { type: 'json_object' }
            })
        });

        // ── HTTP error handling ───────────────────────────────────────────
        if (!response.ok) {
            switch (response.status) {
                case 401: throw new Error('Invalid Groq API key. Check your key in Settings.');
                case 403: throw new Error('Groq access denied. Verify your account permissions.');
                case 429: throw new Error('Groq rate limit exceeded. Please wait a moment and try again.');
                default:
                    if (response.status >= 500) {
                        throw new Error('Groq service temporarily unavailable. Falling back to local preprocessing.');
                    }
                    throw new Error(`Groq request failed (HTTP ${response.status}).`);
            }
        }

        // ── Safe JSON parse ───────────────────────────────────────────────
        const data = await response.json();

        // ── Token tracking ────────────────────────────────────────────────
        if (data?.usage) {
            window.TM?.log({
                api:               'groq',
                model:             data.model || CONFIG.groqModel,
                prompt_tokens:     data.usage.prompt_tokens     || 0,
                completion_tokens: data.usage.completion_tokens || 0,
                source:            'frankie',
                note:              'preprocessing'
            });
        }

        if (!data?.choices?.[0]?.message?.content) {
            console.warn('Frankie: malformed Groq response structure', data);
            return FALLBACK_RESULT;
        }

        try {
            const parsed = JSON.parse(data.choices[0].message.content);
            return {
                intent:           parsed.intent           || 'Question',
                rewrittenQueries: parsed.rewrittenQueries || [],
                compressedContext: parsed.compressedContext || ''
            };
        } catch (parseErr) {
            console.warn('Frankie: Groq returned invalid JSON', parseErr, data);
            return FALLBACK_RESULT;
        }

    } catch (err) {
        if (err.name === 'AbortError') {
            // Distinguish user-cancel from timeout
            const timedOut = !signal || !signal.aborted;
            if (timedOut) {
                console.warn('Frankie: Groq request timed out — using local preprocessing');
            }
            return FALLBACK_RESULT;
        }
        // Log but never crash — preprocessing is best-effort
        console.error('Frankie: Groq preprocessing failed:', err.message);
        return FALLBACK_RESULT;
    } finally {
        clearTimeout(timeout);
    }
}

// Backwards-compat alias
export { enhanceWithGroq as rewriteWithGroq };
