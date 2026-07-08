// ── Model router ──────────────────────────────────────────────────────────────
// Routes each query to the right model based on KB confidence score.
//
// Strategy:
//   high confidence (≥ 0.6)  → Haiku   — KB has the answer; cheap synthesis
//   medium confidence (0.3–0.6) → Sonnet — needs more reasoning with partial context
//   low confidence (< 0.3)    → Sonnet — weakest context, needs best model to be useful
//   no results                → local   — no LLM can help without source material
//
// This keeps costs low (~70% Haiku) while reserving Sonnet for the queries
// where it actually makes a difference.

export const MODELS = {
    haiku:  'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-6'
};

/**
 * @param {number}  confidence   Normalised KB confidence 0–1
 * @param {boolean} claudeEnabled
 * @returns {{ route: string, model: string }}
 */
export function routeModel(confidence, claudeEnabled) {
    if (!claudeEnabled)    return { route: 'local',  model: null };
    if (confidence === 0)  return { route: 'local',  model: null };

    if (confidence >= 0.6) return { route: 'claude', model: MODELS.haiku };
    // medium or low confidence — use Sonnet for better reasoning with weak context
    return { route: 'claude', model: MODELS.sonnet };
}

/**
 * Human-readable label for the model tag in the chat UI.
 */
export function modelLabel(model) {
    if (!model) return 'local KB';
    if (model.includes('haiku'))  return 'Claude Haiku';
    if (model.includes('sonnet')) return 'Claude Sonnet';
    return model;
}
