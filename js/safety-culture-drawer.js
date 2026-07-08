/**
 * safety-culture-drawer.js  v1.0
 * Safety Culture Self-Assessment (Feature 11)
 * 8 IAEA/INPO safety culture dimensions rated 0–4.
 * Claude generates RAG summary, strengths, gaps, and a prioritised action plan.
 * Flow: intro → rate (8 dimensions) → loading → result
 */
(function () {
  'use strict';

  var DRAWER_ID = 'safety-culture-drawer';

  // 8 dimensions, each with a short descriptor per rating level
  var DIMENSIONS = [
    {
      id: 'leadership',
      label: 'Leadership Commitment to Safety',
      icon: '👔',
      desc: 'Senior leaders visibly champion safety, allocate resource, and make safety decisions before commercial ones.',
      levels: [
        'Safety is rarely mentioned by leadership; commercial pressures dominate decisions.',
        'Leaders acknowledge safety but it is not consistently demonstrated in behaviour or decisions.',
        'Leaders actively promote safety with visible behaviours and dedicated resource.',
        'Safety leadership is exemplary — leaders stop work, walk the floor, and model the culture company-wide.',
      ]
    },
    {
      id: 'communication',
      label: 'Safety Communication & Transparency',
      icon: '📢',
      desc: 'Safety information flows freely up and down the organisation; near-misses and concerns are shared openly.',
      levels: [
        'Safety issues are rarely communicated; people are reluctant to raise concerns.',
        'Some safety communication exists but is inconsistent or one-directional.',
        'Regular safety briefings, open-door policy, and near-miss sharing are established.',
        'Transparent, two-way safety communication is embedded; people at all levels speak up freely.',
      ]
    },
    {
      id: 'questioning',
      label: 'Questioning Attitude & Stop-Work',
      icon: '🛑',
      desc: 'Workers feel empowered to stop work, challenge unsafe conditions, and ask "why" without fear of blame.',
      levels: [
        'Stop-work is not practised; people feel unable to challenge supervisors on safety.',
        'Stop-work authority exists on paper but is rarely exercised in practice.',
        'Workers regularly challenge unsafe conditions; stop-work decisions are respected.',
        'A strong questioning attitude is the norm — people at all levels challenge and verify without hesitation.',
      ]
    },
    {
      id: 'compliance',
      label: 'Procedure Compliance & Adherence',
      icon: '📄',
      desc: 'Procedures are followed as written, kept up to date, and are practical for the people using them.',
      levels: [
        'Procedures are regularly bypassed or ignored; workarounds are common.',
        'Procedures exist but are not always followed; some are out of date.',
        'Procedures are routinely followed; deviations are documented and reviewed.',
        'Procedures are owned by the workforce, kept current, and compliance is self-enforced.',
      ]
    },
    {
      id: 'reporting',
      label: 'Incident Reporting & Learning',
      icon: '📊',
      desc: 'Near-misses, incidents, and NCRs are reported, investigated thoroughly, and lessons are shared.',
      levels: [
        'Incidents are under-reported; investigations are superficial or blame-focused.',
        'Incidents are reported but investigations lack root cause depth; lessons rarely embedded.',
        'Near-misses and incidents are reported and investigated; lessons are communicated.',
        'A mature reporting culture exists — high near-miss rates are celebrated; learning is embedded systematically.',
      ]
    },
    {
      id: 'planning',
      label: 'Safety in Planning & Scheduling',
      icon: '🗓️',
      desc: 'Safety is considered from the start of every job, project, or change — not bolted on at the end.',
      levels: [
        'Safety is not considered during planning; risk assessments are completed after work starts.',
        'Safety is sometimes considered in planning but often under time pressure.',
        'Pre-job briefings, risk assessments, and toolbox talks are standard before work begins.',
        'Safety planning is integrated into every stage — HAZOP, COSHH, RAMS, and stop-work criteria set before mobilisation.',
      ]
    },
    {
      id: 'engagement',
      label: 'Worker Involvement & Engagement',
      icon: '🤝',
      desc: 'Workers actively participate in safety improvement — writing procedures, conducting audits, and raising ideas.',
      levels: [
        'Safety is seen as management\'s job; workers are not involved.',
        'Some workers are consulted on safety but involvement is limited to a few individuals.',
        'Workers contribute to safety reviews, hazard identification, and procedure improvement.',
        'Safety ownership is shared across all levels; workforce-led safety initiatives are the norm.',
      ]
    },
    {
      id: 'improvement',
      label: 'Continuous Improvement Culture',
      icon: '🔄',
      desc: 'The organisation systematically reviews performance data, benchmarks against peers, and drives safety improvement.',
      levels: [
        'No structured safety improvement process; same issues recur without resolution.',
        'Some improvement activity but it is reactive — responding to incidents rather than preventing them.',
        'Regular safety performance reviews and improvement plans are in place.',
        'Continuous improvement is embedded — leading indicators, benchmarking, and proactive improvement cycles.',
      ]
    },
  ];

  var RATING_LABELS = ['Not in Place', 'Developing', 'Established', 'Exemplary'];
  var RATING_COLOURS = ['#C0392B', '#E67E22', '#27AE60', '#1F3A5F'];

  var state = {
    phase: 'intro',   // intro | rate | loading | result
    companyName: '',
    siteRole: '',
    scores: {},       // { dimensionId: 0-3 }
    result: null,
    error: null,
  };

  // ── Public API ──────────────────────────────────────────────────────────────

  window.SafetyCultureDrawer = {
    open: function () {
      injectDrawer();
      state.companyName = localStorage.getItem('sc_company') || '';
      state.siteRole    = localStorage.getItem('sc_role')    || '';
      state.scores      = {};
      state.phase       = 'intro';
      state.result      = null;
      state.error       = null;
      renderPhase();
      var drawer = document.getElementById(DRAWER_ID);
      drawer.classList.remove('assess-drawer--closed');
      drawer.classList.add('assess-drawer--open');
    }
  };

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function $id(id) { return document.getElementById(id); }
  function setBody(html) { var el = $id('sc-body'); if (el) el.innerHTML = html; }
  function val(id) { var el = $id(id); return el ? (el.value || '').trim() : ''; }

  // ── Drawer injection ────────────────────────────────────────────────────────

  function injectDrawer() {
    if ($id(DRAWER_ID)) return;
    var el = document.createElement('div');
    el.id        = DRAWER_ID;
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML =
      '<div class="assess-backdrop" id="scBackdrop"></div>' +
      '<div class="assess-panel">' +
        '<div class="assess-topbar">' +
          '<span class="assess-icon">☢️</span>' +
          '<div class="assess-title">Safety Culture Self-Assessment</div>' +
          '<button class="assess-close" id="scClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="assess-body" id="sc-body"></div>' +
      '</div>';
    document.body.appendChild(el);

    $id('scClose').addEventListener('click', closeDrawer);
    $id('scBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  }

  function closeDrawer() {
    var d = $id(DRAWER_ID);
    if (!d) return;
    d.classList.remove('assess-drawer--open');
    d.classList.add('assess-drawer--closed');
  }

  // ── Render router ───────────────────────────────────────────────────────────

  function renderPhase() {
    if      (state.phase === 'intro')   renderIntro();
    else if (state.phase === 'rate')    renderRate();
    else if (state.phase === 'loading') renderLoading();
    else if (state.phase === 'result')  renderResult();
  }

  // ── Intro ───────────────────────────────────────────────────────────────────

  function renderIntro() {
    setBody(
      '<div class="sc-intro">' +
        '<p>Rate your organisation across <strong>8 safety culture dimensions</strong> drawn from IAEA, INPO, and NuCCoL QHSE-04 standards.</p>' +
        '<p>Frankie will generate a <strong>RAG-rated assessment</strong> with your strengths, gaps, and a <strong>prioritised action plan</strong> — ready to share with your SCC assessor.</p>' +
      '</div>' +

      '<div class="sc-fields">' +
        '<div class="sc-field">' +
          '<label class="sc-label" for="sc-company">Company Name</label>' +
          '<input class="sc-input" id="sc-company" type="text" placeholder="e.g. Precision Nuclear Ltd" value="' + esc(state.companyName) + '">' +
        '</div>' +
        '<div class="sc-field">' +
          '<label class="sc-label" for="sc-role">Your Role</label>' +
          '<input class="sc-input" id="sc-role" type="text" placeholder="e.g. QHSE Manager, Operations Director" value="' + esc(state.siteRole) + '">' +
        '</div>' +
      '</div>' +

      '<div class="sc-iaea-box">' +
        '<div class="sc-iaea-title">Based on IAEA Safety Culture Framework &amp; INPO Principles for a Strong Nuclear Safety Culture</div>' +
        '<div class="sc-rating-key">' +
          RATING_LABELS.map(function (l, i) {
            return '<span class="sc-key-dot" style="background:' + RATING_COLOURS[i] + '"></span><span class="sc-key-label">' + i + ' – ' + l + '</span>';
          }).join('') +
        '</div>' +
      '</div>' +

      (state.error ? '<div class="sc-error">' + esc(state.error) + '</div>' : '') +

      '<div class="sc-nav-row">' +
        '<button class="assess-nav assess-nav--primary" id="scStartRate" type="button">Start Assessment →</button>' +
      '</div>'
    );

    $id('scStartRate').addEventListener('click', function () {
      state.companyName = val('sc-company');
      state.siteRole    = val('sc-role');
      state.error = null;
      if (!state.companyName) { state.error = 'Please enter your company name.'; renderIntro(); return; }
      if (state.companyName) localStorage.setItem('sc_company', state.companyName);
      if (state.siteRole)    localStorage.setItem('sc_role',    state.siteRole);
      state.phase = 'rate';
      renderPhase();
    });
  }

  // ── Rate ────────────────────────────────────────────────────────────────────

  function renderRate() {
    var cards = DIMENSIONS.map(function (dim) {
      var current = state.scores[dim.id] !== undefined ? state.scores[dim.id] : -1;

      var buttons = [0, 1, 2, 3].map(function (lvl) {
        var active = current === lvl ? ' sc-lvl--active' : '';
        var colour = current === lvl ? RATING_COLOURS[lvl] : '';
        var style  = colour ? ' style="border-color:' + colour + ';background:' + colour + '1a"' : '';
        return '<button type="button" class="sc-lvl-btn' + active + '" data-dim="' + dim.id + '" data-lvl="' + lvl + '"' + style + '>' +
          '<span class="sc-lvl-num" style="' + (colour ? 'color:' + colour : '') + '">' + lvl + '</span>' +
          '<span class="sc-lvl-label">' + RATING_LABELS[lvl] + '</span>' +
        '</button>';
      }).join('');

      var rated = current >= 0 ? ' sc-dim-card--rated' : '';
      return '<div class="sc-dim-card' + rated + '" id="sc-dim-' + dim.id + '">' +
        '<div class="sc-dim-header">' +
          '<span class="sc-dim-icon">' + dim.icon + '</span>' +
          '<div>' +
            '<div class="sc-dim-title">' + esc(dim.label) + '</div>' +
            '<div class="sc-dim-desc">' + esc(dim.desc) + '</div>' +
          '</div>' +
        '</div>' +
        (current >= 0 ? '<div class="sc-dim-selected-desc">' + esc(dim.levels[current]) + '</div>' : '') +
        '<div class="sc-lvl-grid">' + buttons + '</div>' +
      '</div>';
    }).join('');

    var rated   = Object.keys(state.scores).length;
    var total   = DIMENSIONS.length;
    var allDone = rated === total;

    setBody(
      '<div class="sc-progress-bar-wrap">' +
        '<div class="sc-progress-bar-track">' +
          '<div class="sc-progress-bar-fill" style="width:' + Math.round((rated / total) * 100) + '%"></div>' +
        '</div>' +
        '<div class="sc-progress-label">' + rated + ' of ' + total + ' rated</div>' +
      '</div>' +

      '<div class="sc-cards">' + cards + '</div>' +

      (state.error ? '<div class="sc-error">' + esc(state.error) + '</div>' : '') +

      '<div class="sc-nav-row">' +
        '<button class="assess-nav" id="scBackIntro" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary' + (allDone ? '' : ' sc-btn-disabled') + '" id="scAnalyse" type="button"' + (allDone ? '' : ' disabled') + '>' +
          (allDone ? '✨ Analyse My Safety Culture' : 'Rate all 8 dimensions to continue') +
        '</button>' +
      '</div>'
    );

    // Attach button listeners
    document.querySelectorAll('.sc-lvl-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dimId = btn.dataset.dim;
        var lvl   = parseInt(btn.dataset.lvl, 10);
        state.scores[dimId] = lvl;
        renderRate();
        // Scroll the next unrated card into view
        var next = DIMENSIONS.filter(function (d) { return state.scores[d.id] === undefined; })[0];
        if (next) {
          var el = $id('sc-dim-' + next.id);
          if (el) setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
        }
      });
    });

    $id('scBackIntro').addEventListener('click', function () { state.phase = 'intro'; renderPhase(); });

    if (allDone) {
      $id('scAnalyse').addEventListener('click', function () {
        var claudeKey = localStorage.getItem('frankieClaudeKey') || '';
        if (!claudeKey) { state.error = 'No Claude API key found. Please add your key in Frankie settings.'; renderRate(); return; }
        state.phase = 'loading';
        renderPhase();
        analyse(claudeKey);
      });
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  function renderLoading() {
    setBody(
      '<div class="assess-loading">' +
        '<div class="sc-spinner"></div>' +
        '<p><strong>Analysing your safety culture…</strong></p>' +
        '<p class="sc-loading-sub">Frankie is mapping your scores against IAEA traits and NuCCoL QHSE-04 criteria.</p>' +
      '</div>'
    );
  }

  // ── Result ──────────────────────────────────────────────────────────────────

  function renderResult() {
    var r = state.result;
    if (!r) { setBody('<div class="sc-error">No result returned — please try again.</div>'); return; }

    var total = DIMENSIONS.reduce(function (sum, d) { return sum + (state.scores[d.id] || 0); }, 0);
    var max   = DIMENSIONS.length * 3;
    var pct   = Math.round((total / max) * 100);
    var rag   = r.rag || (pct >= 70 ? 'GREEN' : pct >= 45 ? 'AMBER' : 'RED');
    var ragColour = rag === 'GREEN' ? '#27AE60' : rag === 'AMBER' ? '#E67E22' : '#C0392B';
    var ragLabel  = rag === 'GREEN' ? '🟢 Green — Good Safety Culture' : rag === 'AMBER' ? '🟡 Amber — Developing Safety Culture' : '🔴 Red — Safety Culture Needs Attention';

    // Score bar
    var scoreBar =
      '<div class="sc-score-block">' +
        '<div class="sc-score-rag" style="border-color:' + ragColour + ';color:' + ragColour + '">' + ragLabel + '</div>' +
        '<div class="sc-score-bar-wrap">' +
          '<div class="sc-score-bar-track">' +
            '<div class="sc-score-bar-fill" style="width:' + pct + '%;background:' + ragColour + '"></div>' +
          '</div>' +
          '<div class="sc-score-pct" style="color:' + ragColour + '">' + pct + '%</div>' +
        '</div>' +
        '<div class="sc-score-caption">' + total + ' / ' + max + ' points across 8 safety culture dimensions</div>' +
      '</div>';

    // Dimension scores
    var dimRows = DIMENSIONS.map(function (dim) {
      var score  = state.scores[dim.id] || 0;
      var colour = RATING_COLOURS[score];
      var width  = Math.round((score / 3) * 100);
      return '<div class="sc-dim-row">' +
        '<div class="sc-dim-row-label">' + dim.icon + ' ' + esc(dim.label) + '</div>' +
        '<div class="sc-dim-row-bar">' +
          '<div class="sc-dim-row-fill" style="width:' + width + '%;background:' + colour + '"></div>' +
        '</div>' +
        '<div class="sc-dim-row-score" style="color:' + colour + '">' + score + '/3 <span class="sc-dim-row-tag">' + RATING_LABELS[score] + '</span></div>' +
      '</div>';
    }).join('');

    function list(items, colour) {
      if (!items || !items.length) return '<p>—</p>';
      return '<ul class="sc-list">' + items.map(function (i) {
        return '<li><span class="sc-list-dot" style="color:' + colour + '">●</span>' + esc(i) + '</li>';
      }).join('') + '</ul>';
    }

    function actions(items) {
      if (!items || !items.length) return '<p>—</p>';
      return items.map(function (a, i) {
        var priority = a.priority || (i < 2 ? 'High' : i < 4 ? 'Medium' : 'Low');
        var pc = priority === 'High' ? '#C0392B' : priority === 'Medium' ? '#E67E22' : '#27AE60';
        return '<div class="sc-action-card">' +
          '<div class="sc-action-top">' +
            '<span class="sc-action-num">' + (i + 1) + '</span>' +
            '<span class="sc-action-priority" style="background:' + pc + '">' + priority + '</span>' +
            (a.dimension ? '<span class="sc-action-dim">' + esc(a.dimension) + '</span>' : '') +
          '</div>' +
          '<div class="sc-action-text">' + esc(a.action || a) + '</div>' +
          (a.rationale ? '<div class="sc-action-rationale">' + esc(a.rationale) + '</div>' : '') +
        '</div>';
      }).join('');
    }

    var today = new Date().toLocaleDateString('en-GB');

    var html =
      '<div class="sc-result">' +

        '<div class="sc-result-header">' +
          '<div>' +
            '<div class="sc-result-company">' + esc(state.companyName) + '</div>' +
            '<div class="sc-result-title">Safety Culture Self-Assessment</div>' +
          '</div>' +
          '<div class="sc-result-meta">Completed: ' + today + (state.siteRole ? '<br>By: ' + esc(state.siteRole) : '') + '</div>' +
        '</div>' +

        scoreBar +

        '<div class="sc-result-section">' +
          '<div class="sc-result-label">Overall Assessment</div>' +
          '<p class="sc-result-narrative">' + esc(r.narrative || '') + '</p>' +
        '</div>' +

        '<div class="sc-result-section">' +
          '<div class="sc-result-label">Dimension Scores</div>' +
          '<div class="sc-dim-rows">' + dimRows + '</div>' +
        '</div>' +

        '<div class="sc-result-section">' +
          '<div class="sc-result-label sc-label--green">Strengths</div>' +
          list(r.strengths, '#27AE60') +
        '</div>' +

        '<div class="sc-result-section">' +
          '<div class="sc-result-label sc-label--red">Areas for Improvement</div>' +
          list(r.gaps, '#C0392B') +
        '</div>' +

        '<div class="sc-result-section">' +
          '<div class="sc-result-label sc-label--orange">Prioritised Action Plan</div>' +
          '<div class="sc-actions">' + actions(r.actions) + '</div>' +
        '</div>' +

        (r.f4n_mapping ? '<div class="sc-iaea-note">📎 <strong>F4N Mapping:</strong> ' + esc(r.f4n_mapping) + '</div>' : '') +

        '<div class="sc-result-footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · IAEA/INPO Safety Culture Framework · QHSE-04</div>' +

        '<div class="sc-action-row">' +
          '<button class="assess-nav" id="scRestart" type="button">← New Assessment</button>' +
          '<button class="assess-nav assess-nav--primary" id="scPrint" type="button">🖨️ Print / Save PDF</button>' +
        '</div>' +

      '</div>';

    setBody(html);

    $id('scRestart').addEventListener('click', function () {
      state.phase = 'intro';
      state.scores = {};
      state.result = null;
      renderPhase();
    });

    $id('scPrint').addEventListener('click', function () { printResult(r, pct, rag, ragLabel, today); });
  }

  // ── Claude analysis ─────────────────────────────────────────────────────────

  function analyse(apiKey) {
    var scoreLines = DIMENSIONS.map(function (dim) {
      var score = state.scores[dim.id] || 0;
      return dim.label + ': ' + score + '/3 (' + RATING_LABELS[score] + ') — "' + dim.levels[score] + '"';
    }).join('\n');

    var total = DIMENSIONS.reduce(function (sum, d) { return sum + (state.scores[d.id] || 0); }, 0);
    var max   = DIMENSIONS.length * 3;
    var pct   = Math.round((total / max) * 100);

    var prompt =
      'You are a nuclear safety culture expert familiar with IAEA SF-1, IAEA GS-G-3.5, INPO Principles for a Strong Nuclear Safety Culture, and NuCCoL QHSE-04.\n\n' +
      'A nuclear supply chain company has completed a self-assessment of their safety culture.\n\n' +
      'Company: ' + state.companyName + '\n' +
      (state.siteRole ? 'Assessed by: ' + state.siteRole + '\n' : '') +
      'Overall score: ' + total + '/' + max + ' (' + pct + '%)\n\n' +
      'Dimension scores:\n' + scoreLines + '\n\n' +
      'Return a JSON object ONLY — no markdown, no explanation:\n' +
      '{\n' +
      '  "rag": "RED" | "AMBER" | "GREEN",\n' +
      '  "narrative": "3-4 sentence overall assessment specific to their scores and nuclear supply chain context",\n' +
      '  "strengths": ["strength 1", "strength 2", "strength 3"],  // 2-4 items, reference specific dimensions\n' +
      '  "gaps": ["gap 1", "gap 2", "gap 3"],  // 3-5 items, specific and actionable\n' +
      '  "actions": [\n' +
      '    {\n' +
      '      "action": "specific action to take",\n' +
      '      "priority": "High" | "Medium" | "Low",\n' +
      '      "dimension": "which dimension this addresses",\n' +
      '      "rationale": "why this matters in a nuclear supply chain context"\n' +
      '    }\n' +
      '  ],  // 5-7 prioritised actions ordered High → Low\n' +
      '  "f4n_mapping": "Brief note on how this maps to F4N QHSE criteria and ISO 19443 requirements"\n' +
      '}\n\n' +
      'Be specific to nuclear supply chain (not nuclear operators). Focus on practical, achievable actions for a manufacturing/engineering SME.';

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
        max_tokens: 2500,
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
      state.result = JSON.parse(match[0]);
      state.phase  = 'result';
      renderPhase();
    })
    .catch(function (err) {
      state.error = err.message || 'Something went wrong. Please try again.';
      state.phase = 'rate';
      renderPhase();
    });
  }

  // ── Print ───────────────────────────────────────────────────────────────────

  function printResult(r, pct, rag, ragLabel, today) {
    var ragColour = rag === 'GREEN' ? '#27AE60' : rag === 'AMBER' ? '#E67E22' : '#C0392B';
    var total = DIMENSIONS.reduce(function (sum, d) { return sum + (state.scores[d.id] || 0); }, 0);
    var max   = DIMENSIONS.length * 3;

    function li(items) {
      return items && items.length
        ? '<ul>' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'
        : '<p>—</p>';
    }

    var dimTable = DIMENSIONS.map(function (dim) {
      var score  = state.scores[dim.id] || 0;
      var colour = RATING_COLOURS[score];
      return '<tr><td>' + dim.icon + ' ' + esc(dim.label) + '</td>' +
        '<td style="color:' + colour + ';font-weight:bold;text-align:center">' + score + '/3</td>' +
        '<td style="color:' + colour + '">' + RATING_LABELS[score] + '</td>' +
        '<td style="font-size:9pt;color:#555">' + esc(dim.levels[score]) + '</td></tr>';
    }).join('');

    var actionRows = (r.actions || []).map(function (a, i) {
      var pc = a.priority === 'High' ? '#C0392B' : a.priority === 'Medium' ? '#E67E22' : '#27AE60';
      return '<tr><td style="text-align:center;font-weight:bold">' + (i + 1) + '</td>' +
        '<td style="color:' + pc + ';font-weight:bold">' + esc(a.priority || '') + '</td>' +
        '<td>' + esc(a.dimension || '') + '</td>' +
        '<td>' + esc(a.action || '') + '</td>' +
        '<td style="font-size:9pt;color:#555">' + esc(a.rationale || '') + '</td></tr>';
    }).join('');

    var win = window.open('', '_blank');
    if (!win) { alert('Please allow pop-ups to print.'); return; }

    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Safety Culture Assessment — ' + esc(state.companyName) + '</title><style>' +
      'body{font-family:Arial,sans-serif;font-size:10pt;margin:15mm;color:#111}' +
      'h1{font-size:14pt;color:#1F3A5F;margin:0 0 4px}' +
      'h2{font-size:11pt;color:#1F3A5F;border-left:3px solid #E8532A;padding-left:8px;margin:18px 0 6px}' +
      '.rag-badge{display:inline-block;padding:6px 16px;border-radius:20px;font-weight:bold;font-size:12pt;color:#fff;background:' + ragColour + ';margin:10px 0}' +
      '.score-label{font-size:10pt;color:#555;margin-bottom:14px}' +
      'table{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:12px}' +
      'th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}' +
      'th{background:#EEF4FA;font-weight:bold;color:#1F3A5F}' +
      'ul{margin:4px 0;padding-left:18px;line-height:1.7}' +
      '.footer{text-align:center;font-size:8pt;color:#aaa;margin-top:20px;border-top:1px solid #eee;padding-top:8px}' +
      '@media print{body{margin:8mm}}' +
    '</style></head><body>');

    win.document.write(
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1F3A5F;padding-bottom:10px;margin-bottom:12px">' +
        '<div><h1>' + esc(state.companyName) + '</h1><div style="font-size:11pt;color:#555">Safety Culture Self-Assessment</div></div>' +
        '<div style="font-size:9pt;color:#555;text-align:right">Date: ' + today + (state.siteRole ? '<br>By: ' + esc(state.siteRole) : '') + '</div>' +
      '</div>' +

      '<div class="rag-badge">' + ragLabel + '</div>' +
      '<div class="score-label">' + total + ' / ' + max + ' points (' + pct + '%)</div>' +

      '<h2>Overall Assessment</h2><p>' + esc(r.narrative || '') + '</p>' +

      '<h2>Dimension Scores</h2>' +
      '<table><thead><tr><th>Dimension</th><th>Score</th><th>Rating</th><th>Description</th></tr></thead><tbody>' + dimTable + '</tbody></table>' +

      '<h2>Strengths</h2>' + li(r.strengths) +
      '<h2>Areas for Improvement</h2>' + li(r.gaps) +

      '<h2>Prioritised Action Plan</h2>' +
      '<table><thead><tr><th>#</th><th>Priority</th><th>Dimension</th><th>Action</th><th>Rationale</th></tr></thead><tbody>' + actionRows + '</tbody></table>' +

      (r.f4n_mapping ? '<p><strong>F4N Mapping:</strong> ' + esc(r.f4n_mapping) + '</p>' : '') +

      '<div class="footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · IAEA/INPO Safety Culture Framework · QHSE-04</div>' +
    '</body></html>');

    win.document.close();
    setTimeout(function () { win.focus(); win.print(); }, 400);
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

}());
