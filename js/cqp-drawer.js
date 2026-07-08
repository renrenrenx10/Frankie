/**
 * cqp-drawer.js  v1.0
 * Contract Quality Plan Generator (Feature 12)
 * 3-step guided Q&A → full CQP with Inspection & Test Plan table.
 * Output to NuCCoL QHSE-QP standard. Print/PDF export.
 */
(function () {
  'use strict';

  var DRAWER_ID = 'cqp-drawer';

  var STANDARDS = [
    { id: 'iso9001',  label: 'ISO 9001:2015' },
    { id: 'as9100',   label: 'AS9100 Rev D' },
    { id: 'iso3834',  label: 'ISO 3834 (Welding)' },
    { id: 'asme',     label: 'ASME Codes' },
    { id: 'pedd',     label: 'PED 2014/68/EU' },
    { id: 'en1090',   label: 'EN 1090 (Structural)' },
    { id: 'nuclear',  label: 'Nuclear Grade (QA/QC)' },
    { id: 'customer', label: 'Customer-Specific QMS' },
  ];

  var SPECIAL_PROCESSES = [
    { id: 'welding',   label: '🔥 Welding' },
    { id: 'ndt',       label: '🔍 NDT / NDE' },
    { id: 'painting',  label: '🎨 Surface Treatment / Painting' },
    { id: 'heat',      label: '🌡️ Heat Treatment' },
    { id: 'pressure',  label: '💨 Pressure Testing' },
    { id: 'cmc',       label: '📐 CMM / Metrology' },
    { id: 'cleaning',  label: '🧹 Special Cleaning' },
    { id: 'bonding',   label: '🔩 Bonding / Adhesives' },
  ];

  var state = {
    phase: 'step1',
    // Step 1 — Contract basics
    companyName:   '',
    clientName:    '',
    contractTitle: '',
    contractRef:   '',
    scopeOfSupply: '',
    contractBand:  '',   // 'low' | 'medium' | 'high' | 'nuclear'
    // Step 2 — Quality requirements
    standards:        [],
    specialProcesses: [],
    traceability:     '',
    customerHolds:    '',
    ncrProcess:       '',
    // Step 3 — Documents & submission
    docsRequired:  '',
    reportFreq:    '',
    auditArrange:  '',
    extraReqs:     '',
    // Result
    cqpJson: null,
    error:   null,
  };

  var BAND_OPTIONS = [
    { id: 'low',     label: '< £50k',        desc: 'Standard commercial supply' },
    { id: 'medium',  label: '£50k – £500k',  desc: 'Quality-critical supply' },
    { id: 'high',    label: '£500k – £5m',   desc: 'Safety-significant supply' },
    { id: 'nuclear', label: 'Nuclear-grade',  desc: 'Nuclear safety class / Q-coded' },
  ];

  // ── Public API ──────────────────────────────────────────────────────────────

  window.CqpDrawer = {
    open: function () {
      injectDrawer();
      state.companyName = localStorage.getItem('cqp_company') || '';
      state.phase    = 'step1';
      state.cqpJson  = null;
      state.error    = null;
      state.standards        = [];
      state.specialProcesses = [];
      renderPhase();
      var drawer = document.getElementById(DRAWER_ID);
      drawer.classList.remove('assess-drawer--closed');
      drawer.classList.add('assess-drawer--open');
    }
  };

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function $id(id) { return document.getElementById(id); }
  function setBody(html) { var el = $id('cqp-body'); if (el) el.innerHTML = html; }
  function val(id) { var el = $id(id); return el ? (el.value || '').trim() : ''; }

  // ── Drawer injection ────────────────────────────────────────────────────────

  function injectDrawer() {
    if ($id(DRAWER_ID)) return;
    var el = document.createElement('div');
    el.id        = DRAWER_ID;
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML =
      '<div class="assess-backdrop" id="cqpBackdrop"></div>' +
      '<div class="assess-panel">' +
        '<div class="assess-topbar">' +
          '<span class="assess-icon">📑</span>' +
          '<div class="assess-title">Contract Quality Plan</div>' +
          '<button class="assess-close" id="cqpClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="cqp-progress" id="cqp-progress"></div>' +
        '<div class="assess-body" id="cqp-body"></div>' +
      '</div>';
    document.body.appendChild(el);
    $id('cqpClose').addEventListener('click', closeDrawer);
    $id('cqpBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  }

  function closeDrawer() {
    var d = $id(DRAWER_ID);
    if (!d) return;
    d.classList.remove('assess-drawer--open');
    d.classList.add('assess-drawer--closed');
  }

  // ── Progress ────────────────────────────────────────────────────────────────

  var STEP_LABELS = ['Contract', 'Quality Reqs', 'Documents', 'Your CQP'];
  var PHASES = ['step1', 'step2', 'step3', 'result'];

  function renderProgress() {
    var el = $id('cqp-progress');
    if (!el) return;
    if (state.phase === 'loading') { el.innerHTML = ''; return; }
    var idx = PHASES.indexOf(state.phase);
    var dots = PHASES.map(function (p, i) {
      if (i === 3 && state.phase !== 'result') return ''; // hide result dot until done
      var active = i === idx ? ' cqp-step--active' : '';
      var done   = i < idx  ? ' cqp-step--done'   : '';
      return '<div class="cqp-step' + active + done + '">' +
        '<div class="cqp-step-dot">' + (i < idx ? '✓' : (i + 1)) + '</div>' +
        '<div class="cqp-step-label">' + STEP_LABELS[i] + '</div>' +
      '</div>' + (i < PHASES.length - 1 ? '<div class="cqp-step-line"></div>' : '');
    }).join('');
    el.innerHTML = '<div class="cqp-progress-inner">' + dots + '</div>';
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

  // ── Step 1: Contract basics ─────────────────────────────────────────────────

  function renderStep1() {
    var bandCards = BAND_OPTIONS.map(function (b) {
      var active = state.contractBand === b.id ? ' cqp-band--active' : '';
      return '<button type="button" class="cqp-band-card' + active + '" data-band="' + b.id + '">' +
        '<div class="cqp-band-label">' + esc(b.label) + '</div>' +
        '<div class="cqp-band-desc">'  + esc(b.desc)  + '</div>' +
      '</button>';
    }).join('');

    setBody(
      '<div class="cqp-intro"><p>Answer three short sections and Frankie will generate a complete <strong>Contract Quality Plan</strong> to NuCCoL QHSE-QP standard — including an Inspection &amp; Test Plan with hold points.</p></div>' +

      '<div class="cqp-section-title">Contract Details</div>' +
      '<div class="cqp-fields">' +
        field('Your Company Name', 'cqp-company', 'e.g. Precision Nuclear Ltd', state.companyName) +
        field('Client / Customer Name', 'cqp-client', 'e.g. Rolls-Royce SMR', state.clientName) +
        field('Contract Title', 'cqp-title', 'e.g. Supply of Machined Pressure Vessel Components', state.contractTitle) +
        field('Contract / Purchase Order Reference', 'cqp-ref', 'e.g. PO-2026-4471', state.contractRef) +
        field('Scope of Supply', 'cqp-scope', 'e.g. Design, manufacture, inspection and delivery of 12 off stainless steel flanged assemblies to customer drawings', state.scopeOfSupply, true) +
      '</div>' +

      '<div class="cqp-section-title" style="margin-top:16px">Contract Value / Criticality</div>' +
      '<div class="cqp-band-grid">' + bandCards + '</div>' +

      (state.error ? '<div class="cqp-error">' + esc(state.error) + '</div>' : '') +

      '<div class="cqp-nav-row">' +
        '<button class="assess-nav assess-nav--primary" id="cqpNext1" type="button">Next: Quality Requirements →</button>' +
      '</div>'
    );

    document.querySelectorAll('.cqp-band-card').forEach(function (card) {
      card.addEventListener('click', function () {
        state.contractBand = card.dataset.band;
        document.querySelectorAll('.cqp-band-card').forEach(function (c) { c.classList.remove('cqp-band--active'); });
        card.classList.add('cqp-band--active');
      });
    });

    $id('cqpNext1').addEventListener('click', function () {
      state.companyName   = val('cqp-company');
      state.clientName    = val('cqp-client');
      state.contractTitle = val('cqp-title');
      state.contractRef   = val('cqp-ref');
      state.scopeOfSupply = val('cqp-scope');
      state.error = null;

      if (!state.companyName)   { state.error = 'Please enter your company name.';     renderStep1(); return; }
      if (!state.clientName)    { state.error = 'Please enter the client name.';        renderStep1(); return; }
      if (!state.contractTitle) { state.error = 'Please enter a contract title.';       renderStep1(); return; }
      if (!state.scopeOfSupply) { state.error = 'Please describe the scope of supply.'; renderStep1(); return; }
      if (!state.contractBand)  { state.error = 'Please select the contract value / criticality band.'; renderStep1(); return; }

      if (state.companyName) localStorage.setItem('cqp_company', state.companyName);
      state.phase = 'step2';
      renderPhase();
    });
  }

  // ── Step 2: Quality requirements ────────────────────────────────────────────

  function renderStep2() {
    var stdPills = STANDARDS.map(function (s) {
      var active = state.standards.indexOf(s.id) > -1 ? ' cqp-pill--active' : '';
      return '<button type="button" class="cqp-pill' + active + '" data-id="' + s.id + '" data-type="std">' + esc(s.label) + '</button>';
    }).join('');

    var spPills = SPECIAL_PROCESSES.map(function (s) {
      var active = state.specialProcesses.indexOf(s.id) > -1 ? ' cqp-pill--active' : '';
      return '<button type="button" class="cqp-pill' + active + '" data-id="' + s.id + '" data-type="sp">' + esc(s.label) + '</button>';
    }).join('');

    setBody(
      '<div class="cqp-section-title">Applicable Standards</div>' +
      '<div class="cqp-pill-grid">' + stdPills + '</div>' +

      '<div class="cqp-section-title" style="margin-top:16px">Special Processes (select all that apply)</div>' +
      '<div class="cqp-pill-grid">' + spPills + '</div>' +

      '<div class="cqp-fields" style="margin-top:16px">' +
        field('Traceability requirements', 'cqp-trace',
          'e.g. Full material traceability to heat/batch number; certificates to EN 10204 3.1; marked per customer dwg',
          state.traceability, true) +
        field('Customer hold points / witness points', 'cqp-holds',
          'e.g. H1 – Dimensional inspection prior to weld; W1 – Pressure test witness; R1 – Final dimensional + visual',
          state.customerHolds, true) +
        field('Non-conformance control requirements', 'cqp-ncr',
          'e.g. All NCRs to be raised on NCR001 form, submitted to client within 24hrs, no use-as-is dispositions without written client approval',
          state.ncrProcess, true) +
      '</div>' +

      (state.error ? '<div class="cqp-error">' + esc(state.error) + '</div>' : '') +

      '<div class="cqp-nav-row">' +
        '<button class="assess-nav" id="cqpBack2" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="cqpNext2" type="button">Next: Documents &amp; Submission →</button>' +
      '</div>'
    );

    document.querySelectorAll('.cqp-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var id   = pill.dataset.id;
        var type = pill.dataset.type;
        var arr  = type === 'std' ? state.standards : state.specialProcesses;
        var idx  = arr.indexOf(id);
        if (idx > -1) { arr.splice(idx, 1); pill.classList.remove('cqp-pill--active'); }
        else           { arr.push(id);       pill.classList.add('cqp-pill--active'); }
      });
    });

    $id('cqpBack2').addEventListener('click', function () { state.phase = 'step1'; renderPhase(); });
    $id('cqpNext2').addEventListener('click', function () {
      state.traceability  = val('cqp-trace');
      state.customerHolds = val('cqp-holds');
      state.ncrProcess    = val('cqp-ncr');
      state.error = null;
      if (!state.traceability) { state.error = 'Please describe the traceability requirements.'; renderStep2(); return; }
      state.phase = 'step3';
      renderPhase();
    });
  }

  // ── Step 3: Documents & submission ─────────────────────────────────────────

  function renderStep3() {
    setBody(
      '<div class="cqp-section-title">Document &amp; Submission Requirements</div>' +

      '<div class="cqp-fields">' +
        field('Documents to submit to client', 'cqp-docs',
          'e.g. CQP (this document), material certs, weld procedures (WPS/PQR), NDT reports, dimensional inspection reports, pressure test certificates, COSHH assessments',
          state.docsRequired, true) +
        field('Report frequency / milestones', 'cqp-freq',
          'e.g. Progress report monthly; inspection records submitted at each hold point; final data pack 5 days before delivery',
          state.reportFreq, true) +
        field('Audit & surveillance arrangements', 'cqp-audit',
          'e.g. Client reserves right to audit supplier QMS with 5 days notice; site visits permitted at all stages',
          state.auditArrange) +
        field('Any other specific requirements', 'cqp-extra',
          'e.g. GDPR data handling; export control; site security requirements; lone working restrictions',
          state.extraReqs, true) +
      '</div>' +

      '<div class="cqp-info-box">💡 Frankie will generate a full CQP including: scope, organisation, document control, supplier control, manufacturing control, Inspection &amp; Test Plan (with H/W/R points), NCR control, traceability, records, and document submission schedule.</div>' +

      (state.error ? '<div class="cqp-error">' + esc(state.error) + '</div>' : '') +

      '<div class="cqp-nav-row">' +
        '<button class="assess-nav" id="cqpBack3" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="cqpGenerate" type="button">✨ Generate CQP</button>' +
      '</div>'
    );

    $id('cqpBack3').addEventListener('click', function () { state.phase = 'step2'; renderPhase(); });
    $id('cqpGenerate').addEventListener('click', function () {
      state.docsRequired = val('cqp-docs');
      state.reportFreq   = val('cqp-freq');
      state.auditArrange = val('cqp-audit');
      state.extraReqs    = val('cqp-extra');
      state.error = null;
      if (!state.docsRequired) { state.error = 'Please list the documents to submit.'; renderStep3(); return; }
      var claudeKey = localStorage.getItem('frankieClaudeKey') || '';
      if (!claudeKey) { state.error = 'No Claude API key found. Please add your key in Frankie settings.'; renderStep3(); return; }
      state.phase = 'loading';
      renderPhase();
      generateCqp(claudeKey);
    });
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  function renderLoading() {
    setBody(
      '<div class="assess-loading">' +
        '<div class="cqp-spinner"></div>' +
        '<p><strong>Generating your Contract Quality Plan…</strong></p>' +
        '<p class="cqp-loading-sub">Frankie is building the CQP and Inspection &amp; Test Plan. This takes around 20 seconds.</p>' +
      '</div>'
    );
  }

  // ── Result ──────────────────────────────────────────────────────────────────

  function renderResult() {
    var c = state.cqpJson;
    if (!c) { setBody('<div class="cqp-error">No CQP data returned — please try again.</div>'); return; }

    var today   = new Date().toLocaleDateString('en-GB');
    var docRef  = 'CQP-' + (state.contractRef || Date.now().toString().slice(-5));
    var version = c.version || '1.0';

    function sec(num, title, content, cls) {
      return '<div class="cqp-result-section">' +
        '<div class="cqp-result-label' + (cls ? ' ' + cls : '') + '">' + num + '. ' + title + '</div>' +
        '<div class="cqp-result-content">' + content + '</div>' +
      '</div>';
    }
    function li(items) {
      if (!items || !items.length) return '<p>—</p>';
      return '<ul class="cqp-ul">' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
    }
    function kv(pairs) {
      if (!pairs || !pairs.length) return '<p>—</p>';
      return pairs.map(function (p) {
        return '<div class="cqp-kv"><span class="cqp-kv-key">' + esc(p.role || p.key || '') + '</span><span class="cqp-kv-val">' + esc(p.responsibility || p.value || '') + '</span></div>';
      }).join('');
    }

    // ITP table
    var itpRows = (c.itp || []).map(function (row, i) {
      var h = row.hold_type || '';
      var colour = h === 'H' ? '#C0392B' : h === 'W' ? '#E67E22' : '#1F3A5F';
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(row.activity || '') + '</td>' +
        '<td>' + esc(row.reference || '') + '</td>' +
        '<td>' + esc(row.acceptance || '') + '</td>' +
        '<td style="text-align:center;font-weight:700;color:' + colour + '">' + esc(h) + '</td>' +
        '<td>' + esc(row.record || '') + '</td>' +
      '</tr>';
    }).join('');

    // Document submission schedule
    var docRows = (c.document_schedule || []).map(function (d) {
      return '<tr><td>' + esc(d.document || '') + '</td><td>' + esc(d.timing || '') + '</td><td>' + esc(d.copies || '1') + '</td></tr>';
    }).join('');

    var html =
      '<div class="cqp-result">' +

        '<div class="cqp-result-header">' +
          '<div>' +
            '<div class="cqp-result-company">' + esc(state.companyName) + '</div>' +
            '<div class="cqp-result-title">' + esc(state.contractTitle) + '</div>' +
            '<div class="cqp-result-client">Client: ' + esc(state.clientName) + '</div>' +
          '</div>' +
          '<div class="cqp-result-meta">' +
            '<div>Doc Ref: <strong>' + esc(docRef) + '</strong></div>' +
            '<div>PO / Ref: <strong>' + esc(state.contractRef || '—') + '</strong></div>' +
            '<div>Version: <strong>' + esc(version) + '</strong></div>' +
            '<div>Date: <strong>' + today + '</strong></div>' +
          '</div>' +
        '</div>' +

        sec(1, 'Purpose & Scope', '<p>' + esc(c.purpose || '') + '</p>') +
        sec(2, 'Scope of Supply', '<p>' + esc(c.scope || state.scopeOfSupply) + '</p>') +
        sec(3, 'Applicable Standards & Codes', li(c.standards)) +
        sec(4, 'Organisation & Responsibilities', kv(c.responsibilities)) +
        sec(5, 'Document Control', li(c.document_control), 'cqp-label--blue') +
        sec(6, 'Supplier & Procurement Control', li(c.supplier_control)) +
        sec(7, 'Manufacturing & Process Control', li(c.manufacturing_control)) +

        '<div class="cqp-result-section">' +
          '<div class="cqp-result-label cqp-label--orange">8. Inspection &amp; Test Plan (ITP)</div>' +
          '<div class="cqp-itp-key">' +
            '<span class="cqp-itp-badge" style="background:#C0392B">H</span> Hold Point — work stops, client approval required&nbsp;&nbsp;' +
            '<span class="cqp-itp-badge" style="background:#E67E22">W</span> Witness Point — client notified, may attend&nbsp;&nbsp;' +
            '<span class="cqp-itp-badge" style="background:#1F3A5F">R</span> Review Point — document review only' +
          '</div>' +
          '<div class="cqp-table-wrap">' +
            '<table class="cqp-itp-table">' +
              '<thead><tr><th>#</th><th>Activity</th><th>Reference</th><th>Acceptance Criteria</th><th>H/W/R</th><th>Record</th></tr></thead>' +
              '<tbody>' + itpRows + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +

        sec(9, 'Non-Conformance Control', li(c.ncr_control), 'cqp-label--red') +
        sec(10, 'Traceability & Material Control', li(c.traceability_control)) +
        sec(11, 'Records & Retention', li(c.records)) +

        '<div class="cqp-result-section">' +
          '<div class="cqp-result-label">12. Document Submission Schedule</div>' +
          '<table class="cqp-doc-table">' +
            '<thead><tr><th>Document</th><th>Timing / Milestone</th><th>Copies</th></tr></thead>' +
            '<tbody>' + docRows + '</tbody>' +
          '</table>' +
        '</div>' +

        (c.audit_surveillance ? sec(13, 'Audit & Surveillance', '<p>' + esc(c.audit_surveillance) + '</p>') : '') +

        // Approval block
        '<div class="cqp-approval">' +
          '<div class="cqp-result-label">Document Approval</div>' +
          '<table class="cqp-approval-table">' +
            '<thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead>' +
            '<tbody>' +
              '<tr><td>Prepared by</td><td></td><td></td><td>' + today + '</td></tr>' +
              '<tr><td>Reviewed by (Quality)</td><td></td><td></td><td></td></tr>' +
              '<tr><td>Approved by</td><td></td><td></td><td></td></tr>' +
              '<tr><td>Client Acceptance</td><td></td><td></td><td></td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>' +

        '<div class="cqp-result-footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · QHSE-QP Standard</div>' +

        '<div class="cqp-action-row">' +
          '<button class="assess-nav" id="cqpRestart" type="button">← New CQP</button>' +
          '<button class="assess-nav assess-nav--primary" id="cqpPrint" type="button">🖨️ Print / Save PDF</button>' +
        '</div>' +

      '</div>';

    setBody(html);

    $id('cqpRestart').addEventListener('click', function () {
      state.phase = 'step1'; state.cqpJson = null; state.error = null;
      state.standards = []; state.specialProcesses = [];
      renderPhase();
    });
    $id('cqpPrint').addEventListener('click', function () { printCqp(c, docRef, version, today, itpRows, docRows); });
  }

  // ── Claude API ──────────────────────────────────────────────────────────────

  function generateCqp(apiKey) {
    var stdLabels = state.standards.map(function (id) {
      var s = STANDARDS.filter(function (x) { return x.id === id; })[0];
      return s ? s.label : id;
    }).join(', ') || 'ISO 9001:2015';

    var spLabels = state.specialProcesses.map(function (id) {
      var s = SPECIAL_PROCESSES.filter(function (x) { return x.id === id; })[0];
      return s ? s.label.replace(/^[^ ]+ /, '') : id;
    }).join(', ') || 'None specified';

    var bandMap = { low: 'standard commercial', medium: 'quality-critical', high: 'safety-significant', nuclear: 'nuclear-grade Q-coded' };

    var prompt =
      'You are a quality management expert in the nuclear supply chain, experienced in writing Contract Quality Plans (CQPs) and Inspection & Test Plans (ITPs) to ISO 9001, AS9100, and nuclear QA standards.\n\n' +
      'Generate a complete Contract Quality Plan for:\n\n' +
      'Supplier: ' + state.companyName + '\n' +
      'Client: ' + state.clientName + '\n' +
      'Contract: ' + state.contractTitle + '\n' +
      'Reference: ' + (state.contractRef || 'TBC') + '\n' +
      'Scope: ' + state.scopeOfSupply + '\n' +
      'Criticality band: ' + (bandMap[state.contractBand] || state.contractBand) + '\n' +
      'Applicable standards: ' + stdLabels + '\n' +
      'Special processes: ' + spLabels + '\n' +
      'Traceability: ' + state.traceability + '\n' +
      'Customer hold/witness/review points: ' + (state.customerHolds || 'To be defined per inspection stages') + '\n' +
      'NCR requirements: ' + (state.ncrProcess || 'Standard NCR process') + '\n' +
      'Documents to submit: ' + state.docsRequired + '\n' +
      'Reporting frequency: ' + (state.reportFreq || 'As agreed with client') + '\n' +
      (state.auditArrange ? 'Audit arrangements: ' + state.auditArrange + '\n' : '') +
      (state.extraReqs    ? 'Other requirements: ' + state.extraReqs + '\n' : '') +
      '\n' +
      'Return ONLY a JSON object — no markdown, no explanation:\n' +
      '{\n' +
      '  "version": "1.0",\n' +
      '  "purpose": "clear statement of the CQP purpose and contractual standing",\n' +
      '  "scope": "detailed scope of supply and any exclusions",\n' +
      '  "standards": ["standard 1", ...],  // 4-8 applicable standards and codes\n' +
      '  "responsibilities": [\n' +
      '    {"role": "Quality Manager", "responsibility": "what they are responsible for"},\n' +
      '    ...\n' +
      '  ],  // 4-6 roles\n' +
      '  "document_control": ["requirement 1", ...],  // 3-5 document control requirements\n' +
      '  "supplier_control": ["requirement 1", ...],  // 3-5 supplier/subcontractor control points\n' +
      '  "manufacturing_control": ["requirement 1", ...],  // 4-6 manufacturing/process control points\n' +
      '  "itp": [\n' +
      '    {\n' +
      '      "activity": "inspection or test activity name",\n' +
      '      "reference": "procedure / standard / drawing ref",\n' +
      '      "acceptance": "acceptance criteria",\n' +
      '      "hold_type": "H" | "W" | "R",\n' +
      '      "record": "record to be generated"\n' +
      '    }\n' +
      '  ],  // 8-14 ITP line items appropriate to the scope; use H for mandatory hold points, W for witness, R for review\n' +
      '  "ncr_control": ["requirement 1", ...],  // 4-6 NCR control steps\n' +
      '  "traceability_control": ["requirement 1", ...],  // 3-6 traceability requirements\n' +
      '  "records": ["record type + retention period", ...],  // 4-7 records\n' +
      '  "document_schedule": [\n' +
      '    {"document": "document name", "timing": "when to submit", "copies": "1"},\n' +
      '    ...\n' +
      '  ],  // 5-10 document submission line items\n' +
      '  "audit_surveillance": "statement on audit and surveillance rights and process"\n' +
      '}\n\n' +
      'The ITP must be specific to the scope of supply — include relevant activities like material receipt, dimensional inspection, special process qualification, in-process checks, final inspection, and any customer hold/witness points. ' +
      'Nuclear-grade contracts should have more hold points and stricter traceability requirements.';

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
      if (!match) throw new Error('Could not parse CQP response.');
      state.cqpJson = JSON.parse(match[0]);
      state.phase   = 'result';
      renderPhase();
    })
    .catch(function (err) {
      state.error = err.message || 'Something went wrong. Please try again.';
      state.phase = 'step3';
      renderPhase();
    });
  }

  // ── Print ───────────────────────────────────────────────────────────────────

  function printCqp(c, docRef, version, today, itpRows, docRows) {
    function li(items) {
      return items && items.length
        ? '<ul>' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'
        : '<p>—</p>';
    }
    function kv(pairs) {
      return pairs && pairs.length
        ? '<table style="width:100%;border-collapse:collapse;font-size:9pt"><tbody>' +
            pairs.map(function (p) {
              return '<tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:bold;width:35%;background:#EEF4FA">' + esc(p.role || '') + '</td>' +
                '<td style="border:1px solid #ccc;padding:5px 8px">' + esc(p.responsibility || '') + '</td></tr>';
            }).join('') + '</tbody></table>'
        : '<p>—</p>';
    }

    var win = window.open('', '_blank');
    if (!win) { alert('Please allow pop-ups to print.'); return; }

    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CQP — ' + esc(state.contractTitle) + '</title><style>' +
      'body{font-family:Arial,sans-serif;font-size:10pt;margin:15mm;color:#111}' +
      'h1{font-size:13pt;color:#1F3A5F;margin:0 0 3px}' +
      'h2{font-size:10pt;color:#1F3A5F;border-left:3px solid #E8532A;padding-left:8px;margin:16px 0 5px;page-break-after:avoid}' +
      'table{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:10px}' +
      'th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}' +
      'th{background:#EEF4FA;font-weight:bold;color:#1F3A5F}' +
      'ul{margin:3px 0;padding-left:16px;line-height:1.6}' +
      '.meta{font-size:9pt;color:#555}' +
      '.footer{text-align:center;font-size:8pt;color:#aaa;margin-top:16px;border-top:1px solid #eee;padding-top:6px}' +
      '@page{margin:10mm}' +
      '@media print{h2{page-break-after:avoid}tr{page-break-inside:avoid}}' +
    '</style></head><body>');

    win.document.write(
      '<div style="display:flex;justify-content:space-between;border-bottom:2px solid #1F3A5F;padding-bottom:10px;margin-bottom:10px">' +
        '<div>' +
          '<div class="meta">' + esc(state.companyName) + ' → ' + esc(state.clientName) + '</div>' +
          '<h1>' + esc(state.contractTitle) + '</h1>' +
          '<div class="meta">Contract Quality Plan</div>' +
        '</div>' +
        '<table style="width:auto;font-size:9pt">' +
          '<tr><td><b>Doc Ref</b></td><td>' + esc(docRef) + '</td></tr>' +
          '<tr><td><b>PO Ref</b></td><td>' + esc(state.contractRef || '—') + '</td></tr>' +
          '<tr><td><b>Version</b></td><td>' + esc(version) + '</td></tr>' +
          '<tr><td><b>Date</b></td><td>' + today + '</td></tr>' +
        '</table>' +
      '</div>' +

      '<h2>1. Purpose &amp; Scope</h2><p>' + esc(c.purpose || '') + '</p>' +
      '<h2>2. Scope of Supply</h2><p>' + esc(c.scope || '') + '</p>' +
      '<h2>3. Applicable Standards</h2>' + li(c.standards) +
      '<h2>4. Organisation &amp; Responsibilities</h2>' + kv(c.responsibilities) +
      '<h2>5. Document Control</h2>' + li(c.document_control) +
      '<h2>6. Supplier &amp; Procurement Control</h2>' + li(c.supplier_control) +
      '<h2>7. Manufacturing &amp; Process Control</h2>' + li(c.manufacturing_control) +

      '<h2>8. Inspection &amp; Test Plan (ITP)</h2>' +
      '<p style="font-size:9pt;color:#555"><b>H</b> = Hold Point (stop, client approval required) &nbsp;|&nbsp; <b>W</b> = Witness Point (client notified) &nbsp;|&nbsp; <b>R</b> = Review Point (document review)</p>' +
      '<table><thead><tr><th>#</th><th>Activity</th><th>Reference</th><th>Acceptance Criteria</th><th>H/W/R</th><th>Record</th></tr></thead><tbody>' + itpRows + '</tbody></table>' +

      '<h2>9. Non-Conformance Control</h2>' + li(c.ncr_control) +
      '<h2>10. Traceability &amp; Material Control</h2>' + li(c.traceability_control) +
      '<h2>11. Records &amp; Retention</h2>' + li(c.records) +

      '<h2>12. Document Submission Schedule</h2>' +
      '<table><thead><tr><th>Document</th><th>Timing / Milestone</th><th>Copies</th></tr></thead><tbody>' + docRows + '</tbody></table>' +

      (c.audit_surveillance ? '<h2>13. Audit &amp; Surveillance</h2><p>' + esc(c.audit_surveillance) + '</p>' : '') +

      '<h2>Document Approval</h2>' +
      '<table><thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead><tbody>' +
        '<tr><td>Prepared by</td><td></td><td></td><td>' + today + '</td></tr>' +
        '<tr><td>Reviewed by (Quality)</td><td></td><td></td><td></td></tr>' +
        '<tr><td>Approved by</td><td></td><td></td><td></td></tr>' +
        '<tr><td>Client Acceptance</td><td></td><td></td><td></td></tr>' +
      '</tbody></table>' +

      '<div class="footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · QHSE-QP Standard</div>' +
    '</body></html>');

    win.document.close();
    setTimeout(function () { win.focus(); win.print(); }, 400);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function field(label, id, placeholder, value, multiline) {
    var tag   = multiline ? 'textarea' : 'input';
    var attrs = multiline ? ' rows="3"' : ' type="text"';
    return '<div class="cqp-field">' +
      '<label class="cqp-label" for="' + id + '">' + label + '</label>' +
      '<' + tag + ' class="cqp-input' + (multiline ? ' cqp-textarea' : '') + '" id="' + id + '"' + attrs +
        ' placeholder="' + placeholder + '"' +
        (multiline ? '>' + esc(value || '') + '</' + tag + '>' : ' value="' + esc(value || '') + '">') +
    '</div>';
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

}());
