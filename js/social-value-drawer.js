/**
 * social-value-drawer.js  v3.0
 * Social Value Finder — real charity data from CharityBase GraphQL API.
 * Flow: postcode → postcodes.io (geocode + area name) → CharityBase GraphQL search.
 * API key stored in localStorage as 'charityBaseKey'.
 * Styled to match assessment-drawer.js (assess-* CSS classes throughout).
 */
(function () {
  'use strict';

  var DRAWER_ID   = 'social-value-drawer';
  var PC_ENDPOINT = 'https://api.postcodes.io/postcodes/';

  var CATEGORIES = [
    { id: 'education',   label: '🎓 Education & Skills',      keywords: 'education training skills apprenticeship' },
    { id: 'community',   label: '👥 Community & Wellbeing',    keywords: 'community wellbeing mental health social' },
    { id: 'environment', label: '🌱 Environment',              keywords: 'environment conservation nature wildlife' },
    { id: 'youth',       label: '⚽ Youth & Sport',            keywords: 'youth young people sport recreation' },
    { id: 'inclusion',   label: '♿ Disability & Inclusion',   keywords: 'disability inclusion accessibility' },
    { id: 'arts',        label: '🎨 Arts & Culture',           keywords: 'arts culture heritage museum' },
    { id: 'poverty',     label: '🏠 Poverty & Homelessness',   keywords: 'poverty homeless food bank relief' },
  ];

  var state = {
    phase: 'search',   // 'setup' | 'search' | 'loading' | 'results'
    postcode: '',
    radius: 10,
    selectedCategories: [],
    results: [],
    areaName: '',
    error: null,
  };

  // ── Public API ──────────────────────────────────────────────────────────────

  window.SocialValueDrawer = {
    open: function () {
      injectDrawer();
      state.phase = 'search';
      renderPhase();
      var drawer = document.getElementById(DRAWER_ID);
      drawer.classList.remove('assess-drawer--closed');
      drawer.classList.add('assess-drawer--open');
    }
  };

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function $id(id) { return document.getElementById(id); }
  function setBody(html) { var el = $id('sv-body'); if (el) el.innerHTML = html; }

  // ── Drawer injection ────────────────────────────────────────────────────────

  function injectDrawer() {
    if ($id(DRAWER_ID)) return;
    var el = document.createElement('div');
    el.id        = DRAWER_ID;
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML =
      '<div class="assess-backdrop" id="svBackdrop"></div>' +
      '<div class="assess-panel">' +
        '<div class="assess-topbar">' +
          '<span class="assess-icon">🤝</span>' +
          '<div class="assess-title">Social Value Finder</div>' +
          '<button class="assess-close" id="svClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="assess-body" id="sv-body"></div>' +
        '<div class="assess-footer sv-hidden" id="sv-footer">' +
          '<button class="assess-nav" id="svBack" type="button">← New Search</button>' +
          '<span class="assess-footer-score" id="sv-count"></span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    $id('svClose').addEventListener('click', closeDrawer);
    $id('svBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
    $id('svBack').addEventListener('click', function () {
      state.phase = 'search';
      state.results = [];
      state.error = null;
      renderPhase();
    });
  }

  function closeDrawer() {
    var d = $id(DRAWER_ID);
    if (!d) return;
    d.classList.remove('assess-drawer--open');
    d.classList.add('assess-drawer--closed');
  }

  // ── Render router ───────────────────────────────────────────────────────────

  function renderPhase() {
    var footer = $id('sv-footer');
    var showFooter = state.phase === 'results';
    if (footer) footer.classList.toggle('sv-hidden', !showFooter);
    if      (state.phase === 'search')  renderSearch();
    else if (state.phase === 'loading') renderLoading();
    else if (state.phase === 'results') renderResults();
  }

  // ── Screen 1: Search form ───────────────────────────────────────────────────

  function renderSearch() {
    var catPills = CATEGORIES.map(function (c) {
      var active = state.selectedCategories.indexOf(c.id) > -1;
      return '<button type="button" class="sv-cat-pill' + (active ? ' sv-cat-pill--active' : '') + '" data-cat="' + c.id + '">' + c.label + '</button>';
    }).join('');

    setBody(
      '<div class="sv-intro">' +
        '<p class="sv-intro-text">' +
          'Find real local charities and community organisations near your site that you could support, sponsor, or partner with to evidence social value.' +
        '</p>' +
      '</div>' +
      '<div class="sv-form">' +
        '<label class="sv-label" for="sv-postcode">Your site postcode</label>' +
        '<input class="sv-input" id="sv-postcode" type="text" placeholder="e.g. S7 1HE" value="' + escapeHtml(state.postcode) + '" maxlength="8" autocomplete="postal-code" />' +

        '<label class="sv-label">Focus areas <span class="sv-label-hint">(optional — all shown if none selected)</span></label>' +
        '<div class="sv-cat-grid">' + catPills + '</div>' +

        '<button class="assess-nav assess-nav--primary sv-search-btn" id="svSearchBtn" type="button">🔍 Find Organisations</button>' +
        (state.error ? '<div class="sv-error">' + escapeHtml(state.error) + '</div>' : '') +
      '</div>'
    );

    document.querySelectorAll('.sv-cat-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var cat = pill.dataset.cat;
        var idx = state.selectedCategories.indexOf(cat);
        if (idx > -1) { state.selectedCategories.splice(idx, 1); pill.classList.remove('sv-cat-pill--active'); }
        else           { state.selectedCategories.push(cat);      pill.classList.add('sv-cat-pill--active'); }
      });
    });

    $id('svSearchBtn').addEventListener('click', startSearch);
    $id('sv-postcode').addEventListener('keydown', function (e) { if (e.key === 'Enter') startSearch(); });
    setTimeout(function () { var el = $id('sv-postcode'); if (el) el.focus(); }, 100);
  }

  function startSearch() {
    var raw = ($id('sv-postcode').value || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!raw) { state.error = 'Please enter a postcode.'; renderSearch(); return; }
    var claudeKey = localStorage.getItem('frankieClaudeKey') || '';
    if (!claudeKey) { state.error = 'No Claude API key found. Please add your key in Frankie settings.'; renderSearch(); return; }
    state.postcode = raw;
    state.error = null;
    state.phase = 'loading';
    renderPhase();
    doSearch(raw, state.selectedCategories, claudeKey);
  }

  // ── Screen 2: Loading ───────────────────────────────────────────────────────

  function renderLoading() {
    setBody(
      '<div class="assess-loading">' +
        '<div class="sv-spinner"></div>' +
        '<p>Searching near ' + escapeHtml(formatPostcode(state.postcode)) + '…</p>' +
      '</div>'
    );
  }

  // ── Screen 3: Results ───────────────────────────────────────────────────────

  function renderResults() {
    var results = state.results;
    var countEl = $id('sv-count');

    if (!results.length) {
      if (countEl) countEl.textContent = '';
      setBody(
        '<div class="sv-no-results">' +
          '<p>😕 No charities found near <strong>' + escapeHtml(formatPostcode(state.postcode)) + '</strong>.</p>' +
          '<p>Try removing focus area filters or check your postcode.</p>' +
          (state.error ? '<p class="sv-error">' + escapeHtml(state.error) + '</p>' : '') +
        '</div>'
      );
      return;
    }

    if (countEl) countEl.textContent = results.length + ' found';

    var areaHtml = state.areaName
      ? '<div class="sv-area-banner">📍 <strong>' + escapeHtml(formatPostcode(state.postcode)) + '</strong> — ' + escapeHtml(state.areaName) + '</div>'
      : '';

    var cards = results.map(function (org) {
      return (
        '<div class="sv-card">' +
          '<div class="sv-card-header">' +
            '<span class="sv-card-name">' + escapeHtml(org.name) + '</span>' +
            '<span class="sv-card-cat">' + escapeHtml(org.category || '') + '</span>' +
          '</div>' +
          (org.description ? '<p class="sv-card-desc">' + escapeHtml(org.description) + '</p>' : '') +
          (org.howToEngage ? '<p class="sv-card-engage"><strong>How to engage:</strong> ' + escapeHtml(org.howToEngage) + '</p>' : '') +
          '<div class="sv-card-actions">' +
            '<a class="sv-org-link" href="' + escapeHtml(org.ccUrl) + '" target="_blank" rel="noopener">Charity Register ↗</a>' +
            '<button class="assess-nav assess-nav--primary sv-frankie-btn" data-prompt="' + escapeHtml(org.frankiePrompt) + '" type="button">Ask Frankie →</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    setBody(areaHtml + '<div class="sv-results-grid">' + cards + '</div>');

    document.querySelectorAll('.sv-frankie-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeDrawer();
        var prompt = btn.dataset.prompt;
        var input = document.getElementById('user-input') || document.querySelector('textarea');
        if (input) {
          input.value = prompt;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        }
      });
    });
  }

  // ── Search pipeline ─────────────────────────────────────────────────────────

  function doSearch(postcode, selectedCats, claudeKey) {
    fetch(PC_ENDPOINT + encodeURIComponent(postcode))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.result) throw new Error('Postcode "' + formatPostcode(postcode) + '" not found. Please check and try again.');
        var r = data.result;
        state.areaName = [r.admin_district, r.admin_county, r.region].filter(Boolean).join(', ');
        return askClaude(postcode, state.areaName, selectedCats, claudeKey);
      })
      .then(function (results) {
        state.results = results;
        state.phase = 'results';
        renderPhase();
      })
      .catch(function (err) {
        state.error = err.message || 'Something went wrong. Please try again.';
        state.results = [];
        state.phase = 'results';
        renderPhase();
      });
  }

  function askClaude(postcode, areaName, selectedCats, apiKey) {
    var catList = selectedCats.length
      ? selectedCats.map(function (id) {
          var c = CATEGORIES.filter(function (x) { return x.id === id; })[0];
          return c ? c.label.replace(/^[^ ]+ /, '') : '';
        }).filter(Boolean).join(', ')
      : 'education & skills, community & wellbeing, environment, youth & sport, disability & inclusion, arts & culture, poverty & homelessness';

    var prompt = [
      'A nuclear supply chain company is based near ' + formatPostcode(postcode) + ' (' + areaName + ').',
      'Suggest 20 local organisations this company could support, sponsor, or partner with to demonstrate social value.',
      'Include a wide variety: registered charities, community groups, grassroots sports clubs, amateur leagues, schools, food banks, hospices, volunteer groups, scout/guide groups, community gardens, arts groups, disability organisations, youth clubs — not just formal charities.',
      'Focus on these categories: ' + catList + '.',
      '',
      'Return a JSON array only — no markdown, no explanation. Each object must have exactly these fields:',
      '  name: string',
      '  category: string (one category label)',
      '  description: string (1 sentence on what they do)',
      '  howToEngage: string (1 sentence — practical way a manufacturer or engineer could help)',
      '',
      'Be specific to the area — use real or highly plausible local organisation names. Return only the JSON array.',
    ].join('\n');

    var model = localStorage.getItem('frankieClaudeModel') || 'claude-haiku-4-5-20251001';

    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || 'Claude API error ' + r.status); });
        return r.json();
      })
      .then(function (data) {
        var text = data.content && data.content[0] && data.content[0].text || '[]';
        var match = text.match(/\[[\s\S]*\]/);
        if (!match) throw new Error('Could not parse suggestions.');
        var orgs = JSON.parse(match[0]);
        // Enrich each result with links
        return orgs.map(function (org) {
          var ccSearch = 'https://register-of-charities.charitycommission.gov.uk/charity-search?q=' +
            encodeURIComponent(org.name);
          return {
            name:         org.name,
            category:     org.category,
            description:  org.description,
            howToEngage:  org.howToEngage,
            ccUrl:        ccSearch,
            frankiePrompt: 'How could a nuclear supply chain company based near ' + formatPostcode(postcode) +
              ' support or partner with "' + org.name + '" to demonstrate social value?',
          };
        });
      });
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  function formatPostcode(pc) {
    pc = pc.replace(/\s/g, '').toUpperCase();
    if (pc.length > 3) return pc.slice(0, pc.length - 3) + ' ' + pc.slice(-3);
    return pc;
  }
  function truncate(str, len) { return str.length > len ? str.slice(0, len).trimEnd() + '…' : str; }
  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Styles loaded via css/social-value.css

}());
