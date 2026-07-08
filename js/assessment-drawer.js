// ── Frankie Self-Assessment Drawer  v1.0 ─────────────────────────────────────
// Loads assessment_data.json, walks user through scored BE or F4N questions
// section by section, then shows a results summary with per-section scores.
//
// Usage:
//   AssessmentDrawer.open('be')   → Business Excellence assessment
//   AssessmentDrawer.open('f4n')  → Fit for Nuclear assessment
//   AssessmentDrawer.close()

(function () {
    'use strict';

    const DATA_FILE = 'kb/assessment_data.json';

    const TYPE_LABELS = {
        be:  'Business Excellence',
        f4n: 'Fit for Nuclear',
    };

    const SCORE_COLOURS = [
        { min: 0,  max: 39,  col: '#e05252', label: 'Needs attention' },
        { min: 40, max: 59,  col: '#e09a3a', label: 'Developing'      },
        { min: 60, max: 79,  col: '#d4c124', label: 'Progressing'     },
        { min: 80, max: 100, col: '#4caf7d', label: 'Strong'          },
    ];

    let DATA      = null;
    let loading   = false;
    let state     = { type: 'be', sectionIdx: 0, answers: {} };

    // ── DOM injection ──────────────────────────────────────────────────────────
    function injectDrawer() {
        if (document.getElementById('assessment-drawer')) return;
        const el = document.createElement('div');
        el.id        = 'assessment-drawer';
        el.className = 'assess-drawer assess-drawer--closed';
        el.innerHTML = `
          <div class="assess-backdrop" id="assessBackdrop"></div>
          <div class="assess-panel">
            <div class="assess-topbar">
              <span class="assess-icon">📋</span>
              <div class="assess-title" id="assessTitle">Self Assessment</div>
              <button class="assess-close" id="assessClose" aria-label="Close">✕</button>
            </div>

            <div class="assess-type-bar" id="assessTypeBar">
              <button class="assess-type-btn" data-type="be"  type="button">Business Excellence</button>
              <button class="assess-type-btn" data-type="f4n" type="button">Fit for Nuclear</button>
            </div>

            <div class="assess-section-bar" id="assessSectionBar"></div>

            <div class="assess-body" id="assessBody">
              <div class="assess-loading">Loading assessment…</div>
            </div>

            <div class="assess-footer" id="assessFooter">
              <button class="assess-nav" id="assessPrev" type="button">← Back</button>
              <span class="assess-footer-score" id="assessFooterScore"></span>
              <button class="assess-nav assess-nav--primary" id="assessNext" type="button">Next →</button>
            </div>
          </div>`;
        document.body.appendChild(el);

        document.getElementById('assessClose').addEventListener('click', close);
        document.getElementById('assessBackdrop').addEventListener('click', close);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

        document.getElementById('assessTypeBar').addEventListener('click', e => {
            const btn = e.target.closest('.assess-type-btn');
            if (!btn || !DATA) return;
            switchType(btn.dataset.type);
        });

        document.getElementById('assessPrev').addEventListener('click', () => navigate(-1));
        document.getElementById('assessNext').addEventListener('click', () => navigate(1));
    }

    // ── Data ───────────────────────────────────────────────────────────────────
    async function loadData() {
        if (DATA) return DATA;
        if (loading) return null;
        loading = true;
        try {
            const res = await fetch(DATA_FILE);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            DATA    = await res.json();
            loading = false;
            return DATA;
        } catch (e) {
            loading = false;
            console.error('[AssessmentDrawer]', e);
            return null;
        }
    }

    // ── State helpers ──────────────────────────────────────────────────────────
    function sections() {
        return DATA ? Object.entries(DATA[state.type] || {}) : [];
    }

    function currentSection() {
        return sections()[state.sectionIdx] || null;
    }

    function answerKey(sIdx, qIdx) { return `${state.type}:${sIdx}:${qIdx}`; }

    function sectionScore(sIdx) {
        const [, sec] = sections()[sIdx] || [];
        if (!sec) return { score: 0, max: 0 };
        let score = 0, max = 0;
        sec.questions.forEach((q, qIdx) => {
            const sel = state.answers[answerKey(sIdx, qIdx)];
            const maxOpt = Math.max(...q.options.map(o => o.score));
            max += maxOpt;
            if (sel !== undefined) score += q.options[sel]?.score || 0;
        });
        return { score, max };
    }

    function totalScore() {
        let score = 0, max = 0;
        sections().forEach((_, i) => {
            const s = sectionScore(i);
            score += s.score; max += s.max;
        });
        return { score, max };
    }

    function pct(score, max) {
        return max ? Math.round(score / max * 100) : 0;
    }

    function scoreColour(p) {
        return (SCORE_COLOURS.find(c => p >= c.min && p <= c.max) || SCORE_COLOURS[3]).col;
    }

    function scoreLabel(p) {
        return (SCORE_COLOURS.find(c => p >= c.min && p <= c.max) || SCORE_COLOURS[3]).label;
    }

    // ── Switch type ────────────────────────────────────────────────────────────
    function switchType(type) {
        state = { type, sectionIdx: 0, answers: {} };
        renderAll();
    }

    function navigate(dir) {
        const secs = sections();
        const next = state.sectionIdx + dir;
        if (next >= secs.length) {
            renderResults();
            return;
        }
        if (next < 0) return;
        state.sectionIdx = next;
        renderSection();
    }

    // ── Render ─────────────────────────────────────────────────────────────────
    function renderAll() {
        updateTypeBar();
        renderSectionBar();
        renderSection();
    }

    function updateTypeBar() {
        document.querySelectorAll('.assess-type-btn').forEach(b => {
            b.classList.toggle('assess-type-btn--active', b.dataset.type === state.type);
        });
    }

    function renderSectionBar() {
        const bar = document.getElementById('assessSectionBar');
        if (!bar) return;
        bar.innerHTML = sections().map(([name], i) => {
            const { score, max } = sectionScore(i);
            const p = pct(score, max);
            const active = i === state.sectionIdx;
            return `<button class="assess-sec-pill${active ? ' assess-sec-pill--active' : ''}"
                      data-idx="${i}" type="button" title="${esc(name)}">
                      <span>${esc(shortName(name))}</span>
                      ${max ? `<span class="assess-sec-pct" style="color:${scoreColour(p)}">${p}%</span>` : ''}
                    </button>`;
        }).join('');
        bar.querySelectorAll('.assess-sec-pill').forEach(b => {
            b.addEventListener('click', () => {
                state.sectionIdx = parseInt(b.dataset.idx);
                renderSectionBar();
                renderSection();
            });
        });
    }

    function shortName(name) {
        // Abbreviate long section names for the pill bar
        const map = {
            'Strategy & Leadership': 'Strategy',
            'Design & Project Management': 'Design',
            'People Excellence': 'People',
            'Process Excellence': 'Process',
            'Supply Chain and Social Values': 'Supply Chain',
            'Nuclear Industry Fundamentals': 'Fundamentals',
            'Nuclear Safety Culture': 'Safety Culture',
            'Quality and Compliance': 'Quality',
            'Leadership and Governance': 'Leadership',
            'Human Performance': 'Human Perf.',
            'Supply Chain Readiness': 'Supply Chain',
            'Security of Information': 'Security',
        };
        return map[name] || name.split(' ').slice(0,2).join(' ');
    }

    function renderSection() {
        const body = document.getElementById('assessBody');
        const title = document.getElementById('assessTitle');
        const footer = document.getElementById('assessFooter');
        if (!body) return;

        const entry = currentSection();
        if (!entry) return;
        const [sectionName, sec] = entry;
        const secs = sections();

        title.textContent = `${TYPE_LABELS[state.type]} — ${sectionName}`;
        footer.style.display = 'flex';

        const prev = document.getElementById('assessPrev');
        const next = document.getElementById('assessNext');
        prev.style.visibility = state.sectionIdx === 0 ? 'hidden' : 'visible';
        const isLast = state.sectionIdx === secs.length - 1;
        next.textContent = isLast ? 'See results →' : 'Next →';

        let html = `<div class="assess-section-intro">
            <h3 class="assess-section-name">${esc(sectionName)}</h3>
            <p class="assess-section-count">${sec.questions.length} questions · select the option that best describes your organisation</p>
          </div>`;

        sec.questions.forEach((q, qIdx) => {
            const key = answerKey(state.sectionIdx, qIdx);
            const selected = state.answers[key];
            html += `<div class="assess-question" data-qidx="${qIdx}">
              <div class="assess-q-text">${esc(q.statement)}</div>
              ${q.topic ? `<div class="assess-q-topic">${esc(q.topic)}</div>` : ''}
              <div class="assess-options">`;

            q.options.forEach((opt, oIdx) => {
                const isSelected = selected === oIdx;
                html += `<button class="assess-option${isSelected ? ' assess-option--selected' : ''}"
                           data-qidx="${qIdx}" data-oidx="${oIdx}" type="button">
                           <span class="assess-opt-score">${opt.score}</span>
                           <span class="assess-opt-desc">${esc(opt.desc)}</span>
                         </button>`;
            });

            html += `</div>`;

            // Show feedback for selected option
            if (selected !== undefined) {
                const opt = q.options[selected];
                const maxScore = Math.max(...q.options.map(o => o.score));
                const p = pct(opt.score, maxScore);
                html += `<div class="assess-feedback" style="border-left-color:${scoreColour(p)}">
                           ${opt.feedback ? esc(opt.feedback) : ''}
                           ${q.handbookUrl ? `<a class="assess-hb-link" href="${esc(q.handbookUrl)}" target="_blank" rel="noopener">📖 View in handbook →</a>` : ''}
                         </div>`;
            }

            html += `</div>`; // close assess-question
        });

        body.innerHTML = html;
        updateFooterScore();

        // Option click handler
        body.querySelectorAll('.assess-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const qIdx = parseInt(btn.dataset.qidx);
                const oIdx = parseInt(btn.dataset.oidx);
                const key  = answerKey(state.sectionIdx, qIdx);
                state.answers[key] = oIdx;
                renderSection();
                renderSectionBar();
            });
        });
    }

    function updateFooterScore() {
        const el = document.getElementById('assessFooterScore');
        if (!el) return;
        const { score, max } = sectionScore(state.sectionIdx);
        const answered = sections()[state.sectionIdx]?.[1].questions.filter((_, i) =>
            state.answers[answerKey(state.sectionIdx, i)] !== undefined
        ).length || 0;
        const total = sections()[state.sectionIdx]?.[1].questions.length || 0;
        const p = pct(score, max);
        el.innerHTML = max
            ? `<span style="color:${scoreColour(p)}">${score}/${max}</span> &nbsp;·&nbsp; ${answered}/${total} answered`
            : `${answered}/${total} answered`;
    }

    // ── Results ────────────────────────────────────────────────────────────────
    function renderResults() {
        const body  = document.getElementById('assessBody');
        const title = document.getElementById('assessTitle');
        const footer = document.getElementById('assessFooter');
        if (!body) return;

        title.textContent = `${TYPE_LABELS[state.type]} — Results`;
        footer.style.display = 'none';

        const { score, max } = totalScore();
        const p = pct(score, max);
        const col = scoreColour(p);
        const lbl = scoreLabel(p);

        // Section breakdown
        const sectionRows = sections().map(([name], i) => {
            const s = sectionScore(i);
            const sp = pct(s.score, s.max);
            const sc = scoreColour(sp);
            return { name, ...s, pct: sp, col: sc };
        }).sort((a,b) => a.pct - b.pct);

        let html = `
          <div class="assess-results">
            <div class="assess-results-hero">
              <div class="assess-results-ring" style="--col:${col}">
                <span class="assess-ring-pct">${p}%</span>
                <span class="assess-ring-lbl">${lbl}</span>
              </div>
              <div class="assess-results-summary">
                <div class="assess-results-total">${score} / ${max}</div>
                <div class="assess-results-sub">Overall score · ${TYPE_LABELS[state.type]}</div>
              </div>
            </div>

            <h4 class="assess-results-section-hd">Section breakdown</h4>
            ${sectionRows.map(r => `
              <div class="assess-results-row">
                <div class="assess-results-row-name">${esc(r.name)}</div>
                <div class="assess-results-bar-wrap">
                  <div class="assess-results-bar" style="width:${r.pct}%;background:${r.col}"></div>
                </div>
                <div class="assess-results-row-score" style="color:${r.col}">${r.pct}%</div>
              </div>`).join('')}

            <h4 class="assess-results-section-hd">Priority improvements</h4>
            ${sectionRows.slice(0,3).map(r => `
              <div class="assess-priority-card" style="border-left-color:${r.col}">
                <div class="assess-priority-name">${esc(r.name)}</div>
                <div class="assess-priority-score">${r.score}/${r.max} (${r.pct}%) — ${scoreLabel(r.pct)}</div>
              </div>`).join('')}

            <button class="assess-restart-btn" id="assessRestart" type="button">Start again</button>
          </div>`;

        body.innerHTML = html;

        document.getElementById('assessRestart').addEventListener('click', () => {
            state = { type: state.type, sectionIdx: 0, answers: {} };
            renderAll();
            document.getElementById('assessFooter').style.display = 'flex';
        });
    }

    // ── Utils ──────────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    async function open(type) {
        injectDrawer();

        const drawer = document.getElementById('assessment-drawer');
        const body   = document.getElementById('assessBody');

        drawer.classList.remove('assess-drawer--closed');
        drawer.classList.add('assess-drawer--open');
        body.innerHTML = '<div class="assess-loading">Loading questions…</div>';
        document.getElementById('assessFooter').style.display = 'none';

        const data = await loadData();
        if (!data) {
            body.innerHTML = '<div class="assess-loading">⚠ Could not load assessment data.</div>';
            return;
        }

        state = { type: type || 'be', sectionIdx: 0, answers: {} };
        renderAll();
        document.getElementById('assessFooter').style.display = 'flex';
    }

    function close() {
        const drawer = document.getElementById('assessment-drawer');
        if (drawer) {
            drawer.classList.remove('assess-drawer--open');
            drawer.classList.add('assess-drawer--closed');
        }
    }

    window.AssessmentDrawer = { open, close };

}());
