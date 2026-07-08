
const STAGES = [
    { id: 'preprocess', label: 'Preprocessing query' },
    { id: 'search',     label: 'Searching knowledge base' },
    { id: 'route',      label: 'Routing to model' },
    { id: 'generate',   label: 'Generating answer' },
    { id: 'render',     label: 'Rendering response' }
];

export function createPipelineBar() {
    const bar = document.createElement('div');
    bar.className = 'pipeline-bar';
    bar.innerHTML = STAGES.map(s =>
        `<span class="pipeline-step" data-step="${s.id}">${s.label}</span>`
    ).join('<span class="pipeline-sep">›</span>');
    return bar;
}

export function advancePipeline(bar, stepId) {
    if (!bar) return;
    bar.querySelectorAll('.pipeline-step').forEach(el => {
        el.classList.remove('active', 'done');
    });
    let found = false;
    STAGES.forEach(s => {
        const el = bar.querySelector(`[data-step="${s.id}"]`);
        if (!el) return;
        if (found) return;
        if (s.id === stepId) {
            el.classList.add('active');
            found = true;
        } else {
            el.classList.add('done');
        }
    });
}

export function completePipeline(bar) {
    if (!bar) return;
    bar.querySelectorAll('.pipeline-step').forEach(el => {
        el.classList.remove('active');
        el.classList.add('done');
    });
    setTimeout(() => bar.remove(), 1200);
}
