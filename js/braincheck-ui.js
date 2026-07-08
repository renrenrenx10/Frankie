// ── Frankie BrainCheck UI  v3.2 ───────────────────────────────────────────────
// CSP-safe: all inline styles removed, replaced with CSS classes.

(function () {
    'use strict';

    const WORKER = 'https://ch.rene-dorset.workers.dev';

    const LS = {
        groqModel:   'frankieGroqModel',
        claudeModel: 'frankieClaudeModel',
    };

    // ── Checks ────────────────────────────────────────────────────────────

    async function checkBrain() {
        try {
            const r = await fetch('./kb/frankie6_kb.json');
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data  = await r.json();
            const count = Array.isArray(data) ? data.length
                        : Array.isArray(data?.chunks) ? data.chunks.length
                        : '?';
            return log('Brain', { status: 'ok', label: 'Loaded', detail: `${count} chunks · frankie6_kb.json` });
        } catch (e) {
            return log('Brain', { status: 'fail', label: 'Missing', detail: e.message });
        }
    }

    async function checkStitches() {
        try {
            const r = await fetch('./kb/frankie6_vectors.json');
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data  = await r.json();
            const count = data?.chunk_count ?? data?.vectors?.length ?? '?';
            const dims  = data?.dimensions ?? '?';
            return log('Vectors', { status: 'ok', label: 'File loaded', detail: `${count} vectors · ${dims}d · file ready` });
        } catch (e) {
            return log('Vectors', { status: 'fail', label: 'Missing', detail: e.message });
        }
    }

    function checkEmbedMode() {
        const enabled = localStorage.getItem('frankieEmbedEnabled') !== 'false';
        if (enabled) {
            return log('Embed', { status: 'ok', label: 'Semantic search', detail: 'OpenAI via worker · hybrid mode active' });
        }
        return log('Embed', { status: 'warn', label: 'Keyword-only', detail: 'Disabled in SCC Settings' });
    }

    async function checkGroq() {
        const enabled = localStorage.getItem('frankieGroqEnabled') !== 'false';
        if (!enabled) return log('Groq', { status: 'warn', label: 'Disabled', detail: 'Turned off in SCC Settings' });
        const model = localStorage.getItem(LS.groqModel) || 'llama-3.1-8b-instant';
        try {
            const r = await fetch(`${WORKER}/groq/openai/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
            });
            if (r.status === 401) return log('Groq', { status: 'fail', label: 'Key error', detail: 'Check GROQ_KEY in Cloudflare Worker' });
            if (r.status === 429) return log('Groq', { status: 'warn', label: 'Rate limited', detail: 'Key valid but rate-limited' });
            if (!r.ok)            return log('Groq', { status: 'warn', label: 'Failed', detail: `HTTP ${r.status}` });
            return log('Groq', { status: 'ok', label: 'Connected', detail: model });
        } catch (e) {
            return log('Groq', { status: 'fail', label: 'Unreachable', detail: e.message });
        }
    }

    async function checkClaude() {
        const enabled = localStorage.getItem('frankieClaudeEnabled') !== 'false';
        if (!enabled) return log('Claude', { status: 'warn', label: 'Disabled', detail: 'Turned off in SCC Settings' });
        const model = localStorage.getItem(LS.claudeModel) || 'claude-sonnet-4-6';
        try {
            const r = await fetch(`${WORKER}/claude/v1/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
            });
            if (r.status === 401) return log('Claude', { status: 'fail', label: 'Key error', detail: 'Check CLAUDE_KEY in Cloudflare Worker' });
            if (r.status === 429) return log('Claude', { status: 'warn', label: 'Rate limited', detail: 'Key valid but rate-limited' });
            if (!r.ok)            return log('Claude', { status: 'warn', label: 'Failed', detail: `HTTP ${r.status}` });
            return log('Claude', { status: 'ok', label: 'Connected', detail: model });
        } catch (e) {
            return log('Claude', { status: 'fail', label: 'Unreachable', detail: e.message });
        }
    }

    function log(name, result) {
        console.log(`${name}:`, result);
        return result;
    }

    // ── Render ────────────────────────────────────────────────────────────

    function renderRow(name, result) {
        const s = result.status || 'fail'; // ok | warn | fail
        return `
          <div class="bc-row">
            <span class="bc-bolt">⚡</span>
            <div class="bc-row-body">
              <div class="bc-row-head">
                <span class="bc-row-name">${name}</span>
                <span class="bc-pill bc-pill--${s}">${result.label}</span>
              </div>
              <div class="bc-row-detail">${result.detail || ''}</div>
            </div>
          </div>`;
    }

    // ── Update the topbar button ──────────────────────────────────────────

    function updateStatusBtn(checks) {
        const btn   = document.getElementById('statusToggleBtn');
        const dot   = document.getElementById('statusBtnDot');
        const label = document.getElementById('statusBtnLabel');
        if (!btn) return;

        const allOk   = checks.every(c => c.status === 'ok');
        const anyFail = checks.some(c => c.status === 'fail');
        const overall = allOk ? 'ok' : anyFail ? 'fail' : 'warn';
        const labels  = { ok: 'All systems go', warn: 'Partial — check status', fail: 'Needs attention' };

        if (dot) {
            dot.textContent = '⚡';
            dot.className   = `bc-status-dot bc-status-dot--${overall}`;
        }
        if (label) {
            label.textContent = labels[overall];
            label.className   = `bc-status-label bc-status-label--${overall}`;
        }
    }

    // ── Main run ──────────────────────────────────────────────────────────

    window.runBrainCheck = async function () {
        const out = document.getElementById('brainStatusOutput');
        if (!out) return;

        out.innerHTML = '<div class="bc-loading">Running checks…</div>';

        const [brain, stitches, embedMode, groq, claude] = await Promise.all([
            checkBrain(),
            checkStitches(),
            Promise.resolve(checkEmbedMode()),
            checkGroq(),
            checkClaude(),
        ]);

        const checks   = [brain, stitches, embedMode, groq, claude];
        updateStatusBtn(checks);

        const allOk    = checks.every(c => c.status === 'ok');
        const coreOk   = brain.status === 'ok' && stitches.status === 'ok';
        const overallS = allOk ? 'ok' : !coreOk ? 'fail' : 'warn';
        const overallTxt = {
            ok:   '⚡ Frankie v3.0 — Unified Brain active',
            warn: '⚡ Running — some APIs not connected',
            fail: '⚡ Core files missing — check KB',
        }[overallS];

        const ts = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        out.innerHTML = `
          <div class="bc-panel">
            ${renderRow('Brain', brain)}
            ${renderRow('Stitches (vectors file)', stitches)}
            ${renderRow('Embed mode', embedMode)}
            ${renderRow('Bolts (Groq)', groq)}
            ${renderRow('X-Ray Spex (Claude)', claude)}
            <div class="bc-overall bc-overall--${overallS}">${overallTxt}</div>
            <div class="bc-footer">
              Last checked ${ts} · <button class="bc-refresh-btn" onclick="window.runBrainCheck()">Refresh</button>
            </div>
          </div>`;
    };

    // ── Toggle wiring ─────────────────────────────────────────────────────

    window.addEventListener('load', () => {
        const btn      = document.getElementById('statusToggleBtn');
        const dropdown = document.getElementById('statusDropdown');

        if (btn && dropdown) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = !dropdown.hidden;
                dropdown.hidden = open;
                btn.setAttribute('aria-expanded', String(!open));
            });

            document.addEventListener('click', (e) => {
                if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== btn) {
                    dropdown.hidden = true;
                    btn.setAttribute('aria-expanded', 'false');
                }
            });
        }

        setTimeout(window.runBrainCheck, 1000);
    });

}());
