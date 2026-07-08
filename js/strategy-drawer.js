/**
 * strategy-drawer.js  v1.0
 * Business Strategy Builder (Feature 15)
 * 4-step guided flow → full strategy document to F4N SL-01 standard.
 * Flow: context → identity → SWOT → objectives → loading → result
 */
(function () {
  'use strict';

  var DRAWER_ID = 'strategy-drawer';

  var NUCLEAR_SECTORS = [
    { id: 'machining',    label: '⚙️ Precision Machining' },
    { id: 'fabrication',  label: '🔩 Fabrication & Welding' },
    { id: 'electrical',   label: '⚡ Electrical & Instrumentation' },
    { id: 'engineering',  label: '📐 Engineering & Design' },
    { id: 'inspection',   label: '🔍 Inspection & Testing' },
    { id: 'logistics',    label: '🚚 Logistics & Supply' },
    { id: 'software',     label: '💻 Software & Digital' },
    { id: 'services',     label: '🛠️ Maintenance & Services' },
    { id: 'materials',    label: '🧱 Materials & Composites' },
    { id: 'other',        label: '✏️ Other' },
  ];

  var STRATEGIC_THEMES = [
    { id: 'nuclear_growth',  label: '⚛️ Grow nuclear revenue',        hint: 'Win more nuclear contracts, new customers' },
    { id: 'accreditation',   label: '📜 Achieve accreditations',       hint: 'ISO 9001, AS9100, Fit for Nuclear' },
    { id: 'quality',         label: '🎯 Improve quality performance',   hint: 'Reduce NCRs, increase RFT, earn customer trust' },
    { id: 'people',          label: '👥 Develop our people',            hint: 'Skills, SQEP, succession, culture' },
    { id: 'operations',      label: '⚙️ Operational excellence',        hint: 'Lean, SQDCP, efficiency, capacity' },
    { id: 'innovation',      label: '💡 Innovation & technology',       hint: 'New capabilities, digital, automation' },
    { id: 'sustainability',  label: '🌱 Sustainability & social value', hint: 'Net zero, social value, ESG commitments' },
    { id: 'financial',       label: '💷 Financial growth & resilience', hint: 'Revenue targets, margins, investment' },
    { id: 'supply_chain',    label: '🔗 Supply chain development',      hint: 'Supplier qualification, partnerships' },
    { id: 'customer',        label: '🤝 Customer & market development', hint: 'New markets, customer relationships, diversification' },
  ];

  var HORIZONS = [
    { id: '1yr',  label: '1 Year',   desc: 'Immediate priorities and quick wins' },
    { id: '3yr',  label: '3 Years',  desc: 'Medium-term growth and improvement' },
    { id: '5yr',  label: '5 Years',  desc: 'Long-term vision and transformation' },
  ];

  var state = {
    phase: 'context',
    // Step 1
    companyName:   '',
    sector:        null,
    employees:     '',
    yearsFounded:  '',
    nuclearYears:  '',
    currentPos:    '',
    horizon:       '3yr',
    // Step 2 — Identity
    mission:       '',
    vision:        '',
    values:        '',
    // Step 3 — SWOT
    strengths:     '',
    weaknesses:    '',
    opportunities: '',
    threats:       '',
    // Step 4 — Objectives
    themes:        [],
    objectives:    '',
    // Result
    resultJson: null,
    error:      null,
  };

  // ── Public API ──────────────────────────────────────────────────────────────

  window.StrategyDrawer = {
    open: function () {
      injectDrawer();
      state.companyName = localStorage.getItem('strategy_company') || '';
      state.phase       = 'context';
      state.sector      = null;
      state.themes      = [];
      state.resultJson  = null;
      state.error       = null;
      renderPhase();
      var drawer = document.getElementById(DRAWER_ID);
      drawer.classList.remove('assess-drawer--closed');
      drawer.classList.add('assess-drawer--open');
    }
  };

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function $id(id)    { return document.getElementById(id); }
  function setBody(h) { var el = $id('strategy-body'); if (el) el.innerHTML = h; }
  function val(id)    { var el = $id(id); return el ? (el.value || '').trim() : ''; }

  // ── Drawer injection ────────────────────────────────────────────────────────

  function injectDrawer() {
    if ($id(DRAWER_ID)) return;
    var el = document.createElement('div');
    el.id        = DRAWER_ID;
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML =
      '<div class="assess-backdrop" id="stratBackdrop"></div>' +
      '<div class="assess-panel">' +
        '<div class="assess-topbar">' +
          '<span class="assess-icon">🏆</span>' +
          '<div class="assess-title">Business Strategy Builder</div>' +
          '<button class="assess-close" id="stratClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="strat-progress" id="strat-progress"></div>' +
        '<div class="assess-body" id="strategy-body"></div>' +
      '</div>';
    document.body.appendChild(el);
    $id('stratClose').addEventListener('click', closeDrawer);
    $id('stratBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  }

  function closeDrawer() {
    var d = $id(DRAWER_ID);
    if (d) { d.classList.remove('assess-drawer--open'); d.classList.add('assess-drawer--closed'); }
  }

  // ── Progress ────────────────────────────────────────────────────────────────

  var PHASES      = ['context', 'identity', 'swot', 'objectives', 'result'];
  var STEP_LABELS = ['Context', 'Identity', 'SWOT', 'Objectives', 'Strategy'];

  function renderProgress() {
    var el = $id('strat-progress');
    if (!el) return;
    if (state.phase === 'loading') { el.innerHTML = ''; return; }
    var idx = PHASES.indexOf(state.phase);
    var inner = PHASES.map(function (p, i) {
      if (i === 4 && state.phase !== 'result') return '';
      var active = i === idx ? ' strat-step--active' : '';
      var done   = i < idx  ? ' strat-step--done'   : '';
      return '<div class="strat-step' + active + done + '">' +
        '<div class="strat-step-dot">' + (i < idx ? '✓' : (i + 1)) + '</div>' +
        '<div class="strat-step-label">' + STEP_LABELS[i] + '</div>' +
      '</div>' + (i < PHASES.length - 1 ? '<div class="strat-step-line"></div>' : '');
    }).join('');
    el.innerHTML = '<div class="strat-progress-inner">' + inner + '</div>';
  }

  // ── Render router ───────────────────────────────────────────────────────────

  function renderPhase() {
    renderProgress();
    if      (state.phase === 'context')    renderContext();
    else if (state.phase === 'identity')   renderIdentity();
    else if (state.phase === 'swot')       renderSwot();
    else if (state.phase === 'objectives') renderObjectives();
    else if (state.phase === 'loading')    renderLoading();
    else if (state.phase === 'result')     renderResult();
  }

  // ── Step 1: Context ─────────────────────────────────────────────────────────

  function renderContext() {
    var sectorCards = NUCLEAR_SECTORS.map(function (s) {
      var active = state.sector === s.id ? ' strat-sector--active' : '';
      return '<button type="button" class="strat-sector-card' + active + '" data-sector="' + s.id + '">' +
        esc(s.label) +
      '</button>';
    }).join('');

    var horizonCards = HORIZONS.map(function (h) {
      var active = state.horizon === h.id ? ' strat-horizon--active' : '';
      return '<button type="button" class="strat-horizon-card' + active + '" data-horizon="' + h.id + '">' +
        '<div class="strat-horizon-label">' + esc(h.label) + '</div>' +
        '<div class="strat-horizon-desc">'  + esc(h.desc)  + '</div>' +
      '</button>';
    }).join('');

    setBody(
      '<div class="strat-intro"><p>Build a complete business strategy document to <strong>NuCCoL F4N SL-01 standard</strong> — covering mission, vision, values, SWOT analysis, strategic objectives, and KPIs. This is the highest-value F4N document you can produce.</p></div>' +

      '<div class="strat-section-title">Company Basics</div>' +
      '<div class="strat-fields">' +
        field('Company Name', 'strat-company', 'e.g. Precision Nuclear Ltd', state.companyName) +
        field('Number of Employees', 'strat-employees', 'e.g. 45', state.employees) +
        field('Year Founded', 'strat-founded', 'e.g. 2008', state.yearsFounded) +
        field('Years supplying the nuclear sector', 'strat-nucyears', 'e.g. 6', state.nuclearYears) +
        field('Brief description — what do you do and who for?', 'strat-pos',
          'e.g. We manufacture precision-machined components for nuclear decommissioning projects, supplying Tier 1 contractors across the UK.',
          state.currentPos, true) +
      '</div>' +

      '<div class="strat-section-title" style="margin-top:16px">Your Primary Sector</div>' +
      '<div class="strat-sector-grid">' + sectorCards + '</div>' +

      '<div class="strat-section-title" style="margin-top:16px">Strategy Horizon</div>' +
      '<div class="strat-horizon-grid">' + horizonCards + '</div>' +

      (state.error ? '<div class="strat-error">' + esc(state.error) + '</div>' : '') +

      '<div class="strat-nav-row">' +
        '<button class="assess-nav assess-nav--primary" id="stratNext1" type="button">Next: Mission, Vision &amp; Values →</button>' +
      '</div>'
    );

    document.querySelectorAll('.strat-sector-card').forEach(function (card) {
      card.addEventListener('click', function () {
        state.sector = card.dataset.sector;
        document.querySelectorAll('.strat-sector-card').forEach(function (c) { c.classList.remove('strat-sector--active'); });
        card.classList.add('strat-sector--active');
      });
    });
    document.querySelectorAll('.strat-horizon-card').forEach(function (card) {
      card.addEventListener('click', function () {
        state.horizon = card.dataset.horizon;
        document.querySelectorAll('.strat-horizon-card').forEach(function (c) { c.classList.remove('strat-horizon--active'); });
        card.classList.add('strat-horizon--active');
      });
    });

    $id('stratNext1').addEventListener('click', function () {
      state.companyName  = val('strat-company');
      state.employees    = val('strat-employees');
      state.yearsFounded = val('strat-founded');
      state.nuclearYears = val('strat-nucyears');
      state.currentPos   = val('strat-pos');
      state.error = null;
      if (!state.companyName) { state.error = 'Please enter your company name.';  renderContext(); return; }
      if (!state.currentPos)  { state.error = 'Please describe what you do.';     renderContext(); return; }
      if (!state.sector)      { state.error = 'Please select your primary sector.'; renderContext(); return; }
      localStorage.setItem('strategy_company', state.companyName);
      state.phase = 'identity';
      renderPhase();
    });
  }

  // ── Step 2: Mission, Vision, Values ────────────────────────────────────────

  function renderIdentity() {
    setBody(
      '<div class="strat-mvv-guide">' +
        '<div class="strat-mvv-card strat-mvv-mission">' +
          '<div class="strat-mvv-badge">Mission</div>' +
          '<div class="strat-mvv-def">Why we exist — what we do, for whom, and what difference we make <em>today</em>.</div>' +
          '<div class="strat-mvv-eg">e.g. "To deliver precision-engineered components that nuclear operators can rely on absolutely."</div>' +
        '</div>' +
        '<div class="strat-mvv-card strat-mvv-vision">' +
          '<div class="strat-mvv-badge strat-mvv-badge--vision">Vision</div>' +
          '<div class="strat-mvv-def">What we want to become — our ambition for the <em>future</em> (aligned to your horizon).</div>' +
          '<div class="strat-mvv-eg">e.g. "To be the first-choice precision machining partner for the UK SMR programme by 2030."</div>' +
        '</div>' +
        '<div class="strat-mvv-card strat-mvv-values">' +
          '<div class="strat-mvv-badge strat-mvv-badge--values">Values</div>' +
          '<div class="strat-mvv-def">How we behave — the principles that guide every decision and action.</div>' +
          '<div class="strat-mvv-eg">e.g. "Safety first. Precision always. People matter. Continuous improvement."</div>' +
        '</div>' +
      '</div>' +

      '<div class="strat-fields">' +
        field('Our Mission', 'strat-mission',
          'Why we exist — what we do and for whom.',
          state.mission, true) +
        field('Our Vision', 'strat-vision',
          'What we want to become in ' + (state.horizon === '1yr' ? '1 year' : state.horizon === '3yr' ? '3 years' : '5 years') + '.',
          state.vision, true) +
        field('Our Values (list them, separated by commas or on new lines)', 'strat-values',
          'e.g. Safety First, Precision Always, People Matter, Continuous Improvement, Integrity',
          state.values, true) +
      '</div>' +

      '<div class="strat-mvv-tip">💡 Don\'t overthink these — write what you genuinely believe. Frankie will refine and enrich the language in the final document.</div>' +

      (state.error ? '<div class="strat-error">' + esc(state.error) + '</div>' : '') +

      '<div class="strat-nav-row">' +
        '<button class="assess-nav" id="stratBack2" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="stratNext2" type="button">Next: SWOT Analysis →</button>' +
      '</div>'
    );

    $id('stratBack2').addEventListener('click', function () { state.phase = 'context'; renderPhase(); });
    $id('stratNext2').addEventListener('click', function () {
      state.mission = val('strat-mission');
      state.vision  = val('strat-vision');
      state.values  = val('strat-values');
      state.error = null;
      if (!state.mission) { state.error = 'Please write your mission statement.'; renderIdentity(); return; }
      if (!state.vision)  { state.error = 'Please write your vision statement.';  renderIdentity(); return; }
      if (!state.values)  { state.error = 'Please enter your core values.';        renderIdentity(); return; }
      state.phase = 'swot';
      renderPhase();
    });
  }

  // ── Step 3: SWOT ────────────────────────────────────────────────────────────

  function renderSwot() {
    setBody(
      '<div class="strat-swot-intro"><p>Be honest and specific — the more real you are here, the more useful your strategy will be.</p></div>' +

      '<div class="strat-swot-grid">' +

        '<div class="strat-swot-cell strat-swot-s">' +
          '<div class="strat-swot-label">💪 Strengths</div>' +
          '<div class="strat-swot-hint">Internal advantages — what you do better than competitors</div>' +
          '<textarea class="strat-swot-input" id="strat-strengths" rows="5" ' +
            'placeholder="e.g. Long-standing customer relationships with Tier 1s\nExperienced and stable workforce\nISO 9001 certified and Fit for Nuclear accredited\nFlexible low-volume high-complexity capability">' +
            esc(state.strengths) + '</textarea>' +
        '</div>' +

        '<div class="strat-swot-cell strat-swot-w">' +
          '<div class="strat-swot-label">⚠️ Weaknesses</div>' +
          '<div class="strat-swot-hint">Internal limitations — what holds you back</div>' +
          '<textarea class="strat-swot-input" id="strat-weaknesses" rows="5" ' +
            'placeholder="e.g. Over-reliant on 2 key customers\nLimited capacity for large orders\nNo formal succession plan for senior engineers\nOlder machine tools limiting tolerance capability">' +
            esc(state.weaknesses) + '</textarea>' +
        '</div>' +

        '<div class="strat-swot-cell strat-swot-o">' +
          '<div class="strat-swot-label">🚀 Opportunities</div>' +
          '<div class="strat-swot-hint">External factors you can exploit</div>' +
          '<textarea class="strat-swot-input" id="strat-opportunities" rows="5" ' +
            'placeholder="e.g. UK SMR programme creating significant new demand\nGovernment nuclear skills shortage opening apprenticeship funding\nTier 1 consolidating supply chains — opportunity to become preferred supplier\nCompetitor exiting the market">' +
            esc(state.opportunities) + '</textarea>' +
        '</div>' +

        '<div class="strat-swot-cell strat-swot-t">' +
          '<div class="strat-swot-label">⚡ Threats</div>' +
          '<div class="strat-swot-hint">External risks you need to manage</div>' +
          '<textarea class="strat-swot-input" id="strat-threats" rows="5" ' +
            'placeholder="e.g. Cost inflation eroding margins\nIncreasing regulatory requirements raising compliance burden\nSkilled labour shortages in the region\nKey customer reviewing supply chain">' +
            esc(state.threats) + '</textarea>' +
        '</div>' +

      '</div>' +

      (state.error ? '<div class="strat-error">' + esc(state.error) + '</div>' : '') +

      '<div class="strat-nav-row">' +
        '<button class="assess-nav" id="stratBack3" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="stratNext3" type="button">Next: Objectives &amp; KPIs →</button>' +
      '</div>'
    );

    $id('stratBack3').addEventListener('click', function () { state.phase = 'identity'; renderPhase(); });
    $id('stratNext3').addEventListener('click', function () {
      state.strengths     = val('strat-strengths');
      state.weaknesses    = val('strat-weaknesses');
      state.opportunities = val('strat-opportunities');
      state.threats       = val('strat-threats');
      state.error = null;
      if (!state.strengths || !state.weaknesses || !state.opportunities || !state.threats) {
        state.error = 'Please complete all four SWOT quadrants.'; renderSwot(); return;
      }
      state.phase = 'objectives';
      renderPhase();
    });
  }

  // ── Step 4: Objectives ──────────────────────────────────────────────────────

  function renderObjectives() {
    var themeCards = STRATEGIC_THEMES.map(function (t) {
      var active = state.themes.indexOf(t.id) > -1 ? ' strat-theme--active' : '';
      return '<button type="button" class="strat-theme-card' + active + '" data-theme="' + t.id + '">' +
        '<div class="strat-theme-label">' + esc(t.label) + '</div>' +
        '<div class="strat-theme-hint">'  + esc(t.hint)  + '</div>' +
      '</button>';
    }).join('');

    var horizonLabel = state.horizon === '1yr' ? '1-year' : state.horizon === '3yr' ? '3-year' : '5-year';

    setBody(
      '<div class="strat-section-title">Strategic Themes (pick 3–5 that matter most)</div>' +
      '<div class="strat-theme-grid">' + themeCards + '</div>' +

      '<div class="strat-fields" style="margin-top:16px">' +
        field('Any specific goals or targets you want included?', 'strat-objectives',
          'e.g. Reach £5m revenue by 2028; achieve AS9100 by end of 2026; win a direct nuclear contract; recruit 3 apprentices per year; reduce energy use by 20%',
          state.objectives, true) +
      '</div>' +

      '<div class="strat-info-box">💡 Frankie will build a full <strong>' + horizonLabel + ' strategy document</strong> with: executive summary, market context, mission/vision/values, SWOT analysis, strategic pillars, SMART objectives with KPIs, implementation roadmap, and resource requirements. This maps directly to <strong>F4N SL-01</strong> scoring criteria.</div>' +

      (state.error ? '<div class="strat-error">' + esc(state.error) + '</div>' : '') +

      '<div class="strat-nav-row">' +
        '<button class="assess-nav" id="stratBack4" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="stratGenerate" type="button">✨ Build My Strategy →</button>' +
      '</div>'
    );

    document.querySelectorAll('.strat-theme-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var id  = card.dataset.theme;
        var idx = state.themes.indexOf(id);
        if (idx > -1) { state.themes.splice(idx, 1); card.classList.remove('strat-theme--active'); }
        else           { state.themes.push(id);       card.classList.add('strat-theme--active'); }
      });
    });

    $id('stratBack4').addEventListener('click', function () { state.phase = 'swot'; renderPhase(); });
    $id('stratGenerate').addEventListener('click', function () {
      state.objectives = val('strat-objectives');
      state.error = null;
      if (state.themes.length < 2) { state.error = 'Please select at least 2 strategic themes.'; renderObjectives(); return; }
      var claudeKey = localStorage.getItem('frankieClaudeKey') || '';
      if (!claudeKey) { state.error = 'No Claude API key found. Please add it in Frankie settings.'; renderObjectives(); return; }
      state.phase = 'loading';
      renderPhase();
      generate(claudeKey);
    });
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  function renderLoading() {
    setBody(
      '<div class="assess-loading">' +
        '<div class="strat-spinner"></div>' +
        '<p><strong>Building your strategy document…</strong></p>' +
        '<p class="strat-loading-sub">Frankie is synthesising your SWOT, objectives, and F4N SL-01 criteria. This takes around 25 seconds.</p>' +
      '</div>'
    );
  }

  // ── Result ──────────────────────────────────────────────────────────────────

  function renderResult() {
    var r = state.resultJson;
    if (!r) { setBody('<div class="strat-error">No strategy returned — please try again.</div>'); return; }

    var today        = new Date().toLocaleDateString('en-GB');
    var horizonLabel = state.horizon === '1yr' ? '1-Year' : state.horizon === '3yr' ? '3-Year' : '5-Year';

    function sec(num, title, content, cls) {
      return '<div class="strat-result-section">' +
        '<div class="strat-result-label' + (cls ? ' ' + cls : '') + '">' + num + '. ' + esc(title) + '</div>' +
        '<div class="strat-result-content">' + content + '</div>' +
      '</div>';
    }
    function li(items, colour) {
      if (!items || !items.length) return '<p>—</p>';
      return '<ul class="strat-ul">' + items.map(function (i) {
        return '<li>' + (colour ? '<span style="color:' + colour + '">●</span> ' : '') + esc(i) + '</li>';
      }).join('') + '</ul>';
    }
    function swotBox(label, items, colour, bg) {
      return '<div class="strat-swot-result-cell" style="border-top-color:' + colour + ';background:' + bg + '">' +
        '<div class="strat-swot-result-label" style="color:' + colour + '">' + label + '</div>' +
        li(items) +
      '</div>';
    }

    // Strategic pillars
    var pillars = (r.pillars || []).map(function (p, i) {
      var colours = ['#1F3A5F', '#C0392B', '#E67E22', '#27AE60', '#8E44AD'];
      var c = colours[i % colours.length];
      var objs = (p.objectives || []).map(function (o) {
        return '<div class="strat-objective">' +
          '<div class="strat-obj-title">' + esc(o.objective || '') + '</div>' +
          '<div class="strat-obj-kpi"><strong>KPI:</strong> ' + esc(o.kpi || '') + '</div>' +
          '<div class="strat-obj-target"><strong>Target:</strong> ' + esc(o.target || '') + '</div>' +
          '<div class="strat-obj-owner"><strong>Owner:</strong> ' + esc(o.owner || '') + '</div>' +
        '</div>';
      }).join('');
      return '<div class="strat-pillar-card" style="border-left-color:' + c + '">' +
        '<div class="strat-pillar-header" style="color:' + c + '">' +
          '<span class="strat-pillar-num" style="background:' + c + '">' + (i + 1) + '</span>' +
          esc(p.pillar || '') +
        '</div>' +
        (p.description ? '<p class="strat-pillar-desc">' + esc(p.description) + '</p>' : '') +
        '<div class="strat-objectives-list">' + objs + '</div>' +
      '</div>';
    }).join('');

    // Roadmap
    var roadmapRows = (r.roadmap || []).map(function (row) {
      return '<tr>' +
        '<td><strong>' + esc(row.phase || '') + '</strong></td>' +
        '<td>' + esc(row.timeframe || '') + '</td>' +
        '<td>' + esc(row.priorities || '') + '</td>' +
        '<td>' + esc(row.milestones || '') + '</td>' +
      '</tr>';
    }).join('');

    var html =
      '<div class="strat-result">' +

        '<div class="strat-result-header">' +
          '<div>' +
            '<div class="strat-result-company">' + esc(state.companyName) + '</div>' +
            '<div class="strat-result-title">' + horizonLabel + ' Business Strategy</div>' +
            '<div class="strat-result-sub">Nuclear Supply Chain · F4N SL-01</div>' +
          '</div>' +
          '<div class="strat-result-meta">Version 1.0<br>' + today + '</div>' +
        '</div>' +

        sec(1, 'Executive Summary', '<p class="strat-narrative">' + esc(r.executive_summary || '') + '</p>') +
        sec(2, 'Market Context & Nuclear Opportunity', '<p class="strat-narrative">' + esc(r.market_context || '') + '</p>') +

        '<div class="strat-result-section">' +
          '<div class="strat-result-label">3. Mission, Vision &amp; Values</div>' +
          '<div class="strat-mvv-result">' +
            '<div class="strat-mvv-result-block strat-mvv-m">' +
              '<div class="strat-mvv-result-tag">Mission</div>' +
              '<p>' + esc(r.mission_refined || state.mission) + '</p>' +
            '</div>' +
            '<div class="strat-mvv-result-block strat-mvv-v">' +
              '<div class="strat-mvv-result-tag strat-tag-vision">Vision</div>' +
              '<p>' + esc(r.vision_refined || state.vision) + '</p>' +
            '</div>' +
            '<div class="strat-mvv-result-block strat-mvv-vals">' +
              '<div class="strat-mvv-result-tag strat-tag-values">Values</div>' +
              '<div class="strat-values-grid">' +
                (r.values_list || [state.values]).map(function (v) {
                  return '<div class="strat-value-chip">' + esc(v) + '</div>';
                }).join('') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="strat-result-section">' +
          '<div class="strat-result-label">4. SWOT Analysis</div>' +
          '<div class="strat-swot-result">' +
            swotBox('💪 Strengths',     r.swot && r.swot.strengths,     '#27AE60', '#F0FFF4') +
            swotBox('⚠️ Weaknesses',   r.swot && r.swot.weaknesses,    '#C0392B', '#FFF0EE') +
            swotBox('🚀 Opportunities', r.swot && r.swot.opportunities, '#1F3A5F', '#EEF4FA') +
            swotBox('⚡ Threats',       r.swot && r.swot.threats,       '#E67E22', '#FFF8F0') +
          '</div>' +
          (r.swot_insight ? '<div class="strat-swot-insight">' + esc(r.swot_insight) + '</div>' : '') +
        '</div>' +

        '<div class="strat-result-section">' +
          '<div class="strat-result-label strat-label--orange">5. Strategic Pillars &amp; Objectives</div>' +
          '<div class="strat-pillars">' + pillars + '</div>' +
        '</div>' +

        (roadmapRows
          ? '<div class="strat-result-section">' +
              '<div class="strat-result-label strat-label--green">6. Implementation Roadmap</div>' +
              '<table class="strat-roadmap-table">' +
                '<thead><tr><th>Phase</th><th>Timeframe</th><th>Priorities</th><th>Key Milestones</th></tr></thead>' +
                '<tbody>' + roadmapRows + '</tbody>' +
              '</table>' +
            '</div>'
          : '') +

        (r.resources
          ? sec(7, 'Resource Requirements', '<p class="strat-narrative">' + esc(r.resources) + '</p>')
          : '') +

        (r.f4n_impact
          ? '<div class="strat-f4n-box">' +
              '<div class="strat-f4n-label">📊 F4N SL-01 Impact</div>' +
              '<p>' + esc(r.f4n_impact) + '</p>' +
            '</div>'
          : '') +

        // Sign-off
        '<div class="strat-signoff">' +
          '<div class="strat-result-label">Board Approval</div>' +
          '<table class="strat-signoff-table">' +
            '<thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead>' +
            '<tbody>' +
              '<tr><td>Prepared by</td><td></td><td></td><td>' + today + '</td></tr>' +
              '<tr><td>Reviewed by</td><td></td><td></td><td></td></tr>' +
              '<tr><td>Approved by (Board / MD)</td><td></td><td></td><td></td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>' +

        '<div class="strat-result-footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · SL-01 Strategy Standard</div>' +

        '<div class="strat-action-row">' +
          '<button class="assess-nav" id="stratRestart" type="button">← New Strategy</button>' +
          '<button class="assess-nav assess-nav--primary" id="stratPrint" type="button">🖨️ Print / Save PDF</button>' +
        '</div>' +

      '</div>';

    setBody(html);

    $id('stratRestart').addEventListener('click', function () {
      state.phase = 'context'; state.sector = null; state.themes = [];
      state.resultJson = null; state.error = null;
      renderPhase();
    });
    $id('stratPrint').addEventListener('click', function () { printResult(r, horizonLabel, today, roadmapRows); });
  }

  // ── Claude API ──────────────────────────────────────────────────────────────

  function generate(apiKey) {
    var horizonLabel = state.horizon === '1yr' ? '1 year' : state.horizon === '3yr' ? '3 years' : '5 years';
    var sectorLabel  = (NUCLEAR_SECTORS.filter(function (s) { return s.id === state.sector; })[0] || {}).label || state.sector;
    var themeLabels  = state.themes.map(function (id) {
      var t = STRATEGIC_THEMES.filter(function (x) { return x.id === id; })[0];
      return t ? t.label.replace(/^[^ ]+ /, '') : id;
    }).join(', ');

    var prompt =
      'You are a business strategy consultant specialising in the UK nuclear supply chain and NuCCoL Fit for Nuclear (F4N) programme.\n\n' +
      'Build a complete business strategy document for:\n\n' +
      'Company: ' + state.companyName + '\n' +
      'Sector: ' + sectorLabel + '\n' +
      'Employees: ' + (state.employees || 'Not stated') + '\n' +
      'Founded: ' + (state.yearsFounded || 'Not stated') + '\n' +
      'Years in nuclear supply chain: ' + (state.nuclearYears || 'Not stated') + '\n' +
      'Current position: ' + state.currentPos + '\n' +
      'Strategy horizon: ' + horizonLabel + '\n\n' +
      'Mission: ' + state.mission + '\n' +
      'Vision: ' + state.vision + '\n' +
      'Values: ' + state.values + '\n\n' +
      'SWOT:\n' +
      'Strengths: ' + state.strengths + '\n' +
      'Weaknesses: ' + state.weaknesses + '\n' +
      'Opportunities: ' + state.opportunities + '\n' +
      'Threats: ' + state.threats + '\n\n' +
      'Strategic themes chosen: ' + themeLabels + '\n' +
      (state.objectives ? 'Specific goals/targets: ' + state.objectives + '\n' : '') +
      '\n' +
      'Return ONLY a JSON object — no markdown:\n' +
      '{\n' +
      '  "executive_summary": "compelling 3-4 sentence summary of the company and strategy",\n' +
      '  "market_context": "2-3 sentence nuclear market context relevant to this company\'s sector and horizon",\n' +
      '  "mission_refined": "refined mission statement (improve the language but keep their intent)",\n' +
      '  "vision_refined": "refined vision statement",\n' +
      '  "values_list": ["Value 1", "Value 2", ...],  // parse and list each value individually\n' +
      '  "swot": {\n' +
      '    "strengths": ["point 1", ...],       // 3-5 bullet points from their input\n' +
      '    "weaknesses": ["point 1", ...],      // 3-5 bullet points\n' +
      '    "opportunities": ["point 1", ...],   // 3-5 bullet points\n' +
      '    "threats": ["point 1", ...]          // 3-5 bullet points\n' +
      '  },\n' +
      '  "swot_insight": "1-2 sentence SWOT synthesis — the most important strategic implication",\n' +
      '  "pillars": [\n' +
      '    {\n' +
      '      "pillar": "Strategic Pillar Name",\n' +
      '      "description": "1-2 sentences on what this pillar means for the company",\n' +
      '      "objectives": [\n' +
      '        {\n' +
      '          "objective": "SMART objective statement",\n' +
      '          "kpi": "specific measurable KPI",\n' +
      '          "target": "specific target and timeframe",\n' +
      '          "owner": "suggested role e.g. Operations Director"\n' +
      '        }\n' +
      '      ]  // 2-3 objectives per pillar\n' +
      '    }\n' +
      '  ],  // 3-5 pillars aligned to the chosen strategic themes\n' +
      '  "roadmap": [\n' +
      '    {\n' +
      '      "phase": "Phase name e.g. Foundation",\n' +
      '      "timeframe": "e.g. Months 1-6",\n' +
      '      "priorities": "top 2-3 priorities this phase",\n' +
      '      "milestones": "key milestones to hit"\n' +
      '    }\n' +
      '  ],  // 3-4 phases across the horizon\n' +
      '  "resources": "2-3 sentences on key resource investments needed (people, equipment, accreditations, systems)",\n' +
      '  "f4n_impact": "specific note on how this strategy evidences F4N SL-01 criteria and which BE questions it helps answer"\n' +
      '}\n\n' +
      'Make objectives genuinely SMART and specific to this company\'s sector and size. ' +
      'KPIs should be measurable with clear targets (not vague). ' +
      'The strategy should feel like a real board-level document, not a template — reference the nuclear market context.';

    var model = localStorage.getItem('frankieClaudeModel') || 'claude-haiku-4-5-20251001';

    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    .then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || 'Claude API error ' + r.status); });
      return r.json();
    })
    .then(function (data) {
      var text  = data.content && data.content[0] && data.content[0].text || '{}';
      var match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse strategy response.');
      state.resultJson = JSON.parse(match[0]);
      state.phase      = 'result';
      renderPhase();
    })
    .catch(function (err) {
      state.error = err.message || 'Something went wrong. Please try again.';
      state.phase = 'objectives';
      renderPhase();
    });
  }

  // ── Print ───────────────────────────────────────────────────────────────────

  function printResult(r, horizonLabel, today, roadmapRows) {
    function li(items) {
      return items && items.length
        ? '<ul>' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'
        : '<p>—</p>';
    }
    var pillarsHtml = (r.pillars || []).map(function (p, i) {
      var objs = (p.objectives || []).map(function (o) {
        return '<tr><td>' + esc(o.objective || '') + '</td><td>' + esc(o.kpi || '') + '</td>' +
          '<td>' + esc(o.target || '') + '</td><td>' + esc(o.owner || '') + '</td></tr>';
      }).join('');
      return '<h3 style="color:#1F3A5F;font-size:10pt;margin:14px 0 4px">' + (i + 1) + '. ' + esc(p.pillar || '') + '</h3>' +
        (p.description ? '<p style="font-size:9pt;color:#555;margin:0 0 6px">' + esc(p.description) + '</p>' : '') +
        '<table><thead><tr><th>Objective</th><th>KPI</th><th>Target</th><th>Owner</th></tr></thead>' +
        '<tbody>' + objs + '</tbody></table>';
    }).join('');

    var win = window.open('', '_blank');
    if (!win) { alert('Please allow pop-ups to print.'); return; }

    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(state.companyName) + ' — ' + horizonLabel + ' Strategy</title><style>' +
      'body{font-family:Arial,sans-serif;font-size:10pt;margin:15mm;color:#111}' +
      'h1{font-size:14pt;color:#1F3A5F;margin:0 0 3px}' +
      'h2{font-size:11pt;color:#1F3A5F;border-left:3px solid #E8532A;padding-left:8px;margin:18px 0 6px;page-break-after:avoid}' +
      'h3{font-size:10pt;color:#1F3A5F;margin:14px 0 4px}' +
      'table{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:10px}' +
      'th,td{border:1px solid #ccc;padding:5px 7px;vertical-align:top}' +
      'th{background:#EEF4FA;font-weight:bold;color:#1F3A5F}' +
      '.swot-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}' +
      '.swot-cell{border:1px solid #ccc;border-radius:4px;padding:8px 10px}' +
      '.swot-label{font-weight:bold;font-size:9pt;margin-bottom:5px}' +
      'ul{margin:3px 0;padding-left:16px;line-height:1.6}' +
      '.mvv{background:#EEF4FA;border-left:3px solid #1F3A5F;padding:8px 12px;margin-bottom:8px;border-radius:0 4px 4px 0}' +
      '.mvv-tag{font-size:8pt;font-weight:bold;text-transform:uppercase;color:#1F3A5F;margin-bottom:3px}' +
      '.f4n-box{background:#EEF4FA;border:1px solid #1F3A5F;border-radius:4px;padding:10px 12px;margin:14px 0}' +
      '.footer{text-align:center;font-size:8pt;color:#aaa;margin-top:16px;border-top:1px solid #eee;padding-top:6px}' +
      '@page{margin:10mm}@media print{h2,h3{page-break-after:avoid}tr{page-break-inside:avoid}}' +
    '</style></head><body>');

    win.document.write(
      '<div style="border-bottom:2px solid #1F3A5F;padding-bottom:10px;margin-bottom:12px;display:flex;justify-content:space-between">' +
        '<div><h1>' + esc(state.companyName) + '</h1><div style="color:#555">' + horizonLabel + ' Business Strategy · F4N SL-01</div></div>' +
        '<div style="font-size:9pt;color:#555;text-align:right">Version 1.0<br>' + today + '</div>' +
      '</div>' +

      '<h2>1. Executive Summary</h2><p>' + esc(r.executive_summary || '') + '</p>' +
      '<h2>2. Market Context</h2><p>' + esc(r.market_context || '') + '</p>' +

      '<h2>3. Mission, Vision &amp; Values</h2>' +
      '<div class="mvv"><div class="mvv-tag">Mission</div><p>' + esc(r.mission_refined || state.mission) + '</p></div>' +
      '<div class="mvv"><div class="mvv-tag">Vision</div><p>' + esc(r.vision_refined || state.vision) + '</p></div>' +
      '<div class="mvv"><div class="mvv-tag">Values</div><p>' + esc((r.values_list || [state.values]).join('  ·  ')) + '</p></div>' +

      '<h2>4. SWOT Analysis</h2>' +
      (r.swot_insight ? '<p style="font-style:italic;color:#555">' + esc(r.swot_insight) + '</p>' : '') +
      '<div class="swot-grid">' +
        '<div class="swot-cell"><div class="swot-label" style="color:#27AE60">💪 Strengths</div>'    + li(r.swot && r.swot.strengths)     + '</div>' +
        '<div class="swot-cell"><div class="swot-label" style="color:#C0392B">⚠️ Weaknesses</div>'  + li(r.swot && r.swot.weaknesses)    + '</div>' +
        '<div class="swot-cell"><div class="swot-label" style="color:#1F3A5F">🚀 Opportunities</div>' + li(r.swot && r.swot.opportunities) + '</div>' +
        '<div class="swot-cell"><div class="swot-label" style="color:#E67E22">⚡ Threats</div>'     + li(r.swot && r.swot.threats)       + '</div>' +
      '</div>' +

      '<h2>5. Strategic Pillars &amp; Objectives</h2>' + pillarsHtml +

      (roadmapRows
        ? '<h2>6. Implementation Roadmap</h2>' +
          '<table><thead><tr><th>Phase</th><th>Timeframe</th><th>Priorities</th><th>Key Milestones</th></tr></thead>' +
          '<tbody>' + roadmapRows + '</tbody></table>'
        : '') +

      (r.resources ? '<h2>7. Resource Requirements</h2><p>' + esc(r.resources) + '</p>' : '') +

      (r.f4n_impact ? '<div class="f4n-box"><strong>F4N SL-01 Impact:</strong> ' + esc(r.f4n_impact) + '</div>' : '') +

      '<h2>Board Approval</h2>' +
      '<table><thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead><tbody>' +
        '<tr><td>Prepared by</td><td></td><td></td><td>' + today + '</td></tr>' +
        '<tr><td>Reviewed by</td><td></td><td></td><td></td></tr>' +
        '<tr><td>Approved by (Board / MD)</td><td></td><td></td><td></td></tr>' +
      '</tbody></table>' +

      '<div class="footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · SL-01 Strategy Standard</div>' +
    '</body></html>');

    win.document.close();
    setTimeout(function () { win.focus(); win.print(); }, 400);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function field(label, id, placeholder, value, multiline) {
    var tag   = multiline ? 'textarea' : 'input';
    var attrs = multiline ? ' rows="3"' : ' type="text"';
    return '<div class="strat-field">' +
      '<label class="strat-label" for="' + id + '">' + label + '</label>' +
      '<' + tag + ' class="strat-input' + (multiline ? ' strat-textarea' : '') + '" id="' + id + '"' + attrs +
        ' placeholder="' + placeholder + '"' +
        (multiline ? '>' + esc(value || '') + '</' + tag + '>' : ' value="' + esc(value || '') + '">') +
    '</div>';
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

}());
