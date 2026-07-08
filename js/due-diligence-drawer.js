/**
 * due-diligence-drawer.js  v7.0 — Supplier Intelligence
 *
 * Pipeline:
 *   1. Companies House proxy (ch.rene-dorset.workers.dev)
 *      → real company profile, officers, filing history
 *   2. Claude (Haiku)
 *      → CSFI synthesis from real structured data — cheap & fast
 *
 * Tabs: Intelligence | Company Data | Verify
 * Styles: css/due-diligence.css
 */
(function () {
  'use strict';

  var DRAWER_ID    = 'dd-drawer';
  var WORKER_BASE  = 'https://ch.rene-dorset.workers.dev';
  var CH_PROXY     = WORKER_BASE + '/ch';
  var SUPA_URL     = 'https://qkyvmtouwrzrcyagkheo.supabase.co';
  var SUPA_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreXZtdG91d3J6cmN5YWdraGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODQzNjMsImV4cCI6MjA5MDk2MDM2M30.gKEgkVA-VjOnS_084W79kpzOdZhFQkhFp63MAe_FTd4';
  var EV_BUCKET    = 'evidence-docs';
  // FCDO UK Consolidated Sanctions List (public CSV, no auth)
  var SANCTIONS_CSV_URL = WORKER_BASE + '/sanctions/ConList.csv';

  var state = {
    phase: 'search',        // 'search' | 'loading' | 'results'
    query: '',
    companyNumber: '',
    vatNumber: '',
    activeTab: 'intelligence',
    chData: null,           // raw CH profile + officers + filings
    chExtra: null,          // CH charges + insolvency
    vatData: null,          // HMRC VAT result
    sanctionsData: null,    // OpenSanctions result
    result: null,           // { summary, rating }
    loadingStep: '',
    error: null,
  };

  // ── Public API ──────────────────────────────────────────────────────────────

  window.DueDiligenceDrawer = {
    open: function () {
      injectDrawer();
      resetState();
      renderPhase();
      var d = document.getElementById(DRAWER_ID);
      d.classList.remove('assess-drawer--closed');
      d.classList.add('assess-drawer--open');
    },
  };

  function resetState() {
    state.phase = 'search'; state.result = null; state.chData = null;
    state.chExtra = null; state.vatData = null; state.sanctionsData = null;
    webIntelCache = null; verifyCache = null; braveResultsCache = null; certsCache = null;
    state.error = null; state.activeTab = 'intelligence'; state.loadingStep = '';
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function $id(id) { return document.getElementById(id); }
  function setBody(html) { var el = $id('dd-body'); if (el) el.innerHTML = html; }
  function setStep(text) {
    state.loadingStep = text;
    var el = $id('dd-loading-step');
    if (el) el.textContent = text;
  }

  // ── Drawer shell ────────────────────────────────────────────────────────────

  function injectDrawer() {
    if ($id(DRAWER_ID)) return;
    var el = document.createElement('div');
    el.id = DRAWER_ID;
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML =
      '<div class="assess-backdrop" id="ddBackdrop"></div>' +
      '<div class="assess-panel">' +
        '<div class="assess-topbar">' +
          '<span class="assess-icon">🛡️</span>' +
          '<div class="assess-title">Supplier Intelligence</div>' +
          '<button class="assess-close" id="ddClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="assess-body" id="dd-body"></div>' +
        '<div class="assess-footer dd-hidden" id="dd-footer">' +
          '<button class="assess-nav" id="ddBack" type="button">← New Search</button>' +
          '<button class="assess-nav" id="ddSave" type="button" style="display:none;">💾 Save</button>' +
          '<span class="dd-footer-rating" id="dd-footer-rating"></span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    $id('ddClose').addEventListener('click', closeDrawer);
    $id('ddBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
    $id('ddBack').addEventListener('click', function () { resetState(); renderPhase(); });
    $id('ddSave').addEventListener('click', saveDDReport);
  }

  function closeDrawer() {
    var d = $id(DRAWER_ID);
    if (d) { d.classList.remove('assess-drawer--open'); d.classList.add('assess-drawer--closed'); }
  }

  // ── Render router ───────────────────────────────────────────────────────────

  function renderPhase() {
    var footer = $id('dd-footer');
    if (footer) footer.classList.toggle('dd-hidden', state.phase !== 'results');
    var saveBtn = $id('ddSave');
    if (saveBtn) saveBtn.style.display = (state.phase === 'results' && localStorage.getItem('frankieUserId')) ? '' : 'none';
    if      (state.phase === 'search')  renderSearch();
    else if (state.phase === 'loading') renderLoading();
    else if (state.phase === 'results') renderResults();
  }

  // ── Search screen ───────────────────────────────────────────────────────────

  function renderSearch() {
    setBody(
      '<div class="dd-intro">' +
        '<p class="dd-intro-text">Enter a company name or Companies House number. Frankie pulls live data from the CH register then produces a CSFI risk assessment.</p>' +
      '</div>' +
      '<div class="dd-form">' +
        '<label class="dd-label" for="dd-query">Company name</label>' +
        '<input class="dd-input" id="dd-query" type="text" placeholder="e.g. XL Engineering Trading Limited" value="' + escapeHtml(state.query) + '" />' +
        '<div class="dd-form-row">' +
          '<div class="dd-form-col">' +
            '<label class="dd-label" for="dd-chnum">CH number <span class="dd-label-hint">(optional — speeds up lookup)</span></label>' +
            '<input class="dd-input" id="dd-chnum" type="text" placeholder="07524813" value="' + escapeHtml(state.companyNumber) + '" maxlength="10" />' +
          '</div>' +
          '<div class="dd-form-col">' +
            '<label class="dd-label" for="dd-vat">VAT number <span class="dd-label-hint">(optional — from invoice or supplier website)</span></label>' +
            '<input class="dd-input" id="dd-vat" type="text" placeholder="GB123456789" value="' + escapeHtml(state.vatNumber) + '" maxlength="14" />' +
          '</div>' +
        '</div>' +
        (state.error ? '<div class="dd-error">' + escapeHtml(state.error) + '</div>' : '') +
        '<button class="assess-nav assess-nav--primary dd-search-btn" id="ddSearchBtn" type="button">🔍 Run Intelligence Check</button>' +
      '</div>'
    );

    $id('ddSearchBtn').addEventListener('click', doSearch);
    $id('dd-query').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    $id('dd-chnum').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    setTimeout(function () { var el = $id('dd-query'); if (el) el.focus(); }, 100);
  }

  // ── Loading screen ──────────────────────────────────────────────────────────

  function renderLoading() {
    setBody(
      '<div class="assess-loading">' +
        '<div class="dd-spinner"></div>' +
        '<p id="dd-loading-step">' + escapeHtml(state.loadingStep || 'Fetching Companies House data…') + '</p>' +
      '</div>'
    );
  }

  // ── Search pipeline ─────────────────────────────────────────────────────────

  function doSearch() {
    var name = ($id('dd-query').value || '').trim();
    var num  = ($id('dd-chnum').value || '').trim().toUpperCase().replace(/\s/g, '');
    var vat  = ($id('dd-vat').value || '').trim().toUpperCase().replace(/\s/g, '');
    if (!name && !num) { state.error = 'Please enter a company name or number.'; renderSearch(); return; }

    var claudeKey = localStorage.getItem('frankieClaudeKey') || '';
    if (!claudeKey) { state.error = 'No Claude API key found — add it in Frankie settings.'; renderSearch(); return; }

    state.query = name || ('CH: ' + num);
    state.companyNumber = num;
    state.vatNumber = vat;
    state.error = null;
    state.activeTab = 'intelligence';
    state.phase = 'loading';
    state.loadingStep = 'Searching Companies House…';
    renderPhase();

    // Step 1: resolve company number, then fetch all data in parallel
    resolveCompanyNumber(name, num)
      .then(function (resolvedNum) {
        state.companyNumber = resolvedNum;
        setStep('Fetching Companies House, VAT & sanctions data…');
        return Promise.all([
          fetchAllCHData(resolvedNum),
          fetchCHExtra(resolvedNum),
          vat ? fetchVAT(vat) : Promise.resolve(null),
          fetchSanctions(name || resolvedNum),
        ]);
      })
      .then(function (results) {
        state.chData        = results[0];
        state.chExtra       = results[1];
        state.vatData       = results[2];
        state.sanctionsData = results[3];
        if (state.chData && state.chData.profile && state.chData.profile.company_name) {
          state.query = state.chData.profile.company_name;
        }
        setStep('Frankie is assessing CSFI risk…');
        return askClaude(state.query, state.companyNumber, vat, state.chData, state.vatData, state.sanctionsData, claudeKey);
      })
      .then(function (result) {
        state.result = result;
        state.phase  = 'results';
        renderPhase();
      })
      .catch(function (err) {
        state.error = err.message || 'Something went wrong. Please try again.';
        state.phase = 'search';
        renderPhase();
      });
  }

  // ── Step 1: resolve CH number from name ─────────────────────────────────────

  function resolveCompanyNumber(name, num) {
    if (num) return Promise.resolve(num);
    return fetch(CH_PROXY + '/search/companies?q=' + encodeURIComponent(name) + '&items_per_page=5')
      .then(function (r) {
        if (!r.ok) throw new Error('Companies House search failed (' + r.status + '). Check the company name and try again.');
        return r.json();
      })
      .then(function (data) {
        var items = data.items || [];
        if (!items.length) throw new Error('No company found matching "' + name + '" on Companies House.');
        // Pick best match — prefer exact name match
        var nameLower = name.toLowerCase();
        var exact = items.filter(function (i) { return (i.title || '').toLowerCase() === nameLower; });
        var chosen = exact.length ? exact[0] : items[0];
        state.companyNumber = chosen.company_number;
        return chosen.company_number;
      });
  }

  // ── Step 2: fetch profile + officers + filings ───────────────────────────────

  function fetchAllCHData(num) {
    if (!num) return Promise.resolve(null);
    return Promise.all([
      fetch(CH_PROXY + '/company/' + encodeURIComponent(num))
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
      fetch(CH_PROXY + '/company/' + encodeURIComponent(num) + '/officers?items_per_page=20')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
      fetch(CH_PROXY + '/company/' + encodeURIComponent(num) + '/filing-history?items_per_page=15')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
      fetch(CH_PROXY + '/company/' + encodeURIComponent(num) + '/persons-with-significant-control')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
    ]).then(function (results) {
      return {
        profile:  results[0],
        officers: results[1],
        filings:  results[2],
        pscs:     results[3],
      };
    });
  }

  // ── Step 2b: HMRC VAT validation ────────────────────────────────────────────

  function fetchVAT(vat) {
    var clean = vat.replace(/^GB/i, '').replace(/\D/g, '');
    return fetch(WORKER_BASE + '/hmrc/organisations/vat/check-vat-number/lookup/' + encodeURIComponent(clean))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // ── Step 2c: OpenSanctions search ───────────────────────────────────────────

  function fetchSanctions(query) {
    return fetch(SANCTIONS_CSV_URL)
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (csv) {
        if (!csv) return { error: 'Could not fetch sanctions list' };
        var terms = query.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 2; });
        var lines = csv.split('\n');
        var hits = [];
        for (var i = 1; i < lines.length; i++) {
          var line = lines[i].toLowerCase();
          if (terms.length && terms.every(function (t) { return line.indexOf(t) > -1; })) {
            var cols = parseCSVLine(lines[i]);
            if (cols.length > 2) {
              hits.push({ name: (cols[2] || cols[1] || cols[0]).trim(), regime: (cols[0] || '').trim() });
            }
          }
        }
        return { hits: hits, total: lines.length - 1 };
      })
      .catch(function () { return null; });
  }

  function parseCSVLine(line) {
    var cols = []; var cur = ''; var inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur); cur = ''; }
      else { cur += c; }
    }
    cols.push(cur);
    return cols;
  }

  // ── Step 2d: CH Charges + Insolvency ────────────────────────────────────────

  function fetchCHExtra(num) {
    if (!num) return Promise.resolve({ charges: null, insolvency: null });
    return Promise.all([
      fetch(CH_PROXY + '/company/' + encodeURIComponent(num) + '/charges')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
      fetch(CH_PROXY + '/company/' + encodeURIComponent(num) + '/insolvency')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
    ]).then(function (res) {
      return { charges: res[0], insolvency: res[1] };
    });
  }

  // ── Step 3: Claude CSFI synthesis ───────────────────────────────────────────

  function askClaude(name, num, vat, chData, vatData, sanctionsData, claudeKey) {
    var companyRef = name + (num ? ' (CH: ' + num + ')' : '') + (vat ? ', VAT: ' + vat : '');

    // Flatten CH data into a clean summary for Claude
    var p       = chData && chData.profile;
    var officers = chData && chData.officers && chData.officers.items || [];
    var pscs     = chData && chData.pscs     && chData.pscs.items     || [];
    var filings  = chData && chData.filings  && chData.filings.items  || [];

    var activeOfficers  = officers.filter(function (o) { return !o.resigned_on; });
    var resignedCount   = officers.filter(function (o) { return  o.resigned_on; }).length;
    var recentFilings   = filings.slice(0, 10);
    var overdueFlag     = p && p.accounts && p.accounts.overdue;
    var csFlag          = p && p.confirmation_statement && p.confirmation_statement.overdue;

    var chSummary = p ? [
      'LIVE COMPANIES HOUSE DATA:',
      'Name: '           + (p.company_name || 'Unknown'),
      'Status: '         + (p.company_status || 'Unknown'),
      'Type: '           + (p.type || 'Unknown'),
      'Incorporated: '   + (p.date_of_creation || 'Unknown'),
      'Jurisdiction: '   + (p.jurisdiction || 'Unknown'),
      'SIC codes: '      + (p.sic_codes ? p.sic_codes.join(', ') : 'Not filed'),
      'Registered address: ' + formatAddress(p.registered_office_address),
      'Accounts overdue: ' + (overdueFlag ? 'YES ⚠️' : 'No'),
      'Confirmation statement overdue: ' + (csFlag ? 'YES ⚠️' : 'No'),
      'Has been liquidated: ' + (p.has_been_liquidated ? 'YES ⚠️' : 'No'),
      'Has insolvency history: ' + (p.has_insolvency_history ? 'YES ⚠️' : 'No'),
      'Can file: ' + (p.can_file !== false ? 'Yes' : 'No'),
      '',
      'ACTIVE OFFICERS (' + activeOfficers.length + '):',
      activeOfficers.slice(0, 8).map(function (o) {
        return '  - ' + (o.name || '') + ' (' + (o.officer_role || '') + ', appointed ' + (o.appointed_on || '?') + ')';
      }).join('\n'),
      resignedCount > 0 ? 'Resigned officers: ' + resignedCount + ' (check for rapid turnover)' : '',
      '',
      'PERSONS WITH SIGNIFICANT CONTROL (' + pscs.length + '):',
      pscs.slice(0, 5).map(function (psc) {
        return '  - ' + (psc.name || psc.kind || 'Unknown') + ' — ' + (psc.natures_of_control ? psc.natures_of_control.join(', ') : '');
      }).join('\n') || '  None registered or not available',
      '',
      'RECENT FILINGS:',
      recentFilings.map(function (f) {
        return '  ' + (f.date || '') + '  ' + (f.type || '') + '  ' + (f.description || '');
      }).join('\n') || '  No filings found',
    ].filter(function (l) { return l !== null && l !== undefined; }).join('\n')
    : 'No Companies House data could be retrieved.';

    // VAT summary
    var vatSummary = '';
    if (vat && vatData) {
      var vr = vatData.target || vatData;
      vatSummary = '\nHMRC VAT CHECK:\n' +
        'VAT number entered: ' + vat + '\n' +
        'Registered name: ' + (vr.name || 'Unknown') + '\n' +
        'Address: ' + (vr.address ? [vr.address.line1, vr.address.line2, vr.address.line3, vr.address.postcode].filter(Boolean).join(', ') : 'Not returned') + '\n' +
        'Name match: ' + (vr.name && name && vr.name.toLowerCase().includes(name.toLowerCase().split(' ')[0]) ? 'MATCHES company name' : 'CHECK — name may differ');
    } else if (vat && !vatData) {
      vatSummary = '\nHMRC VAT CHECK: VAT lookup failed or not available.';
    }

    // Sanctions summary
    var sanctionsSummary = '';
    if (sanctionsData && !sanctionsData.error) {
      var sHitList = sanctionsData.hits || [];
      sanctionsSummary = '\nUK CONSOLIDATED SANCTIONS LIST (FCDO/OFSI):\n' +
        (sHitList.length
          ? 'MATCHES FOUND (' + sHitList.length + '):\n' + sHitList.slice(0, 3).map(function (h) {
              return '  - ' + h.name + ' (Regime: ' + (h.regime || 'Unknown') + ')';
            }).join('\n')
          : 'No matches on UK sanctions list.');
    } else {
      sanctionsSummary = '\nUK SANCTIONS CHECK: Could not retrieve data.';
    }

    var prompt = [
      'You are Frankie, a nuclear supply chain intelligence assistant for the Fit for Nuclear (F4N) programme.',
      'Produce a CSFI supplier intelligence briefing using the LIVE data below.',
      '',
      'Supplier: ' + companyRef,
      '',
      chSummary,
      vatSummary,
      sanctionsSummary,
      '',
      'RULES:',
      '- Use the live data above — do not hedge on anything it covers.',
      '- The data is real and current. State facts directly.',
      '- Apply ONR TAG NS-TAST-GD-077 logic throughout.',
      '- Note: SIC code 46 = wholesale/trading intermediary (high CSFI risk). SIC 33 = repair/installation. SIC 25 = fabricated metals manufacturer. Interpret accordingly.',
      '- Flag overdue accounts, insolvency history, high officer turnover, PSC opacity, sanctions hits, or VAT name mismatches as red flags.',
      '- FORMATTING: Start directly with **1.** — no title, no preamble, no --- or # lines.',
      '',
      '**1. Company Overview** — name, status, type, incorporated, region, SIC/trading sector with interpretation',
      '**2. Ownership & Control** — PSCs, directors, group structure; flag any opacity or rapid changes',
      '**3. Financial Health** — accounts status, overdue filings, insolvency history, what the filing pattern suggests',
      '**4. Nuclear Credentials** — note any nuclear/engineering SIC relevance; state that certifications (ISO 9001/19443, F4N, NQA) must be verified externally as CH does not hold this data',
      '**5. CSFI Risk Assessment** — OEM, authorised distributor, or intermediary/broker? Apply NS-TAST-GD-077: what does the SIC code and company type tell you? Any structural red flags for a nuclear supply chain buyer?',
      '**6. Red Flags** — specific flags from the data. If none: say so explicitly.',
      '**7. CSFI Risk Rating** — Low / Medium / High — one decisive sentence citing the key data points.',
      '',
      'Max 450 words.',
    ].join('\n');

    // Supplier Intelligence uses Sonnet — CSFI analysis is complex multi-source synthesis
    // that produces noticeably better output than Haiku at acceptable cost (low call volume).
    var model = 'claude-sonnet-4-6';

    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || 'Claude error ' + r.status); });
        return r.json();
      })
      .then(function (data) {
        var text = data.content && data.content[0] && data.content[0].text || '';
        if (!text) throw new Error('Empty Claude response.');
        var ratingMatch = text.match(/CSFI Risk Rating[^*:]*[*:]+\s*(Low|Medium|High)/i);
        return { summary: text, rating: ratingMatch ? ratingMatch[1] : 'Medium' };
      });
  }

  // ── Results screen ──────────────────────────────────────────────────────────

  function renderResults() {
    var r  = state.result;
    var rc = ratingClass(r.rating);
    var footerRating = $id('dd-footer-rating');
    if (footerRating) {
      footerRating.innerHTML = '<span class="dd-rating-badge ' + rc + '">CSFI: ' + escapeHtml(r.rating) + '</span>';
    }

    var tabs = [
      { id: 'intelligence', label: '📊 Intelligence' },
      { id: 'chdata',       label: '🏛️ CH Data' },
      { id: 'checks',       label: '🔎 Checks' },
      { id: 'web',          label: '🌐 Web Intel' },
      { id: 'verify',       label: '✅ Verify' },
    ];

    setBody(
      '<div class="dd-tab-bar">' +
        tabs.map(function (t) {
          return '<button class="dd-tab' + (state.activeTab === t.id ? ' dd-tab--active' : '') +
            '" data-tab="' + t.id + '" type="button">' + t.label + '</button>';
        }).join('') +
      '</div>' +
      '<div id="dd-tab-content"></div>'
    );

    document.querySelectorAll('.dd-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.activeTab = btn.dataset.tab;
        document.querySelectorAll('.dd-tab').forEach(function (b) {
          b.classList.toggle('dd-tab--active', b.dataset.tab === state.activeTab);
        });
        renderTabContent();
      });
    });

    renderTabContent();
  }

  function renderTabContent() {
    var el = $id('dd-tab-content');
    if (!el) return;
    if      (state.activeTab === 'intelligence') el.innerHTML = buildIntelligenceTab();
    else if (state.activeTab === 'chdata')       el.innerHTML = buildCHDataTab();
    else if (state.activeTab === 'checks')       el.innerHTML = buildChecksTab();
    else if (state.activeTab === 'web')          buildWebIntelTab(el);
    else if (state.activeTab === 'verify')       buildVerifyTab(el);
  }

  // ── Intelligence tab ────────────────────────────────────────────────────────

  function buildIntelligenceTab() {
    var r   = state.result;
    var rc  = ratingClass(r.rating);
    var p   = state.chData && state.chData.profile;

    // Facts bar from real CH data
    var factsBar = '';
    if (p) {
      var chips = [];
      chips.push(factChip('Status', p.company_status || 'Unknown', p.company_status === 'active' ? 'good' : p.company_status ? 'bad' : ''));
      chips.push(factChip('Type', friendlyType(p.type), ''));
      if (p.date_of_creation) chips.push(factChip('Incorporated', p.date_of_creation.slice(0, 4), ''));
      if (p.sic_codes && p.sic_codes.length) chips.push(factChip('SIC', p.sic_codes[0], ''));
      if (p.has_insolvency_history) chips.push(factChip('Insolvency', 'History found', 'bad'));
      if (p.accounts && p.accounts.overdue) chips.push(factChip('Accounts', 'Overdue ⚠️', 'bad'));
      if (p.has_been_liquidated) chips.push(factChip('Liquidated', 'Yes', 'bad'));
      factsBar = '<div class="dd-facts-bar">' + chips.join('') + '</div>';
    }

    var summaryHtml = r.summary
      .replace(/^#{1,3}\s+.+$/gm, '')
      .replace(/^-{2,}\s*$/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(\n\s*){3,}/g, '\n\n')
      .trim()
      .replace(/\n/g, '<br>');

    return (
      '<div class="dd-result-header">' +
        '<div class="dd-profile-name">' + escapeHtml(state.query) +
          (state.companyNumber ? ' <span class="dd-co-num">' + escapeHtml(state.companyNumber) + '</span>' : '') +
        '</div>' +
        '<div class="dd-rating-badge ' + rc + '">CSFI: ' + escapeHtml(r.rating) + '</div>' +
      '</div>' +
      factsBar +
      '<div class="dd-risk-summary">' + summaryHtml + '</div>' +
      '<p class="dd-source-note">Based on live Companies House data. <button class="dd-tab-link" data-tab="chdata">View raw CH data →</button></p>' +
      '<p class="dd-disclaimer">Certifications (ISO 9001/19443, F4N, NQA) are not held on CH — verify separately via UKAS CertCheck and the Verify tab.</p>'
    );
  }

  // ── CH Data tab ─────────────────────────────────────────────────────────────

  function buildCHDataTab() {
    var d = state.chData;
    if (!d || !d.profile) {
      return '<p class="dd-empty">No Companies House data available.</p>';
    }
    var p       = d.profile;
    var officers = d.officers && d.officers.items || [];
    var pscs     = d.pscs     && d.pscs.items     || [];
    var filings  = d.filings  && d.filings.items  || [];

    var html = '';

    // Profile rows
    html += '<div class="dd-section-title">Company Profile</div>';
    html += '<div class="dd-ch-table">';
    var rows = [
      ['Registered name',  p.company_name],
      ['CH number',        p.company_number],
      ['Status',           badge(p.company_status)],
      ['Type',             friendlyType(p.type)],
      ['Incorporated',     p.date_of_creation],
      ['Jurisdiction',     p.jurisdiction],
      ['SIC codes',        p.sic_codes ? p.sic_codes.join(', ') : '—'],
      ['Registered address', formatAddress(p.registered_office_address)],
      ['Accounts overdue', p.accounts && p.accounts.overdue ? '<span style="color:#dc2626;font-weight:700">Yes</span>' : 'No'],
      ['CS overdue',       p.confirmation_statement && p.confirmation_statement.overdue ? '<span style="color:#dc2626;font-weight:700">Yes</span>' : 'No'],
      ['Insolvency history', p.has_insolvency_history ? '<span style="color:#dc2626;font-weight:700">Yes</span>' : 'No'],
      ['Liquidated',       p.has_been_liquidated ? '<span style="color:#dc2626;font-weight:700">Yes</span>' : 'No'],
    ];
    rows.forEach(function (r) {
      if (r[1] !== undefined && r[1] !== null) {
        html += '<div class="dd-ch-row"><span class="dd-ch-label">' + escapeHtml(r[0]) + '</span><span class="dd-ch-value">' + (r[1] === badge(p.company_status) || r[1].indexOf('<span') > -1 ? r[1] : escapeHtml(r[1])) + '</span></div>';
      }
    });
    html += '</div>';

    // Officers
    var activeOfficers  = officers.filter(function (o) { return !o.resigned_on; });
    var resignedOfficers = officers.filter(function (o) { return  o.resigned_on; });
    html += '<div class="dd-section-title">Active Officers (' + activeOfficers.length + ')</div>';
    if (activeOfficers.length) {
      html += '<div class="dd-officer-list">';
      activeOfficers.forEach(function (o) {
        html += '<div class="dd-officer-card">' +
          '<div class="dd-officer-name">' + escapeHtml(o.name || '—') + '</div>' +
          '<div class="dd-officer-meta">' + escapeHtml(o.officer_role || '') + ' — appointed ' + escapeHtml(o.appointed_on || '?') + '</div>' +
        '</div>';
      });
      html += '</div>';
      if (resignedOfficers.length) {
        html += '<p class="dd-source-note">' + resignedOfficers.length + ' resigned officer(s) on record.</p>';
      }
    } else {
      html += '<p class="dd-empty">No active officers returned.</p>';
    }

    // PSCs
    html += '<div class="dd-section-title">Persons with Significant Control (' + pscs.length + ')</div>';
    if (pscs.length) {
      html += '<div class="dd-officer-list">';
      pscs.forEach(function (psc) {
        html += '<div class="dd-officer-card">' +
          '<div class="dd-officer-name">' + escapeHtml(psc.name || psc.kind || 'Unknown') + '</div>' +
          '<div class="dd-officer-meta">' + escapeHtml((psc.natures_of_control || []).join(', ')) + '</div>' +
        '</div>';
      });
      html += '</div>';
    } else {
      html += '<p class="dd-empty">No PSC data available.</p>';
    }

    // Filings
    html += '<div class="dd-section-title">Recent Filings</div>';
    if (filings.length) {
      html += '<div class="dd-filing-list">';
      filings.slice(0, 15).forEach(function (f) {
        var warn = f.type && (f.type.indexOf('GAZ') > -1 || f.type.indexOf('DS') > -1 || f.type.indexOf('LIQ') > -1);
        html += '<div class="dd-filing-row' + (warn ? ' dd-filing-row--warn' : '') + '">' +
          '<span class="dd-filing-date">' + escapeHtml(f.date || '') + '</span>' +
          '<span class="dd-filing-type">' + escapeHtml(f.type || '') + '</span>' +
          '<span class="dd-filing-desc">' + escapeHtml(f.description || '') + '</span>' +
        '</div>';
      });
      html += '</div>';
    } else {
      html += '<p class="dd-empty">No filing history returned.</p>';
    }

    html += '<a class="dd-ch-link" href="https://find-and-update.company-information.service.gov.uk/company/' + escapeHtml(state.companyNumber) + '" target="_blank" rel="noopener">View full record on Companies House ↗</a>';

    return html;
  }

  // ── Checks tab ──────────────────────────────────────────────────────────────

  function buildChecksTab() {
    var html = '<div class="dd-checks">';

    // ── VAT Check ──
    html += '<div class="dd-section-title">HMRC VAT Validation</div>';
    if (!state.vatNumber) {
      html += '<div class="dd-check-row dd-check--neutral"><span class="dd-check-icon">➖</span><div><strong>Not checked</strong><span>No VAT number entered</span></div></div>';
    } else if (!state.vatData) {
      html += '<div class="dd-check-row dd-check--warn"><span class="dd-check-icon">⚠️</span><div><strong>Lookup failed</strong><span>VAT ' + escapeHtml(state.vatNumber) + ' — could not reach HMRC</span></div></div>';
    } else {
      var vr = state.vatData.target || state.vatData;
      var vatName = vr.name || '';
      var queryFirst = (state.query || '').toLowerCase().split(' ')[0];
      var nameMatch = vatName && queryFirst && vatName.toLowerCase().includes(queryFirst);
      var vatAddr = vr.address ? [vr.address.line1, vr.address.line2, vr.address.line3, vr.address.postcode].filter(Boolean).join(', ') : '';
      html += '<div class="dd-check-row ' + (nameMatch ? 'dd-check--good' : 'dd-check--warn') + '">' +
        '<span class="dd-check-icon">' + (nameMatch ? '✅' : '⚠️') + '</span>' +
        '<div>' +
          '<strong>' + escapeHtml(vatName || 'Name not returned') + '</strong>' +
          '<span>VAT: ' + escapeHtml(state.vatNumber) + (vatAddr ? ' · ' + escapeHtml(vatAddr) : '') + '</span>' +
          '<span>' + (nameMatch ? 'Name matches company' : 'Name mismatch — verify manually') + '</span>' +
        '</div>' +
      '</div>';
    }

    // ── Sanctions Check ──
    html += '<div class="dd-section-title">UK Consolidated Sanctions List (FCDO/OFSI)</div>';
    if (!state.sanctionsData) {
      html += '<div class="dd-check-row dd-check--warn"><span class="dd-check-icon">⚠️</span><div><strong>Could not retrieve list</strong><span>Check worker is deployed and try again</span></div></div>';
    } else if (state.sanctionsData.error) {
      html += '<div class="dd-check-row dd-check--warn"><span class="dd-check-icon">⚠️</span><div><strong>Lookup failed</strong><span>' + escapeHtml(state.sanctionsData.error) + '</span></div></div>';
    } else {
      var sHits = state.sanctionsData.hits || [];
      var sTotal = state.sanctionsData.total || 0;
      if (!sHits.length) {
        html += '<div class="dd-check-row dd-check--good"><span class="dd-check-icon">✅</span><div>' +
          '<strong>No matches on UK Sanctions List</strong>' +
          '<span>Searched "' + escapeHtml(state.query) + '" across ' + sTotal.toLocaleString() + ' entries</span>' +
        '</div></div>';
      } else {
        html += '<div class="dd-check-row dd-check--bad"><span class="dd-check-icon">🚨</span><div>' +
          '<strong>' + sHits.length + ' MATCH' + (sHits.length > 1 ? 'ES' : '') + ' ON UK SANCTIONS LIST</strong>' +
          '<span>Immediate manual review required before any engagement</span>' +
        '</div></div>';
        sHits.slice(0, 5).forEach(function (h) {
          html += '<div class="dd-check-hit dd-check-hit--high">' +
            '<span class="dd-hit-caption">' + escapeHtml(h.name) + '</span>' +
            '<span class="dd-hit-datasets">Regime: ' + escapeHtml(h.regime || 'Unknown') + '</span>' +
          '</div>';
        });
      }
      html += '<p class="dd-source-note">Official UK Consolidated Sanctions List (OFSI). <a href="https://search-uk-sanctions-list.service.gov.uk/search?searchValue=' + encodeURIComponent(state.query) + '" target="_blank" rel="noopener">Search gov.uk tool ↗</a></p>';
    }

    // ── CH Charges ──
    var charges = state.chExtra && state.chExtra.charges;
    var chargeItems = charges && charges.items || [];
    var outstandingCharges = chargeItems.filter(function (c) { return c.status !== 'fully-satisfied' && c.status !== 'satisfied'; });
    html += '<div class="dd-section-title">CH Charges Register</div>';
    if (!charges) {
      html += '<div class="dd-check-row dd-check--neutral"><span class="dd-check-icon">➖</span><div><strong>No data returned</strong><span>Could not retrieve charges</span></div></div>';
    } else if (!chargeItems.length) {
      html += '<div class="dd-check-row dd-check--good"><span class="dd-check-icon">✅</span><div><strong>No charges on record</strong><span>Clean charges register</span></div></div>';
    } else {
      var tone = outstandingCharges.length ? 'dd-check--warn' : 'dd-check--good';
      var icon = outstandingCharges.length ? '⚠️' : '✅';
      html += '<div class="dd-check-row ' + tone + '"><span class="dd-check-icon">' + icon + '</span><div>' +
        '<strong>' + chargeItems.length + ' charge' + (chargeItems.length > 1 ? 's' : '') + ' — ' + outstandingCharges.length + ' outstanding</strong>' +
        '<span>' + (outstandingCharges.length ? 'Outstanding charges may indicate financial obligations or liens on assets' : 'All charges satisfied') + '</span>' +
        '</div></div>';
      chargeItems.slice(0, 5).forEach(function (c) {
        var bad = c.status !== 'fully-satisfied' && c.status !== 'satisfied';
        html += '<div class="dd-check-hit ' + (bad ? 'dd-check-hit--high' : 'dd-check-hit--low') + '">' +
          '<span class="dd-hit-caption">' + escapeHtml(c.classification && c.classification.description || c.charge_number || 'Charge') + '</span>' +
          '<span class="dd-hit-score">Status: ' + escapeHtml(c.status || 'Unknown') + '</span>' +
          '<span class="dd-hit-datasets">Created: ' + escapeHtml(c.created_on || '?') + (c.persons_entitled ? ' · ' + (c.persons_entitled || []).map(function (p) { return p.name; }).join(', ') : '') + '</span>' +
        '</div>';
      });
    }

    // ── CH Insolvency ──
    var insolvency = state.chExtra && state.chExtra.insolvency;
    var insolvencyCases = insolvency && insolvency.cases || [];
    html += '<div class="dd-section-title">CH Insolvency History</div>';
    if (!insolvency || !insolvencyCases.length) {
      html += '<div class="dd-check-row dd-check--good"><span class="dd-check-icon">✅</span><div><strong>No insolvency cases</strong><span>No administration, liquidation or receivership on record</span></div></div>';
    } else {
      html += '<div class="dd-check-row dd-check--bad"><span class="dd-check-icon">🚨</span><div>' +
        '<strong>' + insolvencyCases.length + ' insolvency case' + (insolvencyCases.length > 1 ? 's' : '') + ' on record</strong>' +
        '<span>Review cases before proceeding with this supplier</span>' +
      '</div></div>';
      insolvencyCases.slice(0, 3).forEach(function (c) {
        html += '<div class="dd-check-hit dd-check-hit--high">' +
          '<span class="dd-hit-caption">' + escapeHtml((c.type || []).join(', ') || 'Case') + '</span>' +
          '<span class="dd-hit-score">Dates: ' + escapeHtml(c.dates && c.dates.map(function (d) { return d.type + ': ' + d.date; }).join(', ') || '?') + '</span>' +
          '<span class="dd-hit-datasets">Practitioners: ' + escapeHtml(c.practitioners && c.practitioners.map(function (p) { return p.name; }).join(', ') || 'Not listed') + '</span>' +
        '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  // ── Shared Brave search pool ─────────────────────────────────────────────────
  // Both Web Intel and Verify share one set of searches to avoid rate-limiting.
  // 4 queries total, run once, cached for the session.

  var braveResultsCache = null; // raw results array, shared between tabs
  var webIntelCache     = null;
  var verifyCache       = null;

  var BRAVE_QUERIES; // initialised in runBravePool()

  function runBravePool(name) {
    if (braveResultsCache) return Promise.resolve(braveResultsCache);
    // Strip legal suffixes to get trading name — better for finding their actual site
    var tradingName = name.replace(/\b(LIMITED|LTD\.?|TRADING|PLC|LLP|CIC|GROUP)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    // Add town from CH data if available to narrow results
    var town = state.chData && state.chData.profile && state.chData.profile.registered_office_address && state.chData.profile.registered_office_address.locality || '';
    var websiteQ = '"' + tradingName + '"' + (town ? ' ' + town : '') + ' -site:companieshouse.gov.uk -site:opencorporates.com -site:linkedin.com -site:endole.co.uk -site:duedil.com -site:companies-house.co.uk';

    BRAVE_QUERIES = [
      { key: 'website',  q: websiteQ },
      { key: 'onr',      q: '"' + name + '" ONR "Office for Nuclear Regulation" OR enforcement OR "information notice"' },
      { key: 'csfi',     q: '"' + name + '" counterfeit fraud suspect supply chain OR CCJ OR insolvency OR penalty' },
      { key: 'general',  q: '"' + name + '" nuclear engineering supplier quality approved' },
    ];
    // Stagger requests 300ms apart to avoid Brave rate-limit
    return BRAVE_QUERIES.reduce(function (chain, item, i) {
      return chain.then(function (acc) {
        return new Promise(function (resolve) { setTimeout(resolve, i === 0 ? 0 : 350); })
          .then(function () { return braveSearch(item.q, item.key === 'website'); })
          .then(function (data) {
            acc.push({ key: item.key, results: data.results, summary: data.summary });
            return acc;
          });
      });
    }, Promise.resolve([]))
      .then(function (all) { braveResultsCache = all; return all; });
  }

  // ── Website cert scrape ──────────────────────────────────────────────────────
  // Find company website from Brave results, fetch via worker, Groq extracts certs.

  var certsCache = null;

  function fetchWebsiteCerts(name, pool) {
    if (certsCache) return Promise.resolve(certsCache);

    var websitePool  = pool.find(function (p) { return p.key === 'website'; }) || {};
    var braveSummary = websitePool.summary || '';
    var skipDomains  = ['.gov.uk', 'opencorporates', 'companieshouse', 'endole', 'duedil', 'linkedin', 'facebook', 'twitter', 'instagram', 'youtube', 'companies-house', 'bizify', 'cylex', 'yell.com', 'thomsonlocal', '192.com', 'checkatrade', 'trustpilot', 'glassdoor', 'indeed.com'];
    var siteResult   = (websitePool.results || []).find(function (r) {
      var u = (r.url || '').toLowerCase();
      return !skipDomains.some(function (d) { return u.indexOf(d) > -1; });
    });
    var siteUrl = siteResult ? siteResult.url : null;

    var textToScan = braveSummary;
    var source     = braveSummary ? 'Brave AI summary' : siteUrl;

    // If no Brave summary, fall back to fetching the website
    var getContent = braveSummary
      ? Promise.resolve(braveSummary)
      : (siteUrl
          ? fetch(WORKER_BASE + '/fetch?url=' + encodeURIComponent(siteUrl))
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (d) { return d && d.text ? d.text.slice(0, 6000) : ''; })
              .catch(function () { return ''; })
          : Promise.resolve(''));

    return getContent.then(function (content) {
      if (!content) return { certs: [], source: siteUrl, error: 'No content to scan' };

      var prompt = 'Extract all quality certifications and accreditations mentioned in this text about "' + name + '".\n\n' +
        'TEXT: ' + content + '\n\n' +
        'Look for: ISO 9001, ISO 9001:2015, ISO 14001, ISO 19443, ISO 45001, ISO 27001, EN 1090, EN ISO 3834, ' +
        'AS9100, UKAS, NQA, BSI, Bureau Veritas, DNV, Lloyds Register, F4N, Fit for Nuclear, Achilles, JOSCAR, Cyber Essentials.\n' +
        'Return ONLY valid JSON, no markdown:\n{"certs":["exact cert name as mentioned"]}';

      var groqModel = localStorage.getItem('frankieGroqModel') || 'llama-3.1-8b-instant';
      return fetch(WORKER_BASE + '/groq/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: groqModel, max_tokens: 200, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.usage) { window.TM && window.TM.log({ api: 'groq', model: d.model || '', prompt_tokens: d.usage.prompt_tokens || 0, completion_tokens: d.usage.completion_tokens || 0, source: 'frankie', note: 'due-diligence-certs' }); }
          var text = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '{}';
          try {
            var parsed = JSON.parse(extractJSON(text));
            certsCache = { certs: parsed.certs || [], source: source, fromSummary: !!braveSummary, summaryText: braveSummary };
            return certsCache;
          } catch (e) { return { certs: [], source: source }; }
        })
        .catch(function () { return { certs: [], source: source, error: 'Groq extraction failed' }; });
    });
  }

  // ── Web Intel: topic definitions ───────────────────────────────────────────

  function getWebIntelTopics(name) {
    var trading = name.replace(/\b(LIMITED|LTD\.?|TRADING|PLC|LLP|CIC|GROUP)\b/gi, '').trim();
    return [
      { key: 'tenders',  label: 'Contracts & Tenders Won',        emoji: '📋',
        q: '"' + trading + '" contract awarded OR tender won OR framework OR procurement' },
      { key: 'news',     label: 'Recent News',                    emoji: '📰',
        q: '"' + trading + '" news 2024 2025 -site:companieshouse.gov.uk -site:endole.co.uk' },
      { key: 'customers',label: 'Key Customers & Clients',        emoji: '🤝',
        q: '"' + trading + '" customer client partner supplier case study' },
      { key: 'financial',label: 'Financial Signals',              emoji: '💰',
        q: '"' + trading + '" revenue turnover profit financial results growth investment' },
      { key: 'nuclear',  label: 'Nuclear & Defence Involvement',  emoji: '⚛️',
        q: '"' + trading + '" nuclear defence MOD NDA Sellafield Rolls-Royce EDF Urenco AWE' },
      { key: 'quality',  label: 'Quality Issues & Complaints',    emoji: '⚠️',
        q: '"' + trading + '" complaint recall defect CCJ court warning enforcement quality failure' },
    ];
  }

  function buildWebIntelTab(el) {
    if (webIntelCache) { el.innerHTML = renderWebIntelCards(webIntelCache); return; }

    var name = state.query;
    var topics = getWebIntelTopics(name);

    el.innerHTML = '<div class="assess-loading"><div class="dd-spinner"></div><p>Running ' + topics.length + ' intelligence searches via Brave AI…</p></div>';

    var promises = topics.map(function (topic, i) {
      return new Promise(function (resolve) { setTimeout(resolve, i * 450); })
        .then(function () { return braveSearch(topic.q, true); })
        .then(function (res) {
          return extractWebIntelSignals(name, topic, res.summary, res.results)
            .then(function (signals) {
              return { topic: topic, summary: res.summary, results: res.results, signals: signals };
            });
        })
        .catch(function (err) {
          return { topic: topic, summary: null, results: [], signals: [], error: err.message };
        });
    });

    Promise.all(promises)
      .then(function (cards) {
        webIntelCache = cards;
        el.innerHTML = renderWebIntelCards(cards);
      })
      .catch(function (err) {
        el.innerHTML = '<div class="dd-error">Web Intel failed: ' + escapeHtml(err.message || 'Unknown error') + '</div>';
      });
  }

  function braveSearch(query, withSummary) {
    var url = WORKER_BASE + '/brave/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=5&country=gb&search_lang=en' + (withSummary ? '&summary=1' : '');
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { web: { results: [] } }; })
      .then(function (d) {
        var results = (d.web && d.web.results) || [];
        // Log Brave call (no token count from Brave API)
        window.TM && window.TM.log({ api: 'brave', model: '', prompt_tokens: 0, completion_tokens: 0, source: 'frankie', note: 'due-diligence' });
        // If summarizer key is present, fetch the AI summary too
        var summarizerKey = d.summarizer && d.summarizer.key;
        if (!withSummary || !summarizerKey) return { results: results, summary: null };
        return fetch(WORKER_BASE + '/brave/res/v1/summarizer/search?key=' + encodeURIComponent(summarizerKey) + '&entity_info=1', { headers: { 'Accept': 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (s) {
            // Extract plain text from summary message segments
            var text = '';
            if (s && s.summary && Array.isArray(s.summary)) {
              text = s.summary.map(function (seg) { return seg.data || ''; }).join(' ').trim();
            } else if (s && s.message) {
              text = s.message;
            }
            return { results: results, summary: text || null };
          })
          .catch(function () { return { results: results, summary: null }; });
      })
      .catch(function () { return { results: [], summary: null }; });
  }

  function extractWebIntelSignals(name, topic, summary, results) {
    var text = summary;
    if (!text) {
      // Fallback: use top snippets if no Brave summary
      text = results.slice(0, 3).map(function (r) { return (r.title || '') + ' ' + (r.description || ''); }).join(' ').trim();
    }
    if (!text) return Promise.resolve([]);

    var prompt = 'Extract 2-4 concise signal tags (5 words max each) about "' + name + '" from this text covering ' + topic.label + '.\n' +
      'Text: ' + text.slice(0, 800) + '\n' +
      'Return ONLY valid JSON: {"signals":["tag1","tag2"]}';

    var groqModel = localStorage.getItem('frankieGroqModel') || 'llama-3.1-8b-instant';
    return fetch(WORKER_BASE + '/groq/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: groqModel, max_tokens: 120, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.usage) { window.TM && window.TM.log({ api: 'groq', model: d.model || '', prompt_tokens: d.usage.prompt_tokens || 0, completion_tokens: d.usage.completion_tokens || 0, source: 'frankie', note: 'due-diligence-signals' }); }
        var t = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '{}';
        try { return JSON.parse(extractJSON(t)).signals || []; }
        catch (e) { return []; }
      })
      .catch(function () { return []; });
  }

  function renderWebIntelCards(cards) {
    var html = '<div class="dd-web-results">';
    cards.forEach(function (c) { html += renderWebIntelCard(c.topic, c); });
    html += '<p class="dd-source-note">Brave Search AI summaries + Groq signal extraction via Frankie proxy. Public web at time of search.</p>';
    html += '</div>';
    return html;
  }

  function renderWebIntelCard(topic, data) {
    var hasSummary = !!data.summary;
    var hasResults = data.results && data.results.length > 0;
    var html = '<div class="dd-web-section">';
    html += '<div class="dd-section-title">' + topic.emoji + ' ' + escapeHtml(topic.label) + '</div>';

    if (!hasSummary && !hasResults) {
      html += '<div class="dd-check-row dd-check--neutral"><span class="dd-check-icon">➖</span><div><span>No public information found for this topic</span></div></div>';
    } else {
      // Brave AI summary text or fallback snippet
      var summaryText = hasSummary ? data.summary : (data.results[0].title || '') + ' — ' + (data.results[0].description || '');
      html += '<div class="dd-web-verdict">' + escapeHtml(summaryText) + '</div>';

      // Groq signal tags
      if (data.signals && data.signals.length) {
        html += '<div class="dd-web-signals">' +
          data.signals.map(function (s) { return '<span class="dd-cert-tag">' + escapeHtml(s) + '</span>'; }).join('') +
          '</div>';
      }

      // Top source links
      var links = (data.results || []).slice(0, 3);
      if (links.length) {
        html += '<div class="dd-verify-links">' +
          links.map(function (r) {
            var label = r.title || (r.url || '').replace(/^https?:\/\//, '').split('/')[0];
            return '<a class="dd-verify-link" href="' + escapeHtml(r.url || '#') + '" target="_blank" rel="noopener">' + escapeHtml(label) + '</a>';
          }).join('') +
          '</div>';
      }
    }

    html += '</div>';
    return html;
  }

  // ── Verify tab — auto-searched register lookups ─────────────────────────────

  var verifyCache = null;

  function buildVerifyTab(el) {
    if (verifyCache) { el.innerHTML = renderVerifyResults(verifyCache); return; }

    el.innerHTML = '<div class="assess-loading"><div class="dd-spinner"></div><p>Checking registers…</p></div>';

    var name = state.query;
    var num  = state.companyNumber;

    runBravePool(name)
      .then(function (pool) {
        el.innerHTML = '<div class="assess-loading"><div class="dd-spinner"></div><p>Scanning website &amp; checking registers…</p></div>';
        var allData = [
          { check: { key: 'onr',    label: 'ONR Register' },     results: (pool.find(function(p){return p.key==='onr';})     || {results:[]}).results },
          { check: { key: 'gs1',    label: 'GS1 Verification' }, results: (pool.find(function(p){return p.key==='general';}) || {results:[]}).results },
          { check: { key: 'f4n',    label: 'Fit for Nuclear' },  results: (pool.find(function(p){return p.key==='general';}) || {results:[]}).results },
          { check: { key: 'credit', label: 'Financial / CCJs' }, results: (pool.find(function(p){return p.key==='csfi';})    || {results:[]}).results },
        ];
        return Promise.all([
          groqVerify(name, allData),
          fetchWebsiteCerts(name, pool),
        ]);
      })
      .then(function (results) {
        verifyCache = { parsed: results[0], certs: results[1], name: name, num: num };
        el.innerHTML = renderVerifyResults(verifyCache);
      })
      .catch(function (err) {
        el.innerHTML = '<div class="dd-error">Register check failed: ' + escapeHtml(err.message || 'Unknown error') + '</div>';
      });
  }

  function groqVerify(name, allData) {
    // Build a concise brief per check
    var sections = allData.map(function (d) {
      var snippets = d.results.slice(0, 4).map(function (r) {
        return (r.title || '') + ' — ' + (r.description || '') + ' [' + (r.url || '') + ']';
      }).join('\n');
      return 'CHECK: ' + d.check.label + '\n' + (snippets || 'No results found.');
    }).join('\n\n---\n\n');

    var prompt = 'You are a nuclear supply chain analyst. Review the search results below for "' + name + '" and complete the JSON.\n\n' +
      sections + '\n\n' +
      'Fill in this JSON based ONLY on what the search results above actually say. Do not invent information.\n' +
      'status must be exactly "found", "not_found", or "unclear".\n' +
      'detail must be a plain sentence describing what the results actually show (or "No relevant results found." if nothing useful).\n\n' +
      'Return ONLY valid JSON, no markdown, no notes:\n' +
      '{"certs":{"status":"","detail":""},' +
      '"onr":{"status":"","detail":""},' +
      '"gs1":{"status":"","detail":""},' +
      '"f4n":{"status":"","detail":""},' +
      '"credit":{"status":"","detail":""}}';

    var groqModel = localStorage.getItem('frankieGroqModel') || 'llama-3.1-8b-instant';
    return fetch(WORKER_BASE + '/groq/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: groqModel,
        max_tokens: 500,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.usage) { window.TM && window.TM.log({ api: 'groq', model: d.model || '', prompt_tokens: d.usage.prompt_tokens || 0, completion_tokens: d.usage.completion_tokens || 0, source: 'frankie', note: 'due-diligence-verify' }); }
        var text = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '{}';
        try { return JSON.parse(extractJSON(text)); }
        catch (e) { return {}; }
      });
  }

  function renderVerifyResults(cache) {
    var d   = cache.parsed || {};
    var num = cache.num;
    var name = cache.name;

    var checks = [
      { key: 'onr',    label: 'ONR Register',              icon: '☢️', goodIfFound: false },
      { key: 'gs1',    label: 'GS1 Product Verification',  icon: '📦', goodIfFound: true  },
      { key: 'f4n',    label: 'Fit for Nuclear (F4N)',     icon: '⚛️', goodIfFound: true  },
      { key: 'credit', label: 'Financial / CCJs',          icon: '💳', goodIfFound: false },
    ];

    var html = '<div class="dd-verify-auto">';
    html += '<p class="dd-verify-hint">Certifications scanned from company website. Other checks via Brave + Groq.</p>';

    // ── Certifications from website ──
    var c = cache.certs || {};
    html += '<div class="dd-section-title">🏅 Certifications &amp; Accreditations</div>';
    if (c.error && !c.certs) {
      html += '<div class="dd-check-row dd-check--neutral"><span class="dd-check-icon">➖</span><div><strong>Could not scan website</strong><span>' + escapeHtml(c.error) + '</span></div></div>';
    } else if (!c.certs || !c.certs.length) {
      html += '<div class="dd-check-row dd-check--neutral"><span class="dd-check-icon">➖</span><div><strong>None found on website</strong>' + (c.source ? '<span>Scanned: <a href="' + escapeHtml(c.source) + '" target="_blank" rel="noopener">' + escapeHtml(c.source) + '</a></span>' : '') + '</div></div>';
    } else {
      var sourceLabel = c.fromSummary ? 'Brave AI summary' : c.source;
      var sourceHtml  = c.fromSummary
        ? '<span>Source: Brave AI summary</span>'
        : (c.source ? '<span>From: <a href="' + escapeHtml(c.source) + '" target="_blank" rel="noopener">' + escapeHtml(c.source) + ' ↗</a></span>' : '');
      html += '<div class="dd-check-row dd-check--good"><span class="dd-check-icon">✅</span><div>' +
        '<strong>' + c.certs.length + ' certification' + (c.certs.length > 1 ? 's' : '') + ' found</strong>' +
        sourceHtml +
        c.certs.map(function (cert) { return '<span class="dd-cert-tag">' + escapeHtml(cert) + '</span>'; }).join('') +
      '</div></div>';
    }

    checks.forEach(function (c) {
      var r = d[c.key] || { status: 'unclear', detail: 'No data returned' };
      var tone, icon;
      if (r.status === 'found') {
        tone = c.goodIfFound ? 'dd-check--good' : 'dd-check--bad';
        icon = c.goodIfFound ? '✅' : '⚠️';
      } else if (r.status === 'not_found') {
        tone = c.goodIfFound ? 'dd-check--neutral' : 'dd-check--good';
        icon = c.goodIfFound ? '➖' : '✅';
      } else {
        tone = 'dd-check--neutral';
        icon = '❔';
      }
      html += '<div class="dd-check-row ' + tone + '">' +
        '<span class="dd-check-icon">' + c.icon + '</span>' +
        '<div>' +
          '<strong>' + escapeHtml(c.label) + '</strong>' +
          '<span>' + escapeHtml(r.detail || '—') + '</span>' +
        '</div>' +
      '</div>';
    });

    // Deep-link strip at the bottom for manual verification
    html += '<div class="dd-section-title dd-section-title--spaced">Verify manually</div>';
    html += '<div class="dd-verify-links">';
    var encName = encodeURIComponent(name);
    var manualLinks = [
      { label: 'UKAS CertCheck', url: 'https://certcheck.ukas.com/?companyName=' + encName },
      { label: 'ONR search', url: 'https://www.onr.org.uk/search/?q=' + encName },
      { label: 'GS1 UK', url: 'https://www.gs1uk.org/services/verified-by-gs1/results?companyName=' + encName },
      { label: 'Companies House', url: 'https://find-and-update.company-information.service.gov.uk/' + (num ? 'company/' + encodeURIComponent(num) : 'search?q=' + encName) },
      { label: 'OpenCorporates', url: 'https://opencorporates.com/companies/' + (num ? 'gb/' + encodeURIComponent(num) : '?q=' + encName + '&jurisdiction_code=gb') },
      { label: 'Creditsafe', url: 'https://www.creditsafe.com/gb/en/find-company.html?searchValue=' + encName },
    ];
    html += manualLinks.map(function (l) {
      return '<a class="dd-verify-link" href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener">' + escapeHtml(l.label) + ' ↗</a>';
    }).join('');
    html += '</div>';

    html += '<p class="dd-source-note">Powered by Brave Search + Groq (' + escapeHtml(localStorage.getItem('frankieGroqModel') || 'llama-3.1-8b-instant') + '). Web results may not reflect current status — always verify certifications directly.</p>';
    html += '</div>';
    return html;
  }

  // ── Supabase save ────────────────────────────────────────────────────────────

  function saveDDReport() {
    var userId = localStorage.getItem('frankieUserId');
    var token  = localStorage.getItem('frankieUserToken');
    if (!userId || !token) return;
    if (!state.result) return;

    var btn = $id('ddSave');
    if (btn) { btn.textContent = '⏳ Saving…'; btn.disabled = true; }

    var p    = state.chData && state.chData.profile;
    var slug = (state.query || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var date = new Date().toISOString().slice(0, 10);
    var path = userId + '/supplier-intel/' + slug + '-' + date + '.json';

    var payload = {
      savedAt:       new Date().toISOString(),
      query:         state.query,
      companyNumber: state.companyNumber,
      rating:        state.result.rating,
      summary:       state.result.summary,
      chProfile: p ? {
        name:       p.company_name,
        status:     p.company_status,
        type:       p.type,
        incorporated: p.date_of_creation,
        sic:        p.sic_codes,
        insolvency: p.has_insolvency_history,
        overdue:    p.accounts && p.accounts.overdue
      } : null,
      sanctionsClean: state.sanctionsData && !(state.sanctionsData.hits || []).length
    };

    fetch(SUPA_URL + '/storage/v1/object/' + EV_BUCKET + '/' + path, {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'apikey':        SUPA_ANON,
        'Content-Type':  'application/json',
        'x-upsert':      'true'
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (btn) { btn.textContent = r.ok ? '✓ Saved' : '⚠ Failed'; btn.disabled = false; }
    }).catch(function () {
      if (btn) { btn.textContent = '⚠ Failed'; btn.disabled = false; }
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function formatAddress(a) {
    if (!a) return '—';
    return [a.address_line_1, a.address_line_2, a.locality, a.postal_code, a.country]
      .filter(Boolean).join(', ');
  }

  function friendlyType(type) {
    var map = {
      'ltd': 'Private Limited Company',
      'private-limited-company': 'Private Limited Company',
      'plc': 'Public Limited Company',
      'llp': 'Limited Liability Partnership',
      'limited-liability-partnership': 'Limited Liability Partnership',
      'private-unlimited': 'Private Unlimited Company',
      'old-public-company': 'Old Public Company',
    };
    return (type && (map[type.toLowerCase()] || type)) || '—';
  }

  function badge(status) {
    if (!status) return '—';
    var good = status === 'active';
    return '<span class="dd-status ' + (good ? 'dd-status--active' : 'dd-status--inactive') + '">' + escapeHtml(status) + '</span>';
  }

  function ratingClass(rating) {
    return rating === 'Low' ? 'dd-rating--low' : rating === 'High' ? 'dd-rating--high' : 'dd-rating--medium';
  }

  function factChip(label, value, tone) {
    var cls = 'dd-fact-chip' + (tone ? ' dd-fact-chip--' + tone : '');
    return '<div class="' + cls + '"><span class="dd-fact-label">' + escapeHtml(label) + '</span><span class="dd-fact-value">' + escapeHtml(value) + '</span></div>';
  }

  // Extract the first complete JSON object from a string (handles trailing text/notes from LLMs)
  function extractJSON(str) {
    var start = str.indexOf('{');
    if (start === -1) return '{}';
    var depth = 0;
    for (var i = start; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); }
    }
    return str.slice(start); // malformed but let JSON.parse handle it
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  document.addEventListener('click', function (e) {
    // Tab links
    var tabBtn = e.target.closest('.dd-tab-link');
    if (tabBtn && tabBtn.dataset.tab) {
      state.activeTab = tabBtn.dataset.tab;
      document.querySelectorAll('.dd-tab').forEach(function (b) {
        b.classList.toggle('dd-tab--active', b.dataset.tab === state.activeTab);
      });
      renderTabContent();
      return;
    }
  });

}());
