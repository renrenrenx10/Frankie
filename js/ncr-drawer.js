/**
 * ncr-drawer.js  v1.0
 * Incident & NCR Investigation Assistant (Feature 14)
 * Guided 5 Whys RCA → completed NCR / investigation record to NuCCoL QHSE standard.
 * Flow: type select → details → 5 whys → actions → loading → result
 */
(function () {
  'use strict';

  var DRAWER_ID = 'ncr-drawer';

  var TYPES = [
    { id: 'ncr',      icon: '🔴', label: 'Non-Conformance (NCR)',     desc: 'Product or process does not meet specification' },
    { id: 'near',     icon: '🟡', label: 'Near Miss',                 desc: 'No harm occurred but could have' },
    { id: 'incident', icon: '🚨', label: 'Safety Incident',           desc: 'Injury, illness, or dangerous occurrence' },
    { id: 'customer', icon: '📦', label: 'Customer Complaint / Return', desc: 'Customer-reported defect or dissatisfaction' },
    { id: 'audit',    icon: '📋', label: 'Audit Finding',             desc: 'Observation or nonconformity from an audit' },
    { id: 'process',  icon: '⚙️', label: 'Process Deviation',         desc: 'Deviation from approved procedure or plan' },
  ];

  var SEVERITY = [
    { id: '1', label: 'Minor',    colour: '#27AE60', desc: 'No safety risk, minor rework or delay' },
    { id: '2', label: 'Moderate', colour: '#E67E22', desc: 'Quality impact, potential customer effect' },
    { id: '3', label: 'Major',    colour: '#C0392B', desc: 'Safety risk, significant quality escape, or repeat issue' },
  ];

  var state = {
    phase:      'type',   // type | details | whys | actions | loading | result
    type:       null,
    typeLabel:  '',
    severity:   null,
    // Details
    ref:          '',
    description:  '',
    dateFound:    '',
    foundBy:      '',
    location:     '',
    partJob:      '',
    immediate:    '',
    companyName:  '',
    // 5 Whys
    whys: ['', '', '', '', ''],
    rootCause:    '',
    // Actions
    containment:  '',
    corrections:  '',
    preventions:  '',
    verifyBy:     '',
    // Result
    resultJson: null,
    error:      null,
  };

  // ── Public API ──────────────────────────────────────────────────────────────

  window.NcrDrawer = {
    open: function () {
      injectDrawer();
      state.companyName = localStorage.getItem('ncr_company') || '';
      state.phase       = 'type';
      state.type        = null;
      state.whys        = ['', '', '', '', ''];
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
  function setBody(h) { var el = $id('ncr-body'); if (el) el.innerHTML = h; }
  function val(id)    { var el = $id(id); return el ? (el.value || '').trim() : ''; }

  // ── Drawer injection ────────────────────────────────────────────────────────

  function injectDrawer() {
    if ($id(DRAWER_ID)) return;
    var el = document.createElement('div');
    el.id        = DRAWER_ID;
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML =
      '<div class="assess-backdrop" id="ncrBackdrop"></div>' +
      '<div class="assess-panel">' +
        '<div class="assess-topbar">' +
          '<span class="assess-icon">🔎</span>' +
          '<div class="assess-title">NCR &amp; Incident Investigation</div>' +
          '<button class="assess-close" id="ncrClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="ncr-progress" id="ncr-progress"></div>' +
        '<div class="assess-body" id="ncr-body"></div>' +
      '</div>';
    document.body.appendChild(el);
    $id('ncrClose').addEventListener('click', closeDrawer);
    $id('ncrBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  }

  function closeDrawer() {
    var d = $id(DRAWER_ID);
    if (d) { d.classList.remove('assess-drawer--open'); d.classList.add('assess-drawer--closed'); }
  }

  // ── Progress ────────────────────────────────────────────────────────────────

  var PHASES      = ['type', 'details', 'whys', 'actions', 'result'];
  var STEP_LABELS = ['Type', 'Details', '5 Whys', 'Actions', 'Record'];

  function renderProgress() {
    var el = $id('ncr-progress');
    if (!el) return;
    if (state.phase === 'loading') { el.innerHTML = ''; return; }
    var idx = PHASES.indexOf(state.phase);
    var inner = PHASES.map(function (p, i) {
      if (i === 4 && state.phase !== 'result') return '';
      var active = i === idx ? ' ncr-step--active' : '';
      var done   = i < idx  ? ' ncr-step--done'   : '';
      return '<div class="ncr-step' + active + done + '">' +
        '<div class="ncr-step-dot">' + (i < idx ? '✓' : (i + 1)) + '</div>' +
        '<div class="ncr-step-label">' + STEP_LABELS[i] + '</div>' +
      '</div>' + (i < PHASES.length - 1 ? '<div class="ncr-step-line"></div>' : '');
    }).join('');
    el.innerHTML = '<div class="ncr-progress-inner">' + inner + '</div>';
  }

  // ── Render router ───────────────────────────────────────────────────────────

  function renderPhase() {
    renderProgress();
    if      (state.phase === 'type')    renderType();
    else if (state.phase === 'details') renderDetails();
    else if (state.phase === 'whys')    renderWhys();
    else if (state.phase === 'actions') renderActions();
    else if (state.phase === 'loading') renderLoading();
    else if (state.phase === 'result')  renderResult();
  }

  // ── Type selection ──────────────────────────────────────────────────────────

  function renderType() {
    var typeCards = TYPES.map(function (t) {
      var active = state.type === t.id ? ' ncr-type--active' : '';
      return '<button type="button" class="ncr-type-card' + active + '" data-type="' + t.id + '" data-label="' + esc(t.label) + '">' +
        '<span class="ncr-type-icon">' + t.icon + '</span>' +
        '<div class="ncr-type-label">' + esc(t.label) + '</div>' +
        '<div class="ncr-type-desc">'  + esc(t.desc)  + '</div>' +
      '</button>';
    }).join('');

    var sevCards = SEVERITY.map(function (s) {
      var active = state.severity === s.id ? ' ncr-sev--active' : '';
      var style  = state.severity === s.id ? ' style="border-color:' + s.colour + ';background:' + s.colour + '18"' : '';
      return '<button type="button" class="ncr-sev-card' + active + '" data-sev="' + s.id + '"' + style + '>' +
        '<div class="ncr-sev-label" style="color:' + s.colour + '">' + esc(s.label) + '</div>' +
        '<div class="ncr-sev-desc">' + esc(s.desc) + '</div>' +
      '</button>';
    }).join('');

    setBody(
      '<div class="ncr-intro"><p>Record and investigate a non-conformance, safety incident, near-miss, or audit finding. Frankie will guide you through a <strong>5 Whys root cause analysis</strong> and generate a completed investigation record to <strong>NuCCoL QHSE standard</strong>.</p></div>' +

      '<div class="ncr-section-title">What are you investigating?</div>' +
      '<div class="ncr-type-grid">' + typeCards + '</div>' +

      '<div class="ncr-section-title" style="margin-top:16px">Severity</div>' +
      '<div class="ncr-sev-grid">' + sevCards + '</div>' +

      (state.error ? '<div class="ncr-error">' + esc(state.error) + '</div>' : '') +

      '<div class="ncr-nav-row">' +
        '<button class="assess-nav assess-nav--primary" id="ncrNext1" type="button">Next: Enter Details →</button>' +
      '</div>'
    );

    document.querySelectorAll('.ncr-type-card').forEach(function (card) {
      card.addEventListener('click', function () {
        state.type      = card.dataset.type;
        state.typeLabel = card.dataset.label;
        document.querySelectorAll('.ncr-type-card').forEach(function (c) { c.classList.remove('ncr-type--active'); });
        card.classList.add('ncr-type--active');
      });
    });

    document.querySelectorAll('.ncr-sev-card').forEach(function (card) {
      card.addEventListener('click', function () {
        state.severity = card.dataset.sev;
        var sev = SEVERITY.filter(function (s) { return s.id === card.dataset.sev; })[0];
        document.querySelectorAll('.ncr-sev-card').forEach(function (c) {
          c.classList.remove('ncr-sev--active'); c.style.borderColor = ''; c.style.background = '';
        });
        card.classList.add('ncr-sev--active');
        if (sev) { card.style.borderColor = sev.colour; card.style.background = sev.colour + '18'; }
      });
    });

    $id('ncrNext1').addEventListener('click', function () {
      state.error = null;
      if (!state.type)     { state.error = 'Please select the type of issue.';     renderType(); return; }
      if (!state.severity) { state.error = 'Please select the severity.';           renderType(); return; }
      state.phase = 'details';
      renderPhase();
    });
  }

  // ── Details ─────────────────────────────────────────────────────────────────

  function renderDetails() {
    var sev = SEVERITY.filter(function (s) { return s.id === state.severity; })[0] || {};
    var today = new Date().toISOString().slice(0, 10);

    setBody(
      '<div class="ncr-badge" style="border-color:' + (sev.colour || '#ccc') + ';color:' + (sev.colour || '#333') + '">' +
        state.typeLabel + ' — ' + (sev.label || '') + ' Severity' +
      '</div>' +

      '<div class="ncr-section-title">Incident / NCR Details</div>' +
      '<div class="ncr-fields">' +
        field('Your Company Name', 'ncr-company', 'e.g. Precision Nuclear Ltd', state.companyName) +
        field('NCR / Incident Reference', 'ncr-ref', 'e.g. NCR-2026-047  or  INC-2026-012', state.ref) +
        field('Date Found', 'ncr-date', today, state.dateFound || today) +
        field('Found By / Reported By', 'ncr-foundby', 'e.g. John Smith, Machining Operator', state.foundBy) +
        field('Location / Department', 'ncr-location', 'e.g. Machining Cell, Sheffield Site', state.location) +
        field('Part / Job / Contract Reference (if applicable)', 'ncr-partjob', 'e.g. Part No. XYZ-001, Job 4471', state.partJob) +
        field('Description — what happened?', 'ncr-desc',
          'Describe exactly what was found or what occurred. Be specific — include quantities, dimensions, observations.',
          state.description, true) +
        field('Immediate actions taken', 'ncr-immediate',
          'e.g. Batch quarantined and tagged Hold; affected parts segregated; work stopped pending investigation; customer notified',
          state.immediate, true) +
      '</div>' +

      (state.error ? '<div class="ncr-error">' + esc(state.error) + '</div>' : '') +

      '<div class="ncr-nav-row">' +
        '<button class="assess-nav" id="ncrBack2" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="ncrNext2" type="button">Next: 5 Whys Analysis →</button>' +
      '</div>'
    );

    $id('ncrBack2').addEventListener('click', function () { state.phase = 'type'; renderPhase(); });
    $id('ncrNext2').addEventListener('click', function () {
      state.companyName = val('ncr-company');
      state.ref         = val('ncr-ref');
      state.dateFound   = val('ncr-date');
      state.foundBy     = val('ncr-foundby');
      state.location    = val('ncr-location');
      state.partJob     = val('ncr-partjob');
      state.description = val('ncr-desc');
      state.immediate   = val('ncr-immediate');
      state.error = null;
      if (!state.companyName)  { state.error = 'Please enter your company name.';      renderDetails(); return; }
      if (!state.description)  { state.error = 'Please describe what happened.';        renderDetails(); return; }
      if (!state.immediate)    { state.error = 'Please describe immediate actions.';    renderDetails(); return; }
      if (state.companyName) localStorage.setItem('ncr_company', state.companyName);
      state.phase = 'whys';
      renderPhase();
    });
  }

  // ── 5 Whys ──────────────────────────────────────────────────────────────────

  function renderWhys() {
    var whyFields = [1, 2, 3, 4, 5].map(function (n) {
      var i   = n - 1;
      var hint = n === 1 ? 'Why did this happen? Start here.'
               : n === 2 ? 'Why did that happen?'
               : n === 3 ? 'Why did that happen? (going deeper…)'
               : n === 4 ? 'Why? (getting to systemic causes…)'
               :            'Why? (this should reveal the root cause)';
      var prev = n > 1 && state.whys[i - 1]
        ? '<div class="ncr-why-prev">Because: <em>' + esc(state.whys[i - 1]) + '</em></div>'
        : '';
      var filled = state.whys[i] ? ' ncr-why-card--filled' : '';
      return '<div class="ncr-why-card' + filled + '">' +
        '<div class="ncr-why-num">Why ' + n + (n === 1 ? '' : ' ?') + '</div>' +
        prev +
        '<textarea class="ncr-why-input" id="ncr-why-' + i + '" rows="2" placeholder="' + hint + '">' + esc(state.whys[i]) + '</textarea>' +
      '</div>';
    }).join('');

    setBody(
      '<div class="ncr-whys-intro">' +
        '<p>Work down from the symptom to the root cause. You need at least <strong>3 whys</strong> — most root causes emerge at Why 4 or 5.</p>' +
        '<div class="ncr-whys-event">Event: <strong>' + esc(state.description) + '</strong></div>' +
      '</div>' +

      '<div class="ncr-whys-chain">' + whyFields + '</div>' +

      '<div class="ncr-fields" style="margin-top:16px">' +
        field('Stated Root Cause (from your 5 Whys)', 'ncr-rootcause',
          'Summarise the root cause in 1–2 sentences — this should be the last "because" in your chain.',
          state.rootCause, true) +
      '</div>' +

      (state.error ? '<div class="ncr-error">' + esc(state.error) + '</div>' : '') +

      '<div class="ncr-nav-row">' +
        '<button class="assess-nav" id="ncrBack3" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="ncrNext3" type="button">Next: Actions →</button>' +
      '</div>'
    );

    // Live update + fill state
    [0, 1, 2, 3, 4].forEach(function (i) {
      var el = $id('ncr-why-' + i);
      if (el) el.addEventListener('input', function () {
        state.whys[i] = el.value.trim();
        // Update fill class
        var card = el.closest('.ncr-why-card');
        if (card) card.classList.toggle('ncr-why-card--filled', !!state.whys[i]);
        // Update the "Because: ..." preview in next card
        var next = $id('ncr-why-' + (i + 1));
        if (next) {
          var prev = next.closest('.ncr-why-card').querySelector('.ncr-why-prev');
          if (prev) prev.innerHTML = state.whys[i] ? 'Because: <em>' + esc(state.whys[i]) + '</em>' : '';
        }
      });
    });

    $id('ncrBack3').addEventListener('click', function () { state.phase = 'details'; renderPhase(); });
    $id('ncrNext3').addEventListener('click', function () {
      [0, 1, 2, 3, 4].forEach(function (i) { state.whys[i] = val('ncr-why-' + i); });
      state.rootCause = val('ncr-rootcause');
      state.error = null;
      var filled = state.whys.filter(function (w) { return w; }).length;
      if (filled < 3)        { state.error = 'Please answer at least 3 Whys before continuing.'; renderWhys(); return; }
      if (!state.rootCause)  { state.error = 'Please state the root cause.'; renderWhys(); return; }
      state.phase = 'actions';
      renderPhase();
    });
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  function renderActions() {
    setBody(
      '<div class="ncr-section-title">Corrective &amp; Preventive Actions</div>' +

      '<div class="ncr-actions-guide">' +
        '<div class="ncr-action-type ncr-action-contain">' +
          '<strong>🔒 Containment</strong> — stop the bleeding now (already done as immediate action)' +
        '</div>' +
        '<div class="ncr-action-type ncr-action-correct">' +
          '<strong>🔧 Correction</strong> — fix this specific occurrence' +
        '</div>' +
        '<div class="ncr-action-type ncr-action-prevent">' +
          '<strong>🛡️ Prevention</strong> — stop it happening again (addresses root cause)' +
        '</div>' +
      '</div>' +

      '<div class="ncr-fields">' +
        field('Containment actions (what was done immediately)', 'ncr-contain',
          'e.g. All suspect parts quarantined; batch on hold; customer notified; supplier contacted',
          state.containment, true) +
        field('Corrective actions (fix this occurrence)', 'ncr-correct',
          'e.g. Rework part to drawing; re-inspect full batch; re-test; replace component; re-perform process under supervision',
          state.corrections, true) +
        field('Preventive actions (address root cause — stop recurrence)', 'ncr-prevent',
          'e.g. Update procedure PE-06-003 to include verification step; add to first-off inspection checklist; retrain all operators; update PFMEA; add poka-yoke to fixture',
          state.preventions, true) +
        field('Verification method and target close date', 'ncr-verify',
          'e.g. QM to verify updated procedure in use by 01/07/2026; re-audit process after 4 weeks; zero recurrence in next 3 months',
          state.verifyBy) +
      '</div>' +

      '<div class="ncr-info-box">💡 Frankie will compile the full investigation record, assess the quality of the root cause analysis, and suggest any additional preventive actions you may have missed.</div>' +

      (state.error ? '<div class="ncr-error">' + esc(state.error) + '</div>' : '') +

      '<div class="ncr-nav-row">' +
        '<button class="assess-nav" id="ncrBack4" type="button">← Back</button>' +
        '<button class="assess-nav assess-nav--primary" id="ncrGenerate" type="button">✨ Generate Investigation Record</button>' +
      '</div>'
    );

    $id('ncrBack4').addEventListener('click', function () { state.phase = 'whys'; renderPhase(); });
    $id('ncrGenerate').addEventListener('click', function () {
      state.containment = val('ncr-contain');
      state.corrections = val('ncr-correct');
      state.preventions = val('ncr-prevent');
      state.verifyBy    = val('ncr-verify');
      state.error = null;
      if (!state.corrections) { state.error = 'Please describe the corrective actions.';  renderActions(); return; }
      if (!state.preventions) { state.error = 'Please describe the preventive actions.';  renderActions(); return; }
      var claudeKey = localStorage.getItem('frankieClaudeKey') || '';
      if (!claudeKey) { state.error = 'No Claude API key found. Please add it in Frankie settings.'; renderActions(); return; }
      state.phase = 'loading';
      renderPhase();
      generate(claudeKey);
    });
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  function renderLoading() {
    setBody(
      '<div class="assess-loading">' +
        '<div class="ncr-spinner"></div>' +
        '<p><strong>Compiling investigation record…</strong></p>' +
        '<p class="ncr-loading-sub">Frankie is assessing your root cause analysis and drafting the full NCR record.</p>' +
      '</div>'
    );
  }

  // ── Result ──────────────────────────────────────────────────────────────────

  function renderResult() {
    var r   = state.resultJson;
    if (!r) { setBody('<div class="ncr-error">No record returned — please try again.</div>'); return; }

    var sev = SEVERITY.filter(function (s) { return s.id === state.severity; })[0] || {};
    var today = new Date().toLocaleDateString('en-GB');

    // Whys chain
    var whysHtml = state.whys.filter(function (w) { return w; }).map(function (w, i) {
      return '<div class="ncr-result-why">' +
        '<span class="ncr-result-why-num">Why ' + (i + 1) + '</span>' +
        '<span class="ncr-result-why-text">' + esc(w) + '</span>' +
      '</div>';
    }).join('<div class="ncr-why-arrow">↓</div>');

    // Action table
    var actionRows = (r.actions || []).map(function (a) {
      var typeColour = a.type === 'Containment' ? '#1F3A5F' : a.type === 'Correction' ? '#E67E22' : '#27AE60';
      return '<tr>' +
        '<td><span class="ncr-action-badge" style="background:' + typeColour + '">' + esc(a.type || '') + '</span></td>' +
        '<td>' + esc(a.action || '') + '</td>' +
        '<td>' + esc(a.owner || '') + '</td>' +
        '<td>' + esc(a.due || '') + '</td>' +
        '<td class="ncr-status-open">Open</td>' +
      '</tr>';
    }).join('');

    // RCA quality feedback
    var rcaFeedback = r.rca_quality
      ? '<div class="ncr-rca-feedback">' +
          '<div class="ncr-rca-label">Root Cause Analysis Quality Check</div>' +
          '<div class="ncr-rca-score" style="color:' + (r.rca_quality.score >= 3 ? '#27AE60' : r.rca_quality.score >= 2 ? '#E67E22' : '#C0392B') + '">' +
            '★'.repeat(r.rca_quality.score || 0) + '☆'.repeat(5 - (r.rca_quality.score || 0)) +
            ' ' + (r.rca_quality.label || '') +
          '</div>' +
          '<p class="ncr-rca-note">' + esc(r.rca_quality.note || '') + '</p>' +
        '</div>'
      : '';

    var html =
      '<div class="ncr-result">' +

        '<div class="ncr-result-header">' +
          '<div>' +
            '<div class="ncr-result-company">' + esc(state.companyName) + '</div>' +
            '<div class="ncr-result-title">Investigation Record</div>' +
            '<div class="ncr-result-ref">' + esc(state.ref || 'Ref: —') + '</div>' +
          '</div>' +
          '<div class="ncr-result-meta">' +
            '<div>Type: <strong>' + esc(state.typeLabel) + '</strong></div>' +
            '<div>Severity: <strong style="color:' + (sev.colour || '#333') + '">' + esc(sev.label || '') + '</strong></div>' +
            '<div>Date: <strong>' + esc(state.dateFound || today) + '</strong></div>' +
            '<div>Opened: <strong>' + today + '</strong></div>' +
          '</div>' +
        '</div>' +

        // Description
        '<div class="ncr-result-section">' +
          '<div class="ncr-result-label">Description</div>' +
          '<p class="ncr-result-text">' + esc(r.description_enhanced || state.description) + '</p>' +
          (state.location ? '<div class="ncr-detail-row"><span>Location:</span> ' + esc(state.location) + '</div>' : '') +
          (state.partJob  ? '<div class="ncr-detail-row"><span>Part / Job:</span> ' + esc(state.partJob) + '</div>' : '') +
          (state.foundBy  ? '<div class="ncr-detail-row"><span>Found by:</span> ' + esc(state.foundBy) + '</div>' : '') +
        '</div>' +

        // Immediate actions
        '<div class="ncr-result-section">' +
          '<div class="ncr-result-label ncr-label--blue">Immediate Actions</div>' +
          '<p class="ncr-result-text">' + esc(state.immediate) + '</p>' +
        '</div>' +

        // 5 Whys
        '<div class="ncr-result-section">' +
          '<div class="ncr-result-label ncr-label--orange">5 Whys Root Cause Analysis</div>' +
          '<div class="ncr-whys-result">' + whysHtml + '</div>' +
          '<div class="ncr-root-cause-box">' +
            '<div class="ncr-root-cause-label">Root Cause</div>' +
            '<p>' + esc(state.rootCause) + '</p>' +
          '</div>' +
        '</div>' +

        rcaFeedback +

        // Actions table
        '<div class="ncr-result-section">' +
          '<div class="ncr-result-label ncr-label--green">Corrective &amp; Preventive Action Plan</div>' +
          '<table class="ncr-action-table">' +
            '<thead><tr><th>Type</th><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>' +
            '<tbody>' + actionRows + '</tbody>' +
          '</table>' +
        '</div>' +

        // Verification
        (state.verifyBy || r.verification_method
          ? '<div class="ncr-result-section">' +
              '<div class="ncr-result-label">Verification &amp; Close-Out</div>' +
              '<p class="ncr-result-text">' + esc(r.verification_method || state.verifyBy) + '</p>' +
            '</div>'
          : '') +

        // Lessons learned
        (r.lessons_learned && r.lessons_learned.length
          ? '<div class="ncr-result-section">' +
              '<div class="ncr-result-label ncr-label--purple">Lessons Learned</div>' +
              '<ul class="ncr-ll-list">' + r.lessons_learned.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
            '</div>'
          : '') +

        // Sign-off
        '<div class="ncr-signoff">' +
          '<div class="ncr-result-label">Sign-Off</div>' +
          '<table class="ncr-signoff-table">' +
            '<thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead>' +
            '<tbody>' +
              '<tr><td>Raised by</td><td>' + esc(state.foundBy || '') + '</td><td></td><td>' + esc(state.dateFound || today) + '</td></tr>' +
              '<tr><td>Investigated by</td><td></td><td></td><td></td></tr>' +
              '<tr><td>Approved by (Quality)</td><td></td><td></td><td></td></tr>' +
              '<tr><td>Closed by</td><td></td><td></td><td></td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>' +

        '<div class="ncr-result-footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · QHSE Standard</div>' +

        '<div class="ncr-action-row">' +
          '<button class="assess-nav" id="ncrRestart" type="button">← New Investigation</button>' +
          '<button class="assess-nav assess-nav--primary" id="ncrPrint" type="button">🖨️ Print / Save PDF</button>' +
        '</div>' +

      '</div>';

    setBody(html);

    $id('ncrRestart').addEventListener('click', function () {
      state.phase = 'type'; state.type = null; state.whys = ['', '', '', '', ''];
      state.resultJson = null; state.error = null;
      renderPhase();
    });
    $id('ncrPrint').addEventListener('click', function () { printResult(r, sev, today, whysHtml, actionRows); });
  }

  // ── Claude API ──────────────────────────────────────────────────────────────

  function generate(apiKey) {
    var whyChain = state.whys.map(function (w, i) {
      return w ? 'Why ' + (i + 1) + ': ' + w : null;
    }).filter(Boolean).join('\n');

    var prompt =
      'You are a nuclear supply chain quality engineer experienced in NCR investigations, 5 Whys root cause analysis, and CAPA management to ISO 9001 and nuclear QA standards.\n\n' +
      'A company has completed an incident/NCR investigation. Review their inputs and generate a complete investigation record.\n\n' +
      'Company: ' + state.companyName + '\n' +
      'Reference: ' + (state.ref || 'Not assigned') + '\n' +
      'Type: ' + state.typeLabel + '\n' +
      'Severity: ' + (SEVERITY.filter(function (s) { return s.id === state.severity; })[0] || {}).label + '\n' +
      'Date: ' + (state.dateFound || 'Not specified') + '\n' +
      'Found by: ' + (state.foundBy || 'Not specified') + '\n' +
      'Location: ' + (state.location || 'Not specified') + '\n' +
      'Part/Job: ' + (state.partJob || 'Not specified') + '\n\n' +
      'Description: ' + state.description + '\n\n' +
      'Immediate actions: ' + state.immediate + '\n\n' +
      '5 Whys chain:\n' + whyChain + '\n\n' +
      'Stated root cause: ' + state.rootCause + '\n\n' +
      'Containment: ' + (state.containment || state.immediate) + '\n' +
      'Corrections: ' + state.corrections + '\n' +
      'Preventive actions: ' + state.preventions + '\n' +
      'Verification: ' + (state.verifyBy || 'Not specified') + '\n\n' +
      'Return ONLY a JSON object — no markdown:\n' +
      '{\n' +
      '  "description_enhanced": "improved, precise description of the nonconformance or incident (1-2 sentences)",\n' +
      '  "actions": [\n' +
      '    {\n' +
      '      "type": "Containment" | "Correction" | "Prevention",\n' +
      '      "action": "specific action",\n' +
      '      "owner": "suggested role e.g. Quality Manager, Supervisor",\n' +
      '      "due": "suggested due e.g. Immediate, 7 days, 30 days"\n' +
      '    }\n' +
      '  ],  // 5-10 actions combining what they said + any important ones they missed\n' +
      '  "verification_method": "how to verify actions are effective and sustained",\n' +
      '  "rca_quality": {\n' +
      '    "score": 1-5,  // quality of the 5 Whys (1=superficial, 5=excellent root cause identified)\n' +
      '    "label": "e.g. Good — systemic root cause identified",\n' +
      '    "note": "1-2 sentences of specific feedback on the quality of the RCA"\n' +
      '  },\n' +
      '  "lessons_learned": ["lesson 1", "lesson 2", "lesson 3"]  // 2-4 transferable lessons\n' +
      '}\n\n' +
      'Be specific and practical. For nuclear supply chain context, ensure preventive actions address systemic issues not just this instance.';

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
      if (!match) throw new Error('Could not parse response.');
      state.resultJson = JSON.parse(match[0]);
      state.phase      = 'result';
      renderPhase();
    })
    .catch(function (err) {
      state.error = err.message || 'Something went wrong. Please try again.';
      state.phase = 'actions';
      renderPhase();
    });
  }

  // ── Print ───────────────────────────────────────────────────────────────────

  function printResult(r, sev, today, whysHtml, actionRows) {
    var win = window.open('', '_blank');
    if (!win) { alert('Please allow pop-ups to print.'); return; }

    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NCR ' + esc(state.ref || '') + '</title><style>' +
      'body{font-family:Arial,sans-serif;font-size:10pt;margin:15mm;color:#111}' +
      'h1{font-size:13pt;color:#1F3A5F;margin:0 0 3px}' +
      'h2{font-size:10pt;color:#1F3A5F;border-left:3px solid #E8532A;padding-left:8px;margin:16px 0 5px;page-break-after:avoid}' +
      'table{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:10px}' +
      'th,td{border:1px solid #ccc;padding:5px 7px;vertical-align:top}' +
      'th{background:#EEF4FA;font-weight:bold;color:#1F3A5F}' +
      '.why-chain{font-size:9pt;color:#333;line-height:2}' +
      '.why-num{font-weight:bold;color:#1F3A5F;min-width:50px;display:inline-block}' +
      '.root-cause{background:#FFF8E1;border:1px solid #FFD600;padding:8px 12px;border-radius:4px;margin-top:8px}' +
      'ul{margin:3px 0;padding-left:16px;line-height:1.7}' +
      '.footer{text-align:center;font-size:8pt;color:#aaa;margin-top:16px;border-top:1px solid #eee;padding-top:6px}' +
      '@page{margin:10mm}' +
    '</style></head><body>');

    var whyLines = state.whys.filter(function (w) { return w; }).map(function (w, i) {
      return '<div><span class="why-num">Why ' + (i + 1) + ':</span> ' + esc(w) + '</div>';
    }).join('');

    win.document.write(
      '<div style="display:flex;justify-content:space-between;border-bottom:2px solid #1F3A5F;padding-bottom:10px;margin-bottom:10px">' +
        '<div><div style="font-size:9pt;color:#555">' + esc(state.companyName) + '</div>' +
          '<h1>Investigation Record — ' + esc(state.ref || 'No Ref') + '</h1>' +
          '<div style="font-size:10pt;color:#555">' + esc(state.typeLabel) + '</div></div>' +
        '<table style="width:auto"><tr><td><b>Severity</b></td><td style="color:' + (sev.colour || '#333') + ';font-weight:bold">' + esc(sev.label || '') + '</td></tr>' +
          '<tr><td><b>Date</b></td><td>' + esc(state.dateFound || today) + '</td></tr>' +
          '<tr><td><b>Found by</b></td><td>' + esc(state.foundBy || '—') + '</td></tr>' +
          '<tr><td><b>Location</b></td><td>' + esc(state.location || '—') + '</td></tr>' +
          (state.partJob ? '<tr><td><b>Part/Job</b></td><td>' + esc(state.partJob) + '</td></tr>' : '') +
        '</table>' +
      '</div>' +

      '<h2>Description</h2><p>' + esc(r.description_enhanced || state.description) + '</p>' +
      '<h2>Immediate Actions</h2><p>' + esc(state.immediate) + '</p>' +

      '<h2>5 Whys Root Cause Analysis</h2>' +
      '<div class="why-chain">' + whyLines + '</div>' +
      '<div class="root-cause"><strong>Root Cause:</strong> ' + esc(state.rootCause) + '</div>' +

      '<h2>Corrective &amp; Preventive Action Plan</h2>' +
      '<table><thead><tr><th>Type</th><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>' +
      '<tbody>' + actionRows + '</tbody></table>' +

      (r.verification_method || state.verifyBy
        ? '<h2>Verification</h2><p>' + esc(r.verification_method || state.verifyBy) + '</p>'
        : '') +

      (r.lessons_learned && r.lessons_learned.length
        ? '<h2>Lessons Learned</h2><ul>' + r.lessons_learned.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>'
        : '') +

      '<h2>Sign-Off</h2>' +
      '<table><thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead><tbody>' +
        '<tr><td>Raised by</td><td>' + esc(state.foundBy || '') + '</td><td></td><td>' + esc(state.dateFound || today) + '</td></tr>' +
        '<tr><td>Investigated by</td><td></td><td></td><td></td></tr>' +
        '<tr><td>Approved by (Quality)</td><td></td><td></td><td></td></tr>' +
        '<tr><td>Closed by</td><td></td><td></td><td></td></tr>' +
      '</tbody></table>' +

      '<div class="footer">Generated by Frankie · NuCCoL F4N Intelligence Platform · QHSE Standard</div>' +
    '</body></html>');

    win.document.close();
    setTimeout(function () { win.focus(); win.print(); }, 400);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function field(label, id, placeholder, value, multiline) {
    var tag   = multiline ? 'textarea' : 'input';
    var attrs = multiline ? ' rows="3"' : ' type="text"';
    return '<div class="ncr-field">' +
      '<label class="ncr-label" for="' + id + '">' + label + '</label>' +
      '<' + tag + ' class="ncr-input' + (multiline ? ' ncr-textarea' : '') + '" id="' + id + '"' + attrs +
        ' placeholder="' + placeholder + '"' +
        (multiline ? '>' + esc(value || '') + '</' + tag + '>' : ' value="' + esc(value || '') + '">') +
    '</div>';
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

}());
