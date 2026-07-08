/**
 * sop-builder-drawer.js  v1.0
 * SOP Builder (Feature 10) — Guided Q&A → Draft SOP to NuCCoL PE-06 standard.
 * Flow: step 1 (process info) → step 2 (roles & controls) → step 3 (quality & refs) → loading → result
 * Calls Claude Haiku directly from browser using frankieClaudeKey from localStorage.
 */
(function () {
  'use strict';

  var DRAWER_ID = 'sop-builder-drawer';

  // SOP categories matching PE-06 NuCCoL process excellence framework
  var SOP_CATEGORIES = [
    { id: 'manufacturing', icon: '⚙️', label: 'Manufacturing Process' },
    { id: 'inspection',    icon: '🔍', label: 'Inspection & Testing' },
    { id: 'handling',      icon: '📦', label: 'Material Handling & Storage' },
    { id: 'welding',       icon: '🔥', label: 'Welding & Fabrication' },
    { id: 'cleaning',      icon: '🧹', label: 'Cleaning & Decontamination' },
    { id: 'maintenance',   icon: '🔧', label: 'Maintenance & Servicing' },
    { id: 'document',      icon: '📋', label: 'Document & Record Control' },
    { id: 'supplier',      icon: '🚚', label: 'Supplier & Purchasing Control' },
    { id: 'training',      icon: '🎓', label: 'Training & Competency' },
    { id: 'safety',        icon: '🦺', label: 'Health, Safety & COSHH' },
    { id: 'audit',         icon: '✅', label: 'Audit & Nonconformance' },
    { id: 'custom',        icon: '✏️', label: 'Other / Custom' },
  ];

  var state = {
    phase: 'step1',   // step1 | step2 | step3 | loading | result
    category: null,
    categoryLabel: '',
    // Step 1
    processTitle: '',
    processScope: '',
    siteDept: '',
    // Step 2
    responsible: '',
    personnel: '',
    ppe: '',
    hazards: '',
    // Step 3
    qualityPoints: '',
    references: '',
    companyName: '',
    docRef: '',
    // Result
    sopText: '',
    sopJson: null,
    error: null,
  };

  // ── Public API ──────────────────────────────────────────────────────────────

  window.SopBuilderDrawer = {
    open: function () {
      injectDrawer();
      // Restore saved fields
      state.companyName = localStorage.getItem('sop_company') || '';
      state.phase = 'step1';
      state.category = null;
      state.sopJson = null;
      state.error = null;
      renderPhase();
      var drawer = document.getElementById(DRAWER_ID);
      drawer.classList.remove('assess-drawer--closed');
      drawer.classList.add('assess-drawer--open');
    }
  };

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function $id(id) { return document.getElementById(id); }
  function setBody(html) { var el = $id('sop-body'); if (el) el.innerHTML = html; }
  function val(id) { var el = $id(id); return el ? (el.value || '').trim() : ''; }

  // ── Drawer injection ────────────────────────────────────────────────────────

  function injectDrawer() {
    if ($id(DRAWER_ID)) return;
    var el = document.createElement('div');
    el.id        = DRAWER_ID;
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML =
      '<div class="assess-backdrop" id="sopBackdrop"></div>' +
      '<div class="assess-panel">' +
        '<div class="assess-topbar">' +
          '<span class="assess-icon">📋</span>' +
          '<div class="assess-title">SOP Builder</div>' +
          '<button class="assess-close" id="sopClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="sop-progress" id="sop-progress"></div>' +
        '<div class="assess-body" id="sop-body"></div>' +
      '</div>';
    document.body.appendChild(el);

    $id('sopClose').addEventListener('click', closeDrawer);
    $id('sopBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  }

  function closeDrawer() {
    var d = $id(DRAWER_ID);
    if (!d) return;
    d.classList.remove('assess-drawer--open');
    d.classList.add('assess-drawer--closed');
  }

  // ── Progress bar ────────────────────────────────────────────────────────────

  var STEPS = ['step1', 'step2', 'step3', 'loading', 'result'];
  var STEP_LABELS = ['Process', 'People & Safety', 'Quality & Refs', '', 'Your SOP'];

  function renderProgress() {
    var el = $id('sop-progress');
    if (!el) return;
    var currentIdx = STEPS.indexOf(state.phase);
    if (currentIdx < 0 || state.phase === 'loading') { el.innerHTML = ''; return; }

    var dots = [0, 1, 2, 4].map(function (i) {
      var active  = i === currentIdx ? ' sop-step--active' : '';
      var done    = i < currentIdx   ? ' sop-step--done'   : '';
      return '<div class="sop-step' + active + done + '">' +
        '<div class="sop-step-dot">' + (i < currentIdx ? '✓' : (i / 1 + 1)) + '</div>' +
        '<div class="sop-step-label">' + STEP_LABELS[i] + '</div>' +
      '</div>';
    }).join('<div class="sop-step-line"></div>');

    el.innerHTML = '<div class="sop-progress-inner">' + dots + '</div>';
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

  // ── Step 1: Process info + category ────────────────────────────────────────

  function renderStep1() {
    var catGrid = SOP_CATEGORIES.map(function (c) {
      var active = state.category === c.id ? ' sop-cat--active' : '';
      return '<button type="button" class="sop-cat-card' + active + '" data-cat="' + c.id + '" data-label="' + escHtml(c.label) + '">' +
        '<span class="sop-cat-icon">' + c.icon + '</span>' +
        '<span class="sop-cat-label">' + escHtml(c.label) + '</span>' +
      '</button>';
    }).join('');

    setBody(
      '<div class="sop-intro"><p>Answer three short sections and Frankie will draft a complete SOP to <strong>NuCCoL PE-06</strong> standard — ready to review, edit, and use.</p></div>' +

      '<div class="sop-section-title">What type of process is this SOP for?</div>' +
      '<div class="sop-cat-grid">' + catGrid + '</div>' +

      '<div class="sop-fields">' +
        field('SOP Title', 'sop-title', 'e.g. Manual Deburring of Stainless Steel Components', state.processTitle) +
        field('Scope — what does this SOP cover?', 'sop-scope', 'e.g. Applies to all operators in the machining cell performing hand deburring of SS304 parts after turning operations', state.processScope, true) +
        field('Department / Site', 'sop-dept', 'e.g. Machining Cell, Sheffield Site', state.siteDept) +
        field('Your Company Name', 'sop-company', 'e.g. Precision Nuclear Ltd', state.companyName) +
        field('Document Reference (optional)', 'sop-docref', 'e.g. PE-06-001', state.docRef) +
      '</div>' +

      (state.error ? '<div class="sop-error">' + escHtml(state.error) + '</div>' : '') +

      '<div class="sop-nav-row">' +
        '<button class="assess-nav assess-nav--primary sop-next" id="sopNext1" type="button">Next: People &amp; Safety →</button>' +
      '</div>'
    );

    document.querySelectorAll('.sop-cat-card').forEach(function (card) {
      card.addEventListener('click', function () {
        state.category = card.dataset.cat;
        state.categoryLabel = card.dataset.label;
        document.querySelectorAll('.sop-cat-card').forEach(function (c) { c.classList.remove('sop-cat--active'); });
        card.classList.add('sop-cat--active');
      });
    });

    $id('sopNext1').addEventListener('click', function () {
      state.processTitle = val('sop-title');
      state.processScope = val('sop-scope');
      state.siteDept     = val('sop-dept');
      state.companyName  = val('sop-company');
      state.docRef       = val('sop-docref');
      state.error = null;

      if (!state.category)      { state.error = 'Please select a process type.'; renderStep1(); return; }
      if (!state.processTitle)  { state.error = 'Please enter a title for the SOP.'; renderStep1(); return; }
      if (!state.processScope)  { state.error = 'Please describe the scope.'; renderStep1(); return; }

      if (state.companyName) localStorage.setItem('sop_company', state.companyName);
      state.phase = 'step2';
      renderPhase();
    });
  }

  // ── Step 2: Roles, PPE, hazards ────────────────────────────────────────────

  function renderStep2() {
    setBody(
      '<div class="sop-section-title">People, Roles &amp; Safety</div>' +

      '<div class="sop-fields">' +
        field('Who is responsible for this procedure?', 'sop-responsible',
          'e.g. Cell Supervisor / Quality Engineer', state.responsible) +

        field('Who performs this procedure?', 'sop-personnel',
          'e.g. Trained machine operators, minimum 6 months experience', state.personnel) +

        field('PPE required', 'sop-ppe',
          'e.g. Cut-resistant gloves (EN388), safety glasses, steel-toecap boots', state.ppe) +

        field('Hazards / risks (brief list)', 'sop-hazards',
          'e.g. Sharp edges causing laceration; COSHH exposure to metalworking fluids; manual handling of heavy parts', state.hazards, true) +
      '</div>' +

      (state.error ? '<div class="sop-error">' + escHtml(state.error) + '</div>' : '') +

      '<div class="sop-nav-row">' +
        '<button class="assess-nav" id="sopBack2" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="sopNext2" type="button">Next: Quality &amp; Refs →</button>' +
      '</div>'
    );

    $id('sopBack2').addEventListener('click', function () { state.phase = 'step1'; renderPhase(); });
    $id('sopNext2').addEventListener('click', function () {
      state.responsible = val('sop-responsible');
      state.personnel   = val('sop-personnel');
      state.ppe         = val('sop-ppe');
      state.hazards     = val('sop-hazards');
      state.error = null;

      if (!state.responsible) { state.error = 'Please enter who is responsible.'; renderStep2(); return; }
      if (!state.personnel)   { state.error = 'Please enter who performs this procedure.'; renderStep2(); return; }

      state.phase = 'step3';
      renderPhase();
    });
  }

  // ── Step 3: Quality points, references ─────────────────────────────────────

  function renderStep3() {
    setBody(
      '<div class="sop-section-title">Quality Requirements &amp; References</div>' +

      '<div class="sop-fields">' +
        field('Key quality / acceptance criteria', 'sop-quality',
          'e.g. No sharp edges >0.2mm radius; surface finish Ra <1.6; 100% visual inspection before transfer; record on job card',
          state.qualityPoints, true) +

        field('Related documents / references (optional)', 'sop-refs',
          'e.g. Drawing No. XYZ-001, COSHH Assessment CA-22, Quality Plan QP-003, Customer Spec Rev B',
          state.references, true) +

        field('Any other specific requirements?', 'sop-extra',
          'e.g. Nuclear-grade traceability required; parts must remain bagged until point of use',
          state.extra || '', true) +
      '</div>' +

      '<div class="sop-info-box">💡 Frankie will structure the SOP with: purpose, scope, responsibilities, equipment/materials, step-by-step procedure, quality checks, safety, records, and references.</div>' +

      (state.error ? '<div class="sop-error">' + escHtml(state.error) + '</div>' : '') +

      '<div class="sop-nav-row">' +
        '<button class="assess-nav" id="sopBack3" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="sopGenerate" type="button">✨ Generate SOP</button>' +
      '</div>'
    );

    $id('sopBack3').addEventListener('click', function () { state.phase = 'step2'; renderPhase(); });
    $id('sopGenerate').addEventListener('click', function () {
      state.qualityPoints = val('sop-quality');
      state.references    = val('sop-refs');
      state.extra         = val('sop-extra');
      state.error = null;

      if (!state.qualityPoints) { state.error = 'Please enter at least one quality or acceptance criterion.'; renderStep3(); return; }

      var claudeKey = localStorage.getItem('frankieClaudeKey') || '';
      if (!claudeKey) { state.error = 'No Claude API key found. Please add your key in Frankie settings.'; renderStep3(); return; }

      state.phase = 'loading';
      renderPhase();
      generateSop(claudeKey);
    });
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  function renderLoading() {
    setBody(
      '<div class="assess-loading">' +
        '<div class="sop-spinner"></div>' +
        '<p><strong>Writing your SOP…</strong></p>' +
        '<p class="sop-loading-sub">Frankie is structuring the procedure to PE-06 standard. This takes around 15 seconds.</p>' +
      '</div>'
    );
  }

  // ── Result ──────────────────────────────────────────────────────────────────

  function renderResult() {
    var s = state.sopJson;
    if (!s) { setBody('<div class="sop-error">Something went wrong — no SOP data returned.</div>'); return; }

    var today     = new Date().toLocaleDateString('en-GB');
    var company   = escHtml(state.companyName || 'Your Company');
    var docRef    = escHtml(state.docRef || 'SOP-' + Date.now().toString().slice(-5));
    var title     = escHtml(s.title || state.processTitle);
    var version   = escHtml(s.version || '1.0');

    function section(label, content, colorClass) {
      return '<div class="sop-result-section">' +
        '<div class="sop-result-label ' + (colorClass || '') + '">' + label + '</div>' +
        '<div class="sop-result-content">' + content + '</div>' +
      '</div>';
    }

    function list(items) {
      if (!items || !items.length) return '<p>—</p>';
      return '<ul class="sop-ul">' + items.map(function (i) { return '<li>' + escHtml(i) + '</li>'; }).join('') + '</ul>';
    }

    function steps(items) {
      if (!items || !items.length) return '<p>—</p>';
      return '<ol class="sop-ol">' + items.map(function (step) {
        var heading = step.step ? '<strong>' + escHtml(step.step) + '</strong><br>' : '';
        var detail  = step.detail ? escHtml(step.detail) : escHtml(step);
        return '<li>' + heading + detail + '</li>';
      }).join('') + '</ol>';
    }

    var html =
      '<div class="sop-result">' +

        // Header
        '<div class="sop-result-header">' +
          '<div>' +
            '<div class="sop-result-company">' + company + '</div>' +
            '<div class="sop-result-title">' + title + '</div>' +
          '</div>' +
          '<div class="sop-result-meta">' +
            '<div>Doc Ref: <strong>' + docRef + '</strong></div>' +
            '<div>Version: <strong>' + version + '</strong></div>' +
            '<div>Date: <strong>' + today + '</strong></div>' +
            '<div>Category: <strong>' + escHtml(state.categoryLabel) + '</strong></div>' +
          '</div>' +
        '</div>' +

        section('1. Purpose', '<p>' + escHtml(s.purpose || '') + '</p>') +
        section('2. Scope', '<p>' + escHtml(s.scope || '') + '</p>') +
        section('3. Responsibilities', list(s.responsibilities)) +
        section('4. Equipment &amp; Materials', list(s.equipment)) +
        section('5. Safety &amp; PPE', list(s.safety), 'sop-label--safety') +
        section('6. Procedure', steps(s.procedure), 'sop-label--steps') +
        section('7. Quality Checks &amp; Acceptance Criteria', list(s.quality_checks), 'sop-label--quality') +
        section('8. Records', list(s.records)) +
        (s.references && s.references.length ? section('9. References &amp; Related Documents', list(s.references)) : '') +

        // Review / approval table
        '<div class="sop-approval">' +
          '<div class="sop-result-label">Document Control</div>' +
          '<table class="sop-approval-table">' +
            '<thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead>' +
            '<tbody>' +
              '<tr><td>Prepared by</td><td></td><td></td><td>' + today + '</td></tr>' +
              '<tr><td>Reviewed by</td><td></td><td></td><td></td></tr>' +
              '<tr><td>Approved by</td><td></td><td></td><td></td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>' +

        '<div class="sop-result-footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · PE-06 standard</div>' +

        '<div class="sop-action-row">' +
          '<button class="assess-nav" id="sopRestart" type="button">← New SOP</button>' +
          '<button class="assess-nav assess-nav--primary" id="sopCopy" type="button">📋 Copy Text</button>' +
          '<button class="assess-nav assess-nav--primary" id="sopPrint" type="button">🖨️ Print / Save PDF</button>' +
        '</div>' +

      '</div>';

    setBody(html);

    $id('sopRestart').addEventListener('click', function () {
      state.phase = 'step1';
      state.category = null;
      state.sopJson = null;
      state.error = null;
      renderPhase();
    });

    $id('sopCopy').addEventListener('click', function () {
      var text = buildPlainText(s, company, docRef, title, version, today);
      navigator.clipboard.writeText(text).then(function () {
        var btn = $id('sopCopy');
        if (btn) { btn.textContent = '✓ Copied!'; setTimeout(function () { if ($id('sopCopy')) $id('sopCopy').textContent = '📋 Copy Text'; }, 2000); }
      });
    });

    $id('sopPrint').addEventListener('click', function () { printSop(s, company, docRef, title, version, today); });
  }

  // ── Claude API call ─────────────────────────────────────────────────────────

  function generateSop(apiKey) {
    var catInfo = state.category === 'custom' ? state.processTitle : state.categoryLabel;

    var prompt =
      'You are a quality management expert specialising in the nuclear supply chain and ISO 9001/AS9100 compliant SOPs.\n' +
      'Draft a complete Standard Operating Procedure (SOP) to NuCCoL PE-06 standard for the following:\n\n' +
      'Process Category: ' + catInfo + '\n' +
      'SOP Title: ' + state.processTitle + '\n' +
      'Scope: ' + state.processScope + '\n' +
      'Department/Site: ' + (state.siteDept || 'Not specified') + '\n' +
      'Responsible Person: ' + state.responsible + '\n' +
      'Personnel Who Perform: ' + state.personnel + '\n' +
      'PPE Required: ' + (state.ppe || 'Standard PPE as per risk assessment') + '\n' +
      'Hazards: ' + (state.hazards || 'As per relevant risk assessment') + '\n' +
      'Quality/Acceptance Criteria: ' + state.qualityPoints + '\n' +
      (state.references ? 'Related Documents: ' + state.references + '\n' : '') +
      (state.extra ? 'Additional Requirements: ' + state.extra + '\n' : '') +
      '\n' +
      'Return a JSON object ONLY — no markdown, no explanation. Structure:\n' +
      '{\n' +
      '  "title": "full SOP title",\n' +
      '  "version": "1.0",\n' +
      '  "purpose": "one clear sentence on why this SOP exists",\n' +
      '  "scope": "what is covered and any exclusions",\n' +
      '  "responsibilities": ["Role: responsibility", ...],  // 3-6 items\n' +
      '  "equipment": ["item 1", "item 2", ...],  // tools, materials, consumables\n' +
      '  "safety": ["PPE/hazard/COSHH point 1", ...],  // 4-8 items\n' +
      '  "procedure": [\n' +
      '    {"step": "Step title", "detail": "What to do, how, key checks"},\n' +
      '    ...\n' +
      '  ],  // 6-14 steps appropriate to the process\n' +
      '  "quality_checks": ["Criterion / check point 1", ...],  // 4-8 items\n' +
      '  "records": ["Record to complete / retain 1", ...],  // 3-6 items\n' +
      '  "references": ["Doc ref 1", ...]  // related docs if any\n' +
      '}\n' +
      'Make the procedure detailed and practical. Use imperative verbs (Ensure, Verify, Record, Apply). ' +
      'Steps should reflect real nuclear supply chain quality expectations — traceability, inspection hold points, non-conformance controls.';

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
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    .then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || 'Claude API error ' + r.status); });
      return r.json();
    })
    .then(function (data) {
      var text = data.content && data.content[0] && data.content[0].text || '{}';
      var match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse SOP response from Claude.');
      state.sopJson = JSON.parse(match[0]);
      state.phase = 'result';
      renderPhase();
    })
    .catch(function (err) {
      state.error = err.message || 'Something went wrong. Please try again.';
      state.phase = 'step3';
      renderPhase();
    });
  }

  // ── Print ───────────────────────────────────────────────────────────────────

  function printSop(s, company, docRef, title, version, today) {
    function esc(str) { return escHtml(str || ''); }

    function li(items) {
      if (!items || !items.length) return '<p>—</p>';
      return '<ul>' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
    }
    function ol(items) {
      if (!items || !items.length) return '<p>—</p>';
      return '<ol>' + items.map(function (step) {
        var h = step.step ? '<strong>' + esc(step.step) + '</strong><br>' : '';
        var d = step.detail ? esc(step.detail) : esc(step);
        return '<li>' + h + d + '</li>';
      }).join('') + '</ol>';
    }

    var win = window.open('', '_blank');
    if (!win) { alert('Please allow pop-ups to print the SOP.'); return; }

    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(title) + '</title><style>' +
      'body{font-family:Arial,sans-serif;font-size:11pt;margin:20mm 15mm;color:#111}' +
      'h1{font-size:14pt;color:#1F3A5F;margin:0 0 4px}' +
      '.meta-table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:9pt}' +
      '.meta-table td{border:1px solid #ccc;padding:4px 8px}' +
      '.meta-table td:first-child{font-weight:bold;background:#EEF4FA;width:120px}' +
      'h2{font-size:11pt;color:#1F3A5F;border-left:3px solid #E8532A;padding-left:8px;margin:18px 0 6px}' +
      'ul,ol{margin:4px 0;padding-left:20px;line-height:1.6}' +
      '.approval{border-collapse:collapse;width:100%;font-size:9pt;margin-top:20px}' +
      '.approval th,.approval td{border:1px solid #ccc;padding:6px 8px;text-align:left}' +
      '.approval th{background:#EEF4FA;font-weight:bold}' +
      '.footer{text-align:center;font-size:8pt;color:#aaa;margin-top:20px;border-top:1px solid #eee;padding-top:8px}' +
      '@media print{body{margin:10mm}}' +
    '</style></head><body>');

    win.document.write(
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1F3A5F;padding-bottom:12px;margin-bottom:14px">' +
        '<div><div style="font-size:9pt;color:#555;margin-bottom:4px">' + esc(company) + '</div><h1>' + esc(title) + '</h1></div>' +
        '<table class="meta-table" style="width:auto"><tr><td>Doc Ref</td><td>' + esc(docRef) + '</td></tr>' +
        '<tr><td>Version</td><td>' + esc(version) + '</td></tr><tr><td>Date</td><td>' + esc(today) + '</td></tr></table>' +
      '</div>' +

      '<h2>1. Purpose</h2><p>' + esc(s.purpose) + '</p>' +
      '<h2>2. Scope</h2><p>' + esc(s.scope) + '</p>' +
      '<h2>3. Responsibilities</h2>' + li(s.responsibilities) +
      '<h2>4. Equipment &amp; Materials</h2>' + li(s.equipment) +
      '<h2>5. Safety &amp; PPE</h2>' + li(s.safety) +
      '<h2>6. Procedure</h2>' + ol(s.procedure) +
      '<h2>7. Quality Checks &amp; Acceptance Criteria</h2>' + li(s.quality_checks) +
      '<h2>8. Records</h2>' + li(s.records) +
      (s.references && s.references.length ? '<h2>9. References</h2>' + li(s.references) : '') +

      '<h2>Document Control</h2>' +
      '<table class="approval"><thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead>' +
      '<tbody>' +
        '<tr><td>Prepared by</td><td style="width:28%"></td><td style="width:28%"></td><td>' + esc(today) + '</td></tr>' +
        '<tr><td>Reviewed by</td><td></td><td></td><td></td></tr>' +
        '<tr><td>Approved by</td><td></td><td></td><td></td></tr>' +
      '</tbody></table>' +

      '<div class="footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · PE-06 Standard</div>' +
    '</body></html>');

    win.document.close();
    setTimeout(function () { win.focus(); win.print(); }, 400);
  }

  // ── Plain text export ───────────────────────────────────────────────────────

  function buildPlainText(s, company, docRef, title, version, today) {
    function lines(items) {
      if (!items || !items.length) return '  —\n';
      return items.map(function (i, n) {
        if (i && i.step) return '  ' + (n + 1) + '. ' + i.step + '\n     ' + (i.detail || '') + '\n';
        return '  • ' + i + '\n';
      }).join('');
    }
    return [
      company,
      title,
      'Doc Ref: ' + docRef + '  |  Version: ' + version + '  |  Date: ' + today,
      '═'.repeat(60),
      '',
      '1. PURPOSE',
      s.purpose,
      '',
      '2. SCOPE',
      s.scope,
      '',
      '3. RESPONSIBILITIES',
      lines(s.responsibilities),
      '4. EQUIPMENT & MATERIALS',
      lines(s.equipment),
      '5. SAFETY & PPE',
      lines(s.safety),
      '6. PROCEDURE',
      lines(s.procedure),
      '7. QUALITY CHECKS & ACCEPTANCE CRITERIA',
      lines(s.quality_checks),
      '8. RECORDS',
      lines(s.records),
      (s.references && s.references.length ? '9. REFERENCES\n' + lines(s.references) + '\n' : ''),
      'Generated by Frankie · NuCCoL F4N Intelligence Platform · PE-06 Standard',
    ].join('\n');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function field(label, id, placeholder, value, multiline) {
    var tag = multiline ? 'textarea' : 'input';
    var attrs = multiline ? ' rows="3"' : ' type="text"';
    return '<div class="sop-field">' +
      '<label class="sop-label" for="' + id + '">' + label + '</label>' +
      '<' + tag + ' class="sop-input' + (multiline ? ' sop-textarea' : '') + '" id="' + id + '"' + attrs +
        ' placeholder="' + placeholder + '"' +
        (multiline ? '>' + escHtml(value || '') + '</' + tag + '>' :
         ' value="' + escHtml(value || '') + '">') +
    '</div>';
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

}());
