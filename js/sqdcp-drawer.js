/**
 * sqdcp-drawer.js  v1.0
 * SQDCP Setup Wizard (Feature 13)
 * Guided metric selection → board design guide + meeting agenda + escalation process.
 * Grounded in NuCCoL SQDCP-02 and SQDCP-05 standards.
 */
(function () {
  'use strict';

  var DRAWER_ID = 'sqdcp-drawer';

  var PILLARS = [
    {
      id: 'S', label: 'Safety', color: '#C0392B', icon: '🦺',
      desc: 'Leading and lagging safety indicators — incidents, near-misses, observations, PPE compliance.',
      metrics: [
        { id: 'ltifr',    label: 'LTIFR',                   hint: 'Lost Time Injury Frequency Rate' },
        { id: 'nearmiss', label: 'Near Miss Reports',        hint: 'Number raised this period' },
        { id: 'observations', label: 'Safety Observations', hint: 'Positive + concern cards raised' },
        { id: 'toolbox',  label: 'Toolbox Talks Delivered',  hint: 'vs. planned' },
        { id: 'ppe',      label: 'PPE Compliance %',         hint: 'Spot check pass rate' },
        { id: 'actions',  label: 'Safety Actions Closed %',  hint: 'Open safety actions vs. closed' },
      ]
    },
    {
      id: 'Q', label: 'Quality', color: '#8E44AD', icon: '🔍',
      desc: 'First-off, in-process, and outgoing quality — defects, NCRs, customer returns, right-first-time.',
      metrics: [
        { id: 'rft',      label: 'Right First Time %',       hint: 'Parts passing inspection first time' },
        { id: 'ncr',      label: 'NCRs Raised',              hint: 'Internal non-conformance reports' },
        { id: 'scrap',    label: 'Scrap Rate %',             hint: 'Scrap value or count vs. output' },
        { id: 'rework',   label: 'Rework Hours',             hint: 'Hours spent on rework this period' },
        { id: 'customer', label: 'Customer Complaints/Returns', hint: 'Count this period' },
        { id: 'audit',    label: 'Audit Actions Closed %',   hint: 'Internal / external audit actions' },
      ]
    },
    {
      id: 'D', label: 'Delivery', color: '#E67E22', icon: '🚚',
      desc: 'On-time delivery performance to customer and internal schedule — OTD, schedule adherence, WIP.',
      metrics: [
        { id: 'otd',      label: 'On-Time Delivery %',       hint: 'Deliveries on or before due date' },
        { id: 'schedule', label: 'Schedule Adherence %',     hint: 'Internal production plan hit rate' },
        { id: 'wip',      label: 'WIP vs. Plan',             hint: 'Work in progress vs. target' },
        { id: 'lead',     label: 'Lead Time (days)',         hint: 'Average order lead time' },
        { id: 'backlog',  label: 'Order Backlog',            hint: 'Value or count of outstanding orders' },
        { id: 'sprint',   label: 'Sprint / Stage Completions', hint: 'Milestones hit vs. planned' },
      ]
    },
    {
      id: 'C', label: 'Cost', color: '#27AE60', icon: '💷',
      desc: 'Cost efficiency, waste, and financial performance at cell / department level.',
      metrics: [
        { id: 'cogs',     label: 'Cost of Poor Quality',     hint: 'Scrap + rework + warranty costs' },
        { id: 'oee',      label: 'OEE %',                    hint: 'Overall Equipment Effectiveness' },
        { id: 'labour',   label: 'Labour Efficiency %',      hint: 'Standard vs. actual hours' },
        { id: 'overhead', label: 'Overhead Absorption %',    hint: 'Absorbed vs. budget' },
        { id: 'waste',    label: 'Waste / Consumables Cost', hint: 'vs. budget or previous period' },
        { id: 'energy',   label: 'Energy Cost / Unit',       hint: 'kWh or £ per unit produced' },
      ]
    },
    {
      id: 'P', label: 'People', color: '#2980B9', icon: '👥',
      desc: 'Attendance, engagement, training, and team wellbeing — the heartbeat of the daily huddle.',
      metrics: [
        { id: 'attend',   label: 'Attendance %',             hint: 'Present vs. headcount' },
        { id: 'training', label: 'Training Completions',     hint: 'Mandatory / planned training done' },
        { id: 'ideas',    label: 'Improvement Ideas Raised', hint: 'Kaizen / CI suggestions count' },
        { id: 'skills',   label: 'Skills Matrix Coverage %', hint: 'Multi-skill coverage vs. target' },
        { id: 'turnover', label: 'Staff Turnover %',         hint: 'Rolling 12-month rate' },
        { id: 'morale',   label: 'Team Morale Check',        hint: 'Simple daily RAG self-rate or pulse score' },
      ]
    },
  ];

  var MATURITY = [
    { id: 'new',      label: '🌱 Starting Fresh',    desc: 'No SQDCP board yet — building from scratch' },
    { id: 'improve',  label: '🔧 Improving Existing', desc: 'Have a board but it needs refreshing' },
    { id: 'mature',   label: '⚡ Scaling Up',         desc: 'Mature board — adding new metrics or sites' },
  ];

  var state = {
    phase: 'step1',
    companyName: '',
    siteDept:    '',
    maturity:    '',
    // step2: selected metrics per pillar
    selected: { S: [], Q: [], D: [], C: [], P: [] },
    custom:   { S: '', Q: '', D: '', C: '', P: '' },
    // step3: meeting setup
    meetTime:    '',
    meetDuration: '',
    attendees:   '',
    escalation:  '',
    // result
    resultJson: null,
    error: null,
  };

  // ── Public API ──────────────────────────────────────────────────────────────

  window.SqdcpDrawer = {
    open: function () {
      injectDrawer();
      state.companyName = localStorage.getItem('sqdcp_company') || '';
      state.siteDept    = localStorage.getItem('sqdcp_site')    || '';
      state.phase       = 'step1';
      state.selected    = { S: [], Q: [], D: [], C: [], P: [] };
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
  function setBody(h) { var el = $id('sqdcp-body'); if (el) el.innerHTML = h; }
  function val(id)    { var el = $id(id); return el ? (el.value || '').trim() : ''; }

  // ── Drawer injection ────────────────────────────────────────────────────────

  function injectDrawer() {
    if ($id(DRAWER_ID)) return;
    var el = document.createElement('div');
    el.id        = DRAWER_ID;
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML =
      '<div class="assess-backdrop" id="sqdcpBackdrop"></div>' +
      '<div class="assess-panel">' +
        '<div class="assess-topbar">' +
          '<span class="assess-icon">📊</span>' +
          '<div class="assess-title">SQDCP Setup Wizard</div>' +
          '<button class="assess-close" id="sqdcpClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="sqdcp-progress" id="sqdcp-progress"></div>' +
        '<div class="assess-body" id="sqdcp-body"></div>' +
      '</div>';
    document.body.appendChild(el);
    $id('sqdcpClose').addEventListener('click', closeDrawer);
    $id('sqdcpBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  }

  function closeDrawer() {
    var d = $id(DRAWER_ID);
    if (d) { d.classList.remove('assess-drawer--open'); d.classList.add('assess-drawer--closed'); }
  }

  // ── Progress ────────────────────────────────────────────────────────────────

  var STEP_LABELS = ['Setup', 'Metrics', 'Meetings', 'Your Board'];
  var PHASES      = ['step1', 'step2', 'step3', 'result'];

  function renderProgress() {
    var el = $id('sqdcp-progress');
    if (!el) return;
    if (state.phase === 'loading') { el.innerHTML = ''; return; }
    var idx = PHASES.indexOf(state.phase);
    var inner = PHASES.map(function (p, i) {
      if (i === 3 && state.phase !== 'result') return '';
      var active = i === idx ? ' sqdcp-step--active' : '';
      var done   = i < idx  ? ' sqdcp-step--done'   : '';
      return '<div class="sqdcp-step' + active + done + '">' +
        '<div class="sqdcp-step-dot">' + (i < idx ? '✓' : (i + 1)) + '</div>' +
        '<div class="sqdcp-step-label">' + STEP_LABELS[i] + '</div>' +
      '</div>' + (i < PHASES.length - 1 ? '<div class="sqdcp-step-line"></div>' : '');
    }).join('');
    el.innerHTML = '<div class="sqdcp-progress-inner">' + inner + '</div>';
  }

  // ── Render router ───────────────────────────────────────────────────────────

  function renderPhase() {
    renderProgress();
    if      (state.phase === 'step1')   renderStep1();
    else if (state.phase === 'step2')   renderStep2();
    else if (state.phase === 'step3')   renderStep3();
    else if (state.phase === 'loading') renderLoading();
    else if (state.phase === 'result')  renderResult();
  }

  // ── Step 1: Setup ───────────────────────────────────────────────────────────

  function renderStep1() {
    var matCards = MATURITY.map(function (m) {
      var active = state.maturity === m.id ? ' sqdcp-mat--active' : '';
      return '<button type="button" class="sqdcp-mat-card' + active + '" data-mat="' + m.id + '">' +
        '<div class="sqdcp-mat-label">' + esc(m.label) + '</div>' +
        '<div class="sqdcp-mat-desc">'  + esc(m.desc)  + '</div>' +
      '</button>';
    }).join('');

    setBody(
      '<div class="sqdcp-intro">' +
        '<p>The SQDCP board drives daily team performance conversations. This wizard helps you choose the right metrics, design your board layout, and structure your daily meeting — all to <strong>NuCCoL SQDCP-02 and SQDCP-05</strong> standard.</p>' +
      '</div>' +

      '<div class="sqdcp-section-title">Your Setup</div>' +
      '<div class="sqdcp-fields">' +
        field('Company Name', 'sqdcp-company', 'e.g. Precision Nuclear Ltd', state.companyName) +
        field('Site / Department', 'sqdcp-site', 'e.g. Machining Cell — Sheffield', state.siteDept) +
      '</div>' +

      '<div class="sqdcp-section-title" style="margin-top:16px">Where are you starting from?</div>' +
      '<div class="sqdcp-mat-grid">' + matCards + '</div>' +

      (state.error ? '<div class="sqdcp-error">' + esc(state.error) + '</div>' : '') +

      '<div class="sqdcp-nav-row">' +
        '<button class="assess-nav assess-nav--primary" id="sqdcpNext1" type="button">Next: Choose Your Metrics →</button>' +
      '</div>'
    );

    document.querySelectorAll('.sqdcp-mat-card').forEach(function (card) {
      card.addEventListener('click', function () {
        state.maturity = card.dataset.mat;
        document.querySelectorAll('.sqdcp-mat-card').forEach(function (c) { c.classList.remove('sqdcp-mat--active'); });
        card.classList.add('sqdcp-mat--active');
      });
    });

    $id('sqdcpNext1').addEventListener('click', function () {
      state.companyName = val('sqdcp-company');
      state.siteDept    = val('sqdcp-site');
      state.error = null;
      if (!state.companyName) { state.error = 'Please enter your company name.'; renderStep1(); return; }
      if (!state.maturity)    { state.error = 'Please select where you are starting from.'; renderStep1(); return; }
      localStorage.setItem('sqdcp_company', state.companyName);
      if (state.siteDept) localStorage.setItem('sqdcp_site', state.siteDept);
      state.phase = 'step2';
      renderPhase();
    });
  }

  // ── Step 2: Metric selection ────────────────────────────────────────────────

  function renderStep2() {
    var totalSelected = PILLARS.reduce(function (n, p) { return n + state.selected[p.id].length; }, 0);

    var pillarSections = PILLARS.map(function (pillar) {
      var pills = pillar.metrics.map(function (m) {
        var active = state.selected[pillar.id].indexOf(m.id) > -1 ? ' sqdcp-metric--active' : '';
        var style  = active ? ' style="border-color:' + pillar.color + ';background:' + pillar.color + '1a"' : '';
        return '<button type="button" class="sqdcp-metric' + active + '" data-pillar="' + pillar.id + '" data-metric="' + m.id + '"' + style + '>' +
          '<span class="sqdcp-metric-label">' + esc(m.label) + '</span>' +
          '<span class="sqdcp-metric-hint">' + esc(m.hint) + '</span>' +
        '</button>';
      }).join('');

      var count = state.selected[pillar.id].length;
      var countBadge = count > 0
        ? '<span class="sqdcp-pillar-count" style="background:' + pillar.color + '">' + count + '</span>'
        : '';

      return '<div class="sqdcp-pillar-block">' +
        '<div class="sqdcp-pillar-header" style="border-left-color:' + pillar.color + '">' +
          '<span class="sqdcp-pillar-icon">' + pillar.icon + '</span>' +
          '<div>' +
            '<div class="sqdcp-pillar-title" style="color:' + pillar.color + '">' + pillar.id + ' — ' + pillar.label + countBadge + '</div>' +
            '<div class="sqdcp-pillar-desc">' + esc(pillar.desc) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="sqdcp-metric-grid">' + pills + '</div>' +
        '<div class="sqdcp-custom-row">' +
          '<input class="sqdcp-custom-input" id="sqdcp-custom-' + pillar.id + '" type="text" ' +
            'placeholder="+ Add custom ' + pillar.label + ' metric…" value="' + esc(state.custom[pillar.id] || '') + '">' +
        '</div>' +
      '</div>';
    }).join('');

    setBody(
      '<div class="sqdcp-metric-guide">Select <strong>2–4 metrics per pillar</strong> to keep your board focused and actionable. You can add a custom metric at the bottom of each pillar.</div>' +
      '<div class="sqdcp-pillars">' + pillarSections + '</div>' +
      (state.error ? '<div class="sqdcp-error">' + esc(state.error) + '</div>' : '') +
      '<div class="sqdcp-nav-row">' +
        '<button class="assess-nav" id="sqdcpBack2" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="sqdcpNext2" type="button">Next: Meeting Setup →</button>' +
      '</div>'
    );

    // Metric toggle
    document.querySelectorAll('.sqdcp-metric').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pillarId = btn.dataset.pillar;
        var metricId = btn.dataset.metric;
        var arr      = state.selected[pillarId];
        var pillar   = PILLARS.filter(function (p) { return p.id === pillarId; })[0];
        var idx      = arr.indexOf(metricId);
        if (idx > -1) {
          arr.splice(idx, 1);
          btn.classList.remove('sqdcp-metric--active');
          btn.style.borderColor = '';
          btn.style.background  = '';
        } else {
          arr.push(metricId);
          btn.classList.add('sqdcp-metric--active');
          btn.style.borderColor = pillar.color;
          btn.style.background  = pillar.color + '1a';
        }
        // Update count badge without full re-render
        var header = btn.closest('.sqdcp-pillar-block').querySelector('.sqdcp-pillar-title');
        var existing = header.querySelector('.sqdcp-pillar-count');
        if (existing) existing.remove();
        if (arr.length > 0) {
          var badge = document.createElement('span');
          badge.className = 'sqdcp-pillar-count';
          badge.style.background = pillar.color;
          badge.textContent = arr.length;
          header.appendChild(badge);
        }
      });
    });

    $id('sqdcpBack2').addEventListener('click', function () { state.phase = 'step1'; renderPhase(); });

    $id('sqdcpNext2').addEventListener('click', function () {
      // Save custom inputs
      PILLARS.forEach(function (p) {
        state.custom[p.id] = val('sqdcp-custom-' + p.id);
      });
      state.error = null;
      var totalSel = PILLARS.reduce(function (n, p) { return n + state.selected[p.id].length; }, 0);
      var withCustom = PILLARS.reduce(function (n, p) { return n + state.selected[p.id].length + (state.custom[p.id] ? 1 : 0); }, 0);
      if (withCustom < 3) { state.error = 'Please select at least 3 metrics across the pillars.'; renderStep2(); return; }
      state.phase = 'step3';
      renderPhase();
    });
  }

  // ── Step 3: Meeting setup ───────────────────────────────────────────────────

  function renderStep3() {
    setBody(
      '<div class="sqdcp-section-title">Daily Meeting Setup</div>' +
      '<div class="sqdcp-fields">' +
        field('What time is your daily standup?', 'sqdcp-time', 'e.g. 08:00 — start of shift', state.meetTime) +
        field('How long should the meeting be?', 'sqdcp-duration', 'e.g. 15 minutes', state.meetDuration) +
        field('Who attends the daily meeting?', 'sqdcp-attendees',
          'e.g. Cell team + supervisor; Operations Manager joins Fridays for weekly review',
          state.attendees, true) +
        field('Escalation process — what happens when a metric goes Red?', 'sqdcp-escalation',
          'e.g. Supervisor raises action within 24hrs; Operations Manager notified same day; review at weekly leadership standup',
          state.escalation, true) +
      '</div>' +

      '<div class="sqdcp-info-box">💡 Frankie will generate: a board layout guide, metric definitions with RAG thresholds, a timed daily meeting agenda, and your escalation process — all ready to implement.</div>' +

      (state.error ? '<div class="sqdcp-error">' + esc(state.error) + '</div>' : '') +

      '<div class="sqdcp-nav-row">' +
        '<button class="assess-nav" id="sqdcpBack3" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="sqdcpGenerate" type="button">✨ Build My SQDCP Board</button>' +
      '</div>'
    );

    $id('sqdcpBack3').addEventListener('click', function () { state.phase = 'step2'; renderPhase(); });
    $id('sqdcpGenerate').addEventListener('click', function () {
      state.meetTime    = val('sqdcp-time');
      state.meetDuration = val('sqdcp-duration');
      state.attendees   = val('sqdcp-attendees');
      state.escalation  = val('sqdcp-escalation');
      state.error = null;
      if (!state.meetTime)    { state.error = 'Please enter the daily meeting time.'; renderStep3(); return; }
      if (!state.attendees)   { state.error = 'Please describe who attends.'; renderStep3(); return; }
      var claudeKey = localStorage.getItem('frankieClaudeKey') || '';
      if (!claudeKey) { state.error = 'No Claude API key found. Please add it in Frankie settings.'; renderStep3(); return; }
      state.phase = 'loading';
      renderPhase();
      generate(claudeKey);
    });
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  function renderLoading() {
    setBody(
      '<div class="assess-loading">' +
        '<div class="sqdcp-spinner"></div>' +
        '<p><strong>Designing your SQDCP board…</strong></p>' +
        '<p class="sqdcp-loading-sub">Frankie is building your metric definitions, RAG thresholds, and meeting agenda.</p>' +
      '</div>'
    );
  }

  // ── Result ──────────────────────────────────────────────────────────────────

  function renderResult() {
    var r = state.resultJson;
    if (!r) { setBody('<div class="sqdcp-error">No result returned — please try again.</div>'); return; }

    var today = new Date().toLocaleDateString('en-GB');

    // SQDCP board visual
    var boardCells = PILLARS.map(function (pillar) {
      var metrics = r.metrics && r.metrics[pillar.id] ? r.metrics[pillar.id] : [];
      var metricList = metrics.map(function (m) {
        return '<div class="sqdcp-board-metric">' +
          '<span class="sqdcp-board-metric-name">' + esc(m.name) + '</span>' +
          '<span class="sqdcp-board-metric-unit">' + esc(m.unit || '') + '</span>' +
        '</div>';
      }).join('');
      return '<div class="sqdcp-board-cell" style="border-top-color:' + pillar.color + '">' +
        '<div class="sqdcp-board-pillar-header" style="background:' + pillar.color + '">' +
          pillar.icon + ' ' + pillar.id + ' — ' + pillar.label +
        '</div>' +
        '<div class="sqdcp-board-metrics">' + metricList + '</div>' +
      '</div>';
    }).join('');

    // Metric definition table
    var defRows = PILLARS.map(function (pillar) {
      var metrics = r.metrics && r.metrics[pillar.id] ? r.metrics[pillar.id] : [];
      return metrics.map(function (m) {
        return '<tr>' +
          '<td><span class="sqdcp-def-pillar" style="background:' + pillar.color + '">' + pillar.id + '</span></td>' +
          '<td><strong>' + esc(m.name) + '</strong></td>' +
          '<td>' + esc(m.definition || '') + '</td>' +
          '<td class="sqdcp-def-green">'  + esc(m.green  || '') + '</td>' +
          '<td class="sqdcp-def-amber">'  + esc(m.amber  || '') + '</td>' +
          '<td class="sqdcp-def-red">'    + esc(m.red    || '') + '</td>' +
          '<td>' + esc(m.data_source || '') + '</td>' +
        '</tr>';
      }).join('');
    }).join('');

    // Meeting agenda
    var agendaRows = (r.agenda || []).map(function (item) {
      return '<tr>' +
        '<td class="sqdcp-agenda-time">' + esc(item.time || '') + '</td>' +
        '<td><strong>' + esc(item.item || '') + '</strong></td>' +
        '<td>' + esc(item.detail || '') + '</td>' +
        '<td>' + esc(item.owner || '') + '</td>' +
      '</tr>';
    }).join('');

    // Escalation
    var escSteps = (r.escalation_process || []).map(function (s, i) {
      var colour = i === 0 ? '#C0392B' : i === 1 ? '#E67E22' : '#27AE60';
      return '<div class="sqdcp-esc-step">' +
        '<div class="sqdcp-esc-num" style="background:' + colour + '">' + (i + 1) + '</div>' +
        '<div class="sqdcp-esc-content">' +
          '<div class="sqdcp-esc-trigger">' + esc(s.trigger || '') + '</div>' +
          '<div class="sqdcp-esc-action">'  + esc(s.action  || '') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    var html =
      '<div class="sqdcp-result">' +

        '<div class="sqdcp-result-header">' +
          '<div>' +
            '<div class="sqdcp-result-company">' + esc(state.companyName) + (state.siteDept ? ' · ' + esc(state.siteDept) : '') + '</div>' +
            '<div class="sqdcp-result-title">SQDCP Board Setup Guide</div>' +
          '</div>' +
          '<div class="sqdcp-result-meta">Built: ' + today + '</div>' +
        '</div>' +

        // Board layout
        '<div class="sqdcp-result-section">' +
          '<div class="sqdcp-result-label">Board Layout</div>' +
          '<div class="sqdcp-board">' + boardCells + '</div>' +
          (r.board_notes ? '<p class="sqdcp-board-notes">' + esc(r.board_notes) + '</p>' : '') +
        '</div>' +

        // Metric definitions
        '<div class="sqdcp-result-section">' +
          '<div class="sqdcp-result-label">Metric Definitions &amp; RAG Thresholds</div>' +
          '<div class="sqdcp-table-wrap">' +
            '<table class="sqdcp-def-table">' +
              '<thead><tr><th></th><th>Metric</th><th>Definition</th><th class="sqdcp-def-green">🟢 Green</th><th class="sqdcp-def-amber">🟡 Amber</th><th class="sqdcp-def-red">🔴 Red</th><th>Data Source</th></tr></thead>' +
              '<tbody>' + defRows + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +

        // Meeting agenda
        '<div class="sqdcp-result-section">' +
          '<div class="sqdcp-result-label sqdcp-label--orange">Daily Meeting Agenda — ' + esc(state.meetTime) + ' · ' + esc(state.meetDuration || '15 mins') + '</div>' +
          '<table class="sqdcp-agenda-table">' +
            '<thead><tr><th>Time</th><th>Agenda Item</th><th>Detail</th><th>Owner</th></tr></thead>' +
            '<tbody>' + agendaRows + '</tbody>' +
          '</table>' +
          (r.meeting_tips ? '<div class="sqdcp-tips">' + esc(r.meeting_tips) + '</div>' : '') +
        '</div>' +

        // Escalation
        '<div class="sqdcp-result-section">' +
          '<div class="sqdcp-result-label sqdcp-label--red">Escalation Process</div>' +
          '<div class="sqdcp-escalation">' + escSteps + '</div>' +
        '</div>' +

        // Implementation tips
        (r.implementation_tips && r.implementation_tips.length
          ? '<div class="sqdcp-result-section">' +
              '<div class="sqdcp-result-label sqdcp-label--green">Implementation Tips</div>' +
              '<ul class="sqdcp-tips-list">' + r.implementation_tips.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
            '</div>'
          : '') +

        '<div class="sqdcp-result-footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · SQDCP-02 &amp; SQDCP-05</div>' +

        '<div class="sqdcp-action-row">' +
          '<button class="assess-nav" id="sqdcpRestart" type="button">← New Board</button>' +
          '<button class="assess-nav assess-nav--primary" id="sqdcpPrint" type="button">🖨️ Print / Save PDF</button>' +
        '</div>' +

      '</div>';

    setBody(html);

    $id('sqdcpRestart').addEventListener('click', function () {
      state.phase = 'step1'; state.resultJson = null; state.selected = { S: [], Q: [], D: [], C: [], P: [] };
      renderPhase();
    });
    $id('sqdcpPrint').addEventListener('click', function () { printResult(r, today, defRows, agendaRows); });
  }

  // ── Claude API ──────────────────────────────────────────────────────────────

  function generate(apiKey) {
    var maturityMap = { new: 'starting fresh with no existing SQDCP board', improve: 'improving an existing board', mature: 'scaling up a mature SQDCP system' };

    var metricSummary = PILLARS.map(function (pillar) {
      var labels = state.selected[pillar.id].map(function (id) {
        var m = pillar.metrics.filter(function (x) { return x.id === id; })[0];
        return m ? m.label : id;
      });
      if (state.custom[pillar.id]) labels.push(state.custom[pillar.id] + ' (custom)');
      return pillar.id + ' (' + pillar.label + '): ' + (labels.length ? labels.join(', ') : 'none selected');
    }).join('\n');

    var prompt =
      'You are a lean manufacturing and continuous improvement expert, experienced in SQDCP visual management boards for nuclear supply chain companies.\n\n' +
      'Build a complete SQDCP board setup guide for:\n\n' +
      'Company: ' + state.companyName + '\n' +
      'Site/Department: ' + (state.siteDept || 'Not specified') + '\n' +
      'Maturity level: ' + (maturityMap[state.maturity] || state.maturity) + '\n' +
      'Daily meeting time: ' + state.meetTime + '\n' +
      'Meeting duration: ' + (state.meetDuration || '15 minutes') + '\n' +
      'Attendees: ' + state.attendees + '\n' +
      'Escalation process: ' + (state.escalation || 'Standard escalation') + '\n\n' +
      'Selected metrics:\n' + metricSummary + '\n\n' +
      'Return ONLY a JSON object — no markdown, no explanation:\n' +
      '{\n' +
      '  "board_notes": "1-2 sentences on recommended physical board layout and format",\n' +
      '  "metrics": {\n' +
      '    "S": [\n' +
      '      {\n' +
      '        "name": "metric name",\n' +
      '        "unit": "unit of measure e.g. %, count, hrs",\n' +
      '        "definition": "what exactly is measured and how",\n' +
      '        "green": "target/threshold for green RAG",\n' +
      '        "amber": "threshold for amber — intervention needed",\n' +
      '        "red": "threshold for red — immediate action",\n' +
      '        "data_source": "where to get the data e.g. shift log, ERP, manual count"\n' +
      '      }\n' +
      '    ],\n' +
      '    "Q": [...],\n' +
      '    "D": [...],\n' +
      '    "C": [...],\n' +
      '    "P": [...]\n' +
      '  },\n' +
      '  "agenda": [\n' +
      '    {\n' +
      '      "time": "e.g. +0 mins",\n' +
      '      "item": "agenda item name",\n' +
      '      "detail": "what happens / questions asked",\n' +
      '      "owner": "who leads this item"\n' +
      '    }\n' +
      '  ],  // 6-8 timed agenda items that fit within the stated duration\n' +
      '  "meeting_tips": "2-3 sentence tip on running an effective daily standup",\n' +
      '  "escalation_process": [\n' +
      '    {\n' +
      '      "trigger": "when does this escalation level kick in",\n' +
      '      "action": "what action is taken and by whom"\n' +
      '    }\n' +
      '  ],  // 3-4 escalation levels from immediate response to leadership review\n' +
      '  "implementation_tips": ["tip 1", "tip 2", "tip 3"]  // 3-5 practical tips for rolling out the board\n' +
      '}\n\n' +
      'Only include metrics in the JSON that the user actually selected — map them to the specific metrics chosen. ' +
      'RAG thresholds should be specific and practical (e.g. "≥98%" not just "high"). ' +
      'The agenda should fit neatly within the stated meeting duration with realistic time allocations.';

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
      if (!match) throw new Error('Could not parse response from Claude.');
      state.resultJson = JSON.parse(match[0]);
      state.phase      = 'result';
      renderPhase();
    })
    .catch(function (err) {
      state.error = err.message || 'Something went wrong. Please try again.';
      state.phase = 'step3';
      renderPhase();
    });
  }

  // ── Print ───────────────────────────────────────────────────────────────────

  function printResult(r, today, defRows, agendaRows) {
    var escSteps = (r.escalation_process || []).map(function (s, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(s.trigger || '') + '</td><td>' + esc(s.action || '') + '</td></tr>';
    }).join('');

    var implTips = r.implementation_tips && r.implementation_tips.length
      ? '<ul>' + r.implementation_tips.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
      : '';

    var win = window.open('', '_blank');
    if (!win) { alert('Please allow pop-ups to print.'); return; }

    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SQDCP Board — ' + esc(state.companyName) + '</title><style>' +
      'body{font-family:Arial,sans-serif;font-size:10pt;margin:15mm;color:#111}' +
      'h1{font-size:13pt;color:#1F3A5F;margin:0 0 3px}' +
      'h2{font-size:10pt;color:#1F3A5F;border-left:3px solid #E8532A;padding-left:8px;margin:16px 0 5px;page-break-after:avoid}' +
      'table{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:10px}' +
      'th,td{border:1px solid #ccc;padding:5px 7px;vertical-align:top}' +
      'th{background:#EEF4FA;font-weight:bold;color:#1F3A5F}' +
      '.green{color:#27AE60}.amber{color:#E67E22}.red{color:#C0392B}' +
      'ul{margin:3px 0;padding-left:16px;line-height:1.7}' +
      '.footer{text-align:center;font-size:8pt;color:#aaa;margin-top:16px;border-top:1px solid #eee;padding-top:6px}' +
      '@page{margin:10mm}' +
    '</style></head><body>');

    win.document.write(
      '<div style="border-bottom:2px solid #1F3A5F;padding-bottom:10px;margin-bottom:12px">' +
        '<h1>' + esc(state.companyName) + (state.siteDept ? ' · ' + esc(state.siteDept) : '') + '</h1>' +
        '<div style="font-size:11pt;color:#555">SQDCP Board Setup Guide &nbsp;|&nbsp; ' + today + '</div>' +
      '</div>' +

      '<h2>Board Notes</h2><p>' + esc(r.board_notes || '') + '</p>' +

      '<h2>Metric Definitions &amp; RAG Thresholds</h2>' +
      '<table><thead><tr><th>Pillar</th><th>Metric</th><th>Definition</th><th class="green">Green</th><th class="amber">Amber</th><th class="red">Red</th><th>Data Source</th></tr></thead>' +
      '<tbody>' + defRows + '</tbody></table>' +

      '<h2>Daily Meeting Agenda — ' + esc(state.meetTime) + ' · ' + esc(state.meetDuration || '15 mins') + '</h2>' +
      '<table><thead><tr><th>Time</th><th>Item</th><th>Detail</th><th>Owner</th></tr></thead>' +
      '<tbody>' + agendaRows + '</tbody></table>' +
      (r.meeting_tips ? '<p style="font-size:9pt;color:#555"><em>' + esc(r.meeting_tips) + '</em></p>' : '') +

      '<h2>Escalation Process</h2>' +
      '<table><thead><tr><th>Level</th><th>Trigger</th><th>Action</th></tr></thead>' +
      '<tbody>' + escSteps + '</tbody></table>' +

      (implTips ? '<h2>Implementation Tips</h2>' + implTips : '') +

      '<div class="footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · SQDCP-02 &amp; SQDCP-05</div>' +
    '</body></html>');

    win.document.close();
    setTimeout(function () { win.focus(); win.print(); }, 400);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function field(label, id, placeholder, value, multiline) {
    var tag   = multiline ? 'textarea' : 'input';
    var attrs = multiline ? ' rows="3"' : ' type="text"';
    return '<div class="sqdcp-field">' +
      '<label class="sqdcp-label" for="' + id + '">' + label + '</label>' +
      '<' + tag + ' class="sqdcp-input' + (multiline ? ' sqdcp-textarea' : '') + '" id="' + id + '"' + attrs +
        ' placeholder="' + placeholder + '"' +
        (multiline ? '>' + esc(value || '') + '</' + tag + '>' : ' value="' + esc(value || '') + '">') +
    '</div>';
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

}());
