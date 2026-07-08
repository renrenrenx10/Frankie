/**
 * toolbox-talk-drawer.js  v1.0
 * Feature 9 — Toolbox Talk Generator
 * Generates a ready-to-deliver, printable toolbox talk grounded in NuCCoL
 * Tool Kit QHSE content. Uses Claude Haiku for generation.
 *
 * Flow: hazard selection → optional custom detail → generate → printable output
 * Styled to match existing assess-* CSS classes throughout.
 */
(function () {
  'use strict';

  var DRAWER_ID = 'toolbox-talk-drawer';

  // ── Hazard categories (grounded in Tool Kit KB) ────────────────────────────
  var HAZARDS = [
    {
      id: 'coshh',
      icon: '⚗️',
      label: 'COSHH — Hazardous Substances',
      context: 'General COSHH awareness: Control of Substances Hazardous to Health Regulations 2002. Aligned to HSG97 and ISO 45001:2018. Key topics: what COSHH covers, routes of exposure (inhalation, skin absorption, ingestion), COSHH assessment, substitution, engineering controls, PPE, health surveillance.'
    },
    {
      id: 'welding',
      icon: '🔥',
      label: 'Welding Fume',
      context: 'Welding fume is a Group 1 carcinogen (IARC). All welding fume — including mild steel — is classified as carcinogenic. Key topics: why welding fume is serious, LEV (local exhaust ventilation) requirements, RPE selection (minimum FFP3), outdoor welding still needs controls, health surveillance, HSE enforcement stance post-2019.'
    },
    {
      id: 'cutting_fluids',
      icon: '🔩',
      label: 'Cutting Fluids & Skin Health',
      context: 'Metalworking cutting fluids: mineral oils, semi-synthetics, synthetics. Health risks: occupational dermatitis (most common), skin sensitisation, Legionella risk in water-miscible fluids. Key topics: skin checks, pre-work skin assessment, barrier creams, PPE (nitrile gloves), fluid concentration checks, sump management, COSHH assessment for cutting fluids.'
    },
    {
      id: 'solvents',
      icon: '🧪',
      label: 'Solvents & Chemical Safety',
      context: 'Solvents in engineering workshops: degreasers, acetone, IPA, trichloroethylene alternatives, adhesives. Key topics: flammability and ignition sources, vapour inhalation risks, skin defatting and dermatitis, safe storage (COSHH cabinet), ventilation requirements, spill response, no eating/drinking in work areas, disposal of contaminated rags.'
    },
    {
      id: 'manual_handling',
      icon: '🏋️',
      label: 'Manual Handling',
      context: 'Manual Handling Operations Regulations 1992. Key topics: the hierarchy (avoid → assess → reduce risk), TILE risk assessment (Task, Individual, Load, Environment), safe lifting technique (plan the lift, feet apart, bend knees, keep load close, no twisting), team lifts, use of mechanical aids (hoists, pallet trucks, trolleys), reporting pain early.'
    },
    {
      id: 'working_at_height',
      icon: '🪜',
      label: 'Working at Height',
      context: 'Work at Height Regulations 2005. Key topics: hierarchy of control (avoid, prevent fall, mitigate consequences), when ladders are acceptable vs when a platform is required, inspection before use, scaffold inspection tags, harness use and inspection, exclusion zones below working areas, never overreach, never stand on top steps of a stepladder, reporting defects.'
    },
    {
      id: 'fire_safety',
      icon: '🔥',
      label: 'Fire Safety',
      context: 'Regulatory Reform (Fire Safety) Order 2005. Key topics: fire triangle (fuel, heat, oxygen), common ignition sources in engineering (welding, grinding, electrical faults, smoking), fire classes and extinguisher types (water, CO2, foam, powder, wet chemical), fire alarm response (RACE: Rescue, Alert, Contain, Evacuate), muster points, never re-enter a building, clear fire exits and no propping fire doors.'
    },
    {
      id: 'electrical',
      icon: '⚡',
      label: 'Electrical Safety',
      context: 'Electricity at Work Regulations 1989. Key topics: never work on live equipment without permit, PAT testing and what to look for (damaged cables, cracked plugs, scorch marks), isolation and lock-off procedure, no DIY electrical work, overhead power lines near mobile plant, underground cables before digging, RCD protection, reporting electrical faults immediately, wet conditions and electrical equipment.'
    },
    {
      id: 'custom',
      icon: '✏️',
      label: 'Custom — describe your activity',
      context: null
    }
  ];

  var state = {
    phase: 'select',   // 'select' | 'detail' | 'loading' | 'result'
    hazard: null,
    customDetail: '',
    companyName: '',
    conductedBy: '',
    result: null,
    error: null
  };

  // ── Public API ─────────────────────────────────────────────────────────────
  window.ToolboxTalkDrawer = {
    open: function () {
      injectDrawer();
      state.phase = 'select';
      state.hazard = null;
      state.result = null;
      state.error = null;
      render();
      var d = document.getElementById(DRAWER_ID);
      d.classList.remove('assess-drawer--closed');
      d.classList.add('assess-drawer--open');
    }
  };

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function $id(id) { return document.getElementById(id); }
  function setBody(html) { var el = $id('tbt-body'); if (el) el.innerHTML = html; }

  // ── Drawer scaffold ────────────────────────────────────────────────────────
  function injectDrawer() {
    if ($id(DRAWER_ID)) return;
    var el = document.createElement('div');
    el.id        = DRAWER_ID;
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML =
      '<div class="assess-backdrop" id="tbtBackdrop"></div>' +
      '<div class="assess-panel">' +
        '<div class="assess-topbar">' +
          '<span class="assess-icon">🦺</span>' +
          '<div class="assess-title" id="tbtTitle">Toolbox Talk Generator</div>' +
          '<button class="assess-close" id="tbtClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="assess-body" id="tbt-body"></div>' +
        '<div class="assess-footer" id="tbt-footer" style="display:none;">' +
          '<button class="assess-nav" id="tbtBack" type="button">← Start Over</button>' +
          '<button class="assess-nav assess-nav--primary" id="tbtPrint" type="button">🖨 Print / Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    $id('tbtClose').addEventListener('click', close);
    $id('tbtBackdrop').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    $id('tbtBack').addEventListener('click', function () {
      state.phase = 'select';
      state.hazard = null;
      state.result = null;
      state.error = null;
      render();
    });
    $id('tbtPrint').addEventListener('click', printTalk);
  }

  function close() {
    var d = $id(DRAWER_ID);
    if (!d) return;
    d.classList.remove('assess-drawer--open');
    d.classList.add('assess-drawer--closed');
  }

  // ── Render router ──────────────────────────────────────────────────────────
  function render() {
    var footer = $id('tbt-footer');
    if (footer) footer.style.display = state.phase === 'result' ? '' : 'none';
    if      (state.phase === 'select')  renderSelect();
    else if (state.phase === 'detail')  renderDetail();
    else if (state.phase === 'loading') renderLoading();
    else if (state.phase === 'result')  renderResult();
  }

  // ── Phase 1: Hazard selection ──────────────────────────────────────────────
  function renderSelect() {
    var cards = HAZARDS.map(function (h) {
      return (
        '<button class="tbt-hazard-card" data-id="' + h.id + '" type="button">' +
          '<span class="tbt-hazard-icon">' + h.icon + '</span>' +
          '<span class="tbt-hazard-label">' + h.label + '</span>' +
        '</button>'
      );
    }).join('');

    setBody(
      '<div class="tbt-intro">' +
        '<p>Select a hazard or activity below. Frankie will generate a ready-to-deliver toolbox talk grounded in NuCCoL QHSE guidance — complete with risks, controls, legal references, and a printable attendance record.</p>' +
      '</div>' +
      '<div class="tbt-hazard-grid">' + cards + '</div>'
    );

    document.querySelectorAll('.tbt-hazard-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var id = card.dataset.id;
        state.hazard = HAZARDS.filter(function (h) { return h.id === id; })[0];
        state.phase = 'detail';
        render();
      });
    });
  }

  // ── Phase 2: Detail / confirm ──────────────────────────────────────────────
  function renderDetail() {
    var isCustom = state.hazard.id === 'custom';
    var saved = localStorage.getItem('tbt_company') || '';
    var savedBy = localStorage.getItem('tbt_conductedby') || '';

    setBody(
      '<div class="tbt-detail">' +
        '<div class="tbt-selected-badge">' + state.hazard.icon + '  ' + state.hazard.label + '</div>' +

        (isCustom
          ? '<label class="sv-label">Describe the activity or hazard</label>' +
            '<textarea class="tbt-textarea" id="tbtCustom" rows="4" placeholder="e.g. Grinding carbon steel components in the machine shop — dust exposure and noise">' + escapeHtml(state.customDetail) + '</textarea>'
          : '<label class="sv-label">Any specific details to include? <span class="sv-label-hint">(optional)</span></label>' +
            '<textarea class="tbt-textarea" id="tbtCustom" rows="3" placeholder="e.g. We use argon-shielded MIG welding on stainless steel in the fabrication bay"></textarea>'
        ) +

        '<label class="sv-label" style="margin-top:16px;">Company name <span class="sv-label-hint">(for the printed record)</span></label>' +
        '<input class="sv-input" id="tbtCompany" type="text" placeholder="e.g. Acme Engineering Ltd" value="' + escapeHtml(saved) + '" />' +

        '<label class="sv-label">Conducted by</label>' +
        '<input class="sv-input" id="tbtConductedBy" type="text" placeholder="e.g. John Smith — H&S Manager" value="' + escapeHtml(savedBy) + '" />' +

        (state.error ? '<div class="sv-error" style="margin-top:12px;">' + escapeHtml(state.error) + '</div>' : '') +

        '<button class="assess-nav assess-nav--primary" id="tbtGenerate" style="margin-top:20px;width:100%;" type="button">⚡ Generate Toolbox Talk</button>' +
        '<button class="assess-nav" id="tbtBackSelect" style="margin-top:10px;width:100%;" type="button">← Change Topic</button>' +
      '</div>'
    );

    $id('tbtGenerate').addEventListener('click', function () {
      var custom  = ($id('tbtCustom')      ? $id('tbtCustom').value.trim()      : '');
      var company = ($id('tbtCompany')     ? $id('tbtCompany').value.trim()     : '');
      var condBy  = ($id('tbtConductedBy') ? $id('tbtConductedBy').value.trim() : '');

      if (state.hazard.id === 'custom' && !custom) {
        state.error = 'Please describe the activity or hazard.';
        render();
        return;
      }
      var apiKey = localStorage.getItem('frankieClaudeKey') || '';
      if (!apiKey) {
        state.error = 'No Claude API key found. Please add your key in Frankie settings.';
        render();
        return;
      }

      if (company) localStorage.setItem('tbt_company', company);
      if (condBy)  localStorage.setItem('tbt_conductedby', condBy);

      state.customDetail  = custom;
      state.companyName   = company;
      state.conductedBy   = condBy;
      state.error         = null;
      state.phase         = 'loading';
      render();
      generateTalk(apiKey);
    });

    $id('tbtBackSelect').addEventListener('click', function () {
      state.phase = 'select';
      render();
    });
  }

  // ── Phase 3: Loading ───────────────────────────────────────────────────────
  function renderLoading() {
    setBody(
      '<div class="assess-loading">' +
        '<div class="sv-spinner"></div>' +
        '<p>Generating your toolbox talk…</p>' +
        '<p style="font-size:13px;color:#888;margin-top:8px;">Grounded in NuCCoL QHSE guidance</p>' +
      '</div>'
    );
  }

  // ── Phase 4: Result ────────────────────────────────────────────────────────
  function renderResult() {
    var t = state.result;
    if (!t) return;

    var today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    var company = state.companyName || '[Company Name]';
    var condBy  = state.conductedBy  || '[Name / Role]';

    var risksHtml = (t.risks || []).map(function (r) {
      return '<li class="tbt-list-item"><span class="tbt-risk-dot">⚠</span>' + escapeHtml(r) + '</li>';
    }).join('');

    var controlsHtml = (t.controls || []).map(function (c) {
      return '<li class="tbt-list-item"><span class="tbt-ok-dot">✓</span>' + escapeHtml(c) + '</li>';
    }).join('');

    var messagesHtml = (t.keyMessages || []).map(function (m, i) {
      return '<div class="tbt-key-msg"><span class="tbt-msg-num">' + (i + 1) + '</span>' + escapeHtml(m) + '</div>';
    }).join('');

    var attendeeRows = '';
    for (var i = 1; i <= 10; i++) {
      attendeeRows += '<tr><td class="tbt-att-td">' + i + '</td><td class="tbt-att-td tbt-att-name"></td><td class="tbt-att-td tbt-att-sig"></td></tr>';
    }

    setBody(
      '<div class="tbt-result" id="tbt-printable">' +

        // Header
        '<div class="tbt-result-header">' +
          '<div class="tbt-result-logo">🦺 NuCCoL Toolbox Talk</div>' +
          '<div class="tbt-result-meta">' +
            '<div><strong>Company:</strong> ' + escapeHtml(company) + '</div>' +
            '<div><strong>Date:</strong> ' + today + '</div>' +
            '<div><strong>Conducted by:</strong> ' + escapeHtml(condBy) + '</div>' +
            '<div><strong>Duration:</strong> ' + escapeHtml(t.duration || '10–15 minutes') + '</div>' +
          '</div>' +
        '</div>' +

        // Title
        '<h2 class="tbt-result-title">' + escapeHtml(t.title || state.hazard.label) + '</h2>' +

        (t.intro ? '<p class="tbt-result-intro">' + escapeHtml(t.intro) + '</p>' : '') +

        // Legal basis
        (t.legalBasis
          ? '<div class="tbt-section-block tbt-legal"><span class="tbt-section-label">📋 Legal Basis</span><p>' + escapeHtml(t.legalBasis) + '</p></div>'
          : '') +

        // Risks
        '<div class="tbt-section-block">' +
          '<span class="tbt-section-label tbt-label-risk">⚠ Key Risks</span>' +
          '<ul class="tbt-list">' + risksHtml + '</ul>' +
        '</div>' +

        // Controls
        '<div class="tbt-section-block">' +
          '<span class="tbt-section-label tbt-label-ok">✓ What You Must Do</span>' +
          '<ul class="tbt-list">' + controlsHtml + '</ul>' +
        '</div>' +

        // What if
        (t.whatIf
          ? '<div class="tbt-section-block tbt-whatif"><span class="tbt-section-label">🚨 What to Do If Something Goes Wrong</span><p>' + escapeHtml(t.whatIf) + '</p></div>'
          : '') +

        // Key messages
        '<div class="tbt-section-block">' +
          '<span class="tbt-section-label tbt-label-msg">💬 3 Things to Remember</span>' +
          '<div class="tbt-key-msgs">' + messagesHtml + '</div>' +
        '</div>' +

        // Attendance
        '<div class="tbt-section-block tbt-attendance">' +
          '<span class="tbt-section-label">✍ Attendance Record</span>' +
          '<p style="font-size:13px;color:#666;margin:6px 0 10px;">By signing below, attendees confirm they have received and understood this toolbox talk.</p>' +
          '<table class="tbt-att-table">' +
            '<thead><tr><th class="tbt-att-th">#</th><th class="tbt-att-th">Name (print)</th><th class="tbt-att-th">Signature</th></tr></thead>' +
            '<tbody>' + attendeeRows + '</tbody>' +
          '</table>' +
          '<div class="tbt-att-footer">' +
            '<div><strong>Conducted by:</strong> ' + escapeHtml(condBy) + '&nbsp;&nbsp;&nbsp;<span style="color:#aaa;">Signature: ____________________</span></div>' +
          '</div>' +
        '</div>' +

        '<div class="tbt-result-footer">Generated by Frankie · NuCCoL · Grounded in NuCCoL QHSE Tool Kit guidance</div>' +

      '</div>'
    );
  }

  // ── Generation ─────────────────────────────────────────────────────────────
  function generateTalk(apiKey) {
    var hazard  = state.hazard;
    var context = hazard.context || '';
    var custom  = state.customDetail;

    var hazardDesc = hazard.id === 'custom'
      ? custom
      : hazard.label + (custom ? '. Additional detail: ' + custom : '');

    var prompt = [
      'You are an expert QHSE adviser for a UK nuclear supply chain manufacturer. Generate a structured toolbox talk for the following topic:',
      '',
      'TOPIC: ' + hazardDesc,
      '',
      (context ? 'BACKGROUND KNOWLEDGE (use this as your grounding):\n' + context : ''),
      '',
      'Return a JSON object only — no markdown, no explanation — with exactly these fields:',
      '  title: string (concise toolbox talk title)',
      '  duration: string (e.g. "10–15 minutes")',
      '  intro: string (1–2 sentence scene-setter — why this topic matters today)',
      '  legalBasis: string (the key UK regulation(s) that apply, one sentence)',
      '  risks: array of 4–6 strings (specific risks for this hazard)',
      '  controls: array of 6–9 strings (practical things workers must do / not do)',
      '  whatIf: string (2–3 sentences on what to do if something goes wrong — report, evacuate, first aid)',
      '  keyMessages: array of exactly 3 strings (the 3 things every worker must remember — short, memorable)',
      '',
      'Be specific, practical, and relevant to a UK manufacturing / engineering environment. Use plain language — this is for shopfloor workers.',
      'Return only the JSON object.',
    ].filter(Boolean).join('\n');

    var model = 'claude-haiku-4-5-20251001';

    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':           apiKey,
        'anthropic-version':   '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type':        'application/json',
      },
      body: JSON.stringify({
        model:      model,
        max_tokens: 1500,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    .then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || 'Claude API error ' + r.status); });
      return r.json();
    })
    .then(function (data) {
      var text = data.content && data.content[0] && data.content[0].text || '{}';
      var match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse the generated toolbox talk. Please try again.');
      state.result = JSON.parse(match[0]);
      state.phase  = 'result';
      render();
    })
    .catch(function (err) {
      state.error = err.message || 'Something went wrong. Please try again.';
      state.phase = 'detail';
      render();
    });
  }

  // ── Print ──────────────────────────────────────────────────────────────────
  function printTalk() {
    var printable = $id('tbt-printable');
    if (!printable) return;

    var win = window.open('', '_blank');
    win.document.write(
      '<!DOCTYPE html><html><head><title>Toolbox Talk</title>' +
      '<style>' +
        'body { font-family: Arial, sans-serif; font-size: 13px; color: #222; margin: 24px; }' +
        '.tbt-result-header { display: flex; justify-content: space-between; border-bottom: 2px solid #1F3A5F; padding-bottom: 10px; margin-bottom: 14px; }' +
        '.tbt-result-logo { font-size: 18px; font-weight: bold; color: #1F3A5F; }' +
        '.tbt-result-meta div { font-size: 12px; margin: 2px 0; }' +
        '.tbt-result-title { font-size: 20px; color: #1F3A5F; margin: 10px 0 6px; }' +
        '.tbt-result-intro { color: #444; margin: 0 0 14px; }' +
        '.tbt-section-block { margin: 14px 0; }' +
        '.tbt-section-label { display: block; font-weight: bold; font-size: 13px; color: #1F3A5F; margin-bottom: 6px; border-left: 3px solid #E8532A; padding-left: 8px; }' +
        '.tbt-list { margin: 0; padding: 0; list-style: none; }' +
        '.tbt-list-item { display: flex; gap: 8px; margin: 4px 0; font-size: 13px; }' +
        '.tbt-risk-dot { color: #C0392B; font-size: 14px; flex-shrink: 0; }' +
        '.tbt-ok-dot { color: #27AE60; font-size: 14px; flex-shrink: 0; }' +
        '.tbt-legal p, .tbt-whatif p { margin: 4px 0; color: #444; }' +
        '.tbt-key-msgs { display: flex; gap: 10px; flex-wrap: wrap; }' +
        '.tbt-key-msg { flex: 1; min-width: 140px; background: #EEF4FA; border-left: 3px solid #1F3A5F; padding: 8px 10px; font-size: 12px; border-radius: 4px; }' +
        '.tbt-msg-num { display: block; font-size: 20px; font-weight: bold; color: #1F3A5F; }' +
        '.tbt-att-table { width: 100%; border-collapse: collapse; margin-top: 8px; }' +
        '.tbt-att-th, .tbt-att-td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; }' +
        '.tbt-att-th { background: #EEF4FA; font-weight: bold; }' +
        '.tbt-att-name, .tbt-att-sig { width: 40%; }' +
        '.tbt-att-footer { margin-top: 12px; font-size: 12px; }' +
        '.tbt-result-footer { margin-top: 20px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; }' +
        '@media print { body { margin: 10mm; } }' +
      '</style></head><body>' +
      printable.innerHTML +
      '</body></html>'
    );
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 400);
  }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

}());
