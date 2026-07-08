/**
 * iso19443-drawer.js  v4.0
 * Styled to match assessment-drawer.js. Handbook links open HandbookDrawer inline.
 */
(function () {
  'use strict';

  var DATA_FILE   = 'kb/iso19443_mapping.json';
  var HB_MAP_FILE = 'kb/handbook_url_map.json';
  var DRAWER_ID   = 'iso19443-drawer';

  var SUPA_URL  = 'https://qkyvmtouwrzrcyagkheo.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreXZtdG91d3J6cmN5YWdraGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODQzNjMsImV4cCI6MjA5MDk2MDM2M30.gKEgkVA-VjOnS_084W79kpzOdZhFQkhFp63MAe_FTd4';
  var EV_BUCKET = 'evidence-docs';

  var DATA    = null;
  var HB_MAP  = {};
  var loading = false;
  var state   = { phase: 'intro', sectionIdx: 0, answers: {} };

  // ── Public API ─────────────────────────────────────────────────────────────

  window.Iso19443Drawer = {
    open: function () {
      injectDrawer();
      if (!DATA) {
        loadData().then(function (d) {
          if (d) { DATA = d; render(); }
          else { document.getElementById('iso-body').innerHTML = '<div class="assess-loading">⚠ Could not load ISO 19443 data.</div>'; }
        });
      } else {
        if (Object.keys(state.answers).length === 0) {
          state = { phase: 'intro', sectionIdx: 0, answers: {} };
        }
        render();
      }
      var drawer = document.getElementById(DRAWER_ID);
      drawer.classList.remove('assess-drawer--closed');
      drawer.classList.add('assess-drawer--open');
    }
  };

  // ── DOM helpers ────────────────────────────────────────────────────────────

  function $id(id) { return document.getElementById(id); }

  // ── Drawer injection ───────────────────────────────────────────────────────

  function injectDrawer() {
    if ($id(DRAWER_ID)) return;
    var el = document.createElement('div');
    el.id        = DRAWER_ID;
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML =
      '<div class="assess-backdrop" id="isoBackdrop"></div>' +
      '<div class="assess-panel">' +
        '<div class="assess-topbar">' +
          '<span class="assess-icon">☢</span>' +
          '<div class="assess-title" id="isoTitle">ISO 19443 Position</div>' +
          '<button class="assess-close" id="isoClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="assess-section-bar" id="isoSectionBar" style="display:none;"></div>' +
        '<div class="assess-body" id="iso-body">' +
          '<div class="assess-loading">Loading…</div>' +
        '</div>' +
        '<div class="assess-footer" id="iso-footer" style="display:none;">' +
          '<button class="assess-nav" id="isoPrev" type="button">← Back</button>' +
          '<span class="assess-footer-score" id="isoScore"></span>' +
          '<button class="assess-nav assess-nav--primary" id="isoNext" type="button">Next →</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    $id('isoClose').addEventListener('click', close);
    $id('isoBackdrop').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    $id('isoPrev').addEventListener('click', function () { navigate(-1); });
    $id('isoNext').addEventListener('click', function () { navigate(1); });
  }

  function close() {
    var d = $id(DRAWER_ID);
    if (!d) return;
    d.classList.remove('assess-drawer--open');
    d.classList.add('assess-drawer--closed');
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  function loadData() {
    if (loading) return Promise.resolve(null);
    loading = true;
    return Promise.all([
      fetch(DATA_FILE).then(function (r) { return r.json(); }),
      fetch(HB_MAP_FILE).then(function (r) { return r.json(); }).catch(function () { return {}; })
    ]).then(function (res) {
      HB_MAP  = res[1] || {};
      loading = false;
      return res[0];
    }).catch(function (e) {
      loading = false;
      console.error('[Iso19443Drawer]', e);
      return null;
    });
  }

  // ── Handbook helper ────────────────────────────────────────────────────────

  function openHandbook(url, topic) {
    if (!url && !topic) return;
    if (url) {
      var slug = url.replace(/\/$/, '').split('/').pop();
      var chId = HB_MAP[slug];
      if (chId && window.HandbookDrawer) {
        close();
        window.HandbookDrawer.open(chId);
        return;
      }
    }
    // Fallback: pre-fill Frankie with handbook-oriented question
    var prompt = topic
      ? 'What guidance is in the NucCol handbook for "' + topic + '"?'
      : 'What does the NucCol handbook say about this topic?';
    triggerFrankie(prompt);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function sectionKeys()   { return DATA ? Object.keys(DATA.sections) : []; }
  function totalSections() { return sectionKeys().length; }

  function navigate(dir) {
    if (state.phase === 'results') return;
    if (dir === -1 && state.phase === 'questions') {
      if (state.sectionIdx === 0) { state.phase = 'intro'; render(); }
      else { state.sectionIdx--; renderSection(); }
      $id('iso-body').scrollTop = 0;
      return;
    }
    if (dir === 1 && state.phase === 'questions') {
      if (state.sectionIdx === totalSections() - 1) { state.phase = 'results'; render(); }
      else { state.sectionIdx++; renderSection(); }
      $id('iso-body').scrollTop = 0;
    }
  }

  function render() {
    if (!DATA) return;
    if      (state.phase === 'intro')     renderIntro();
    else if (state.phase === 'questions') { renderSectionBar(); renderSection(); }
    else if (state.phase === 'results')   renderResults();
  }

  // ── Section bar ────────────────────────────────────────────────────────────

  var SHORT_NAMES = {
    'BE — Strategy & Leadership':       'Strategy',
    'BE — Design & Project Management': 'Design',
    'BE — People & Competence':         'People',
    'BE — Process & Operations':        'Process',
    'BE — QHSE':                        'QHSE',
    'BE — Supply Chain':                'Supply Chain',
    'NSS — Nuclear Industry Fundamentals': 'Fundamentals',
    'NSS — Nuclear Safety Culture':     'Safety',
    'NSS — Leadership & Governance':    'Governance',
    'NSS — Quality & Compliance':       'Quality',
    'NSS — Supply Chain Readiness':     'Supply Chain',
    'NSS — Human Performance':          'Human Perf.',
    'NSS — Security of Information':    'Security',
    'Additional Questions':             'Additional'
  };

  function secAnsweredCount(idx) {
    var qs = DATA.sections[sectionKeys()[idx]].questions;
    return qs.filter(function (q) { return state.answers[q.id] !== undefined; }).length;
  }
  function secTotal(idx) { return DATA.sections[sectionKeys()[idx]].questions.length; }

  function renderSectionBar() {
    var bar = $id('isoSectionBar');
    if (!bar) return;
    bar.style.display = '';
    var keys = sectionKeys();
    bar.innerHTML = keys.map(function (k, i) {
      var answered = secAnsweredCount(i);
      var total    = secTotal(i);
      var pctStr   = answered ? Math.round(answered / total * 100) + '%' : '';
      var active   = (state.phase === 'questions' && i === state.sectionIdx);
      return '<button class="assess-sec-pill' + (active ? ' assess-sec-pill--active' : '') + '" data-idx="' + i + '" type="button" title="' + esc(k) + '">' +
        '<span>' + esc(SHORT_NAMES[k] || k.split(' ').slice(0, 2).join(' ')) + '</span>' +
        (pctStr ? '<span class="assess-sec-pct" style="color:#4caf7d">' + pctStr + '</span>' : '') +
      '</button>';
    }).join('');
    bar.querySelectorAll('.assess-sec-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.sectionIdx = parseInt(btn.dataset.idx);
        state.phase = 'questions';
        renderSectionBar();
        renderSection();
        $id('iso-body').scrollTop = 0;
      });
    });
  }

  // ── Intro ──────────────────────────────────────────────────────────────────

  function renderIntro() {
    $id('isoTitle').textContent = 'ISO 19443 Position';
    $id('isoSectionBar').style.display = 'none';
    $id('iso-footer').style.display = 'none';

    var b = $id('iso-body');
    b.innerHTML =
      '<div class="assess-section-intro" style="border-bottom:none;padding-bottom:0;">' +
        '<div style="text-align:center;margin-bottom:16px;">' +
          '<div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:linear-gradient(135deg,#1a2b3c,#29b6e8);border-radius:12px;font-size:1.4rem;margin-bottom:8px;">☢</div>' +
          '<h3 class="assess-section-name" style="text-align:center;">ISO 19443 Position</h3>' +
          '<p class="assess-section-count" style="text-align:center;">Map your F4N scores against the nuclear quality standard</p>' +
        '</div>' +
        '<div style="background:#1a2b3c;border-radius:9px;padding:14px 16px;margin-bottom:14px;">' +
          '<p style="margin:0 0 10px;font-size:.83rem;line-height:1.5;color:#b8d0e8;">ISO 19443 extends ISO 9001 for the nuclear supply chain — and your existing F4N scores are the baseline. This tool maps them against the standard so you can see exactly where you stand and what to prioritise.</p>' +
          '<div style="display:flex;flex-direction:column;gap:7px;">' +
            '<div style="display:flex;gap:8px;align-items:flex-start;">' +
              '<span style="color:#29b6e8;font-weight:800;flex-shrink:0;font-size:.82rem;">1.</span>' +
              '<span style="font-size:.8rem;color:#a0bdd4;line-height:1.4;"><strong style="color:#fff;">Use your actual F4N scores</strong> — select the option that matches your current BE or Fit for Nuclear score for each question.</span>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:flex-start;">' +
              '<span style="color:#29b6e8;font-weight:800;flex-shrink:0;font-size:.82rem;">2.</span>' +
              '<span style="font-size:.8rem;color:#a0bdd4;line-height:1.4;"><strong style="color:#fff;">Additional questions at the end</strong> cover ISO 19443 clauses not in the F4N set — answer these honestly based on your actual practice.</span>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:flex-start;">' +
              '<span style="color:#29b6e8;font-weight:800;flex-shrink:0;font-size:.82rem;">3.</span>' +
              '<span style="font-size:.8rem;color:#a0bdd4;line-height:1.4;"><strong style="color:#fff;">Your results</strong> show a RAG position, clause-by-clause breakdown, and handbook links that open right here in Frankie.</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="background:#fff8e6;border:1px solid #f0d080;border-radius:7px;padding:8px 12px;margin-bottom:16px;font-size:.76rem;color:#7a5a00;line-height:1.4;">' +
          '⚠ <strong>Guidance only</strong> — this is NucCol\'s view based on your scores, not a formal certification assessment.' +
        '</div>' +
        '<button id="isoBeginBtn" type="button" style="width:100%;padding:12px;background:#29b6e8;color:#fff;border:none;border-radius:8px;font-size:.9rem;font-weight:700;cursor:pointer;">Begin assessment →</button>' +
      '</div>';

    $id('isoBeginBtn').addEventListener('click', function () {
      state.phase = 'questions'; state.sectionIdx = 0;
      renderSectionBar(); renderSection();
      $id('iso-body').scrollTop = 0;
    });
  }

  // ── Section rendering ──────────────────────────────────────────────────────

  function renderSection() {
    var keys    = sectionKeys();
    var secKey  = keys[state.sectionIdx];
    var section = DATA.sections[secKey];
    var isLast  = state.sectionIdx === totalSections() - 1;

    $id('isoTitle').textContent = 'ISO 19443 — ' + section.label;
    $id('iso-footer').style.display = 'flex';

    var prev = $id('isoPrev');
    var next = $id('isoNext');
    prev.style.visibility = 'visible';
    next.textContent = isLast ? 'See results →' : 'Next →';

    var answered = secAnsweredCount(state.sectionIdx);
    var total    = secTotal(state.sectionIdx);
    $id('isoScore').textContent = answered + '/' + total + ' answered';

    var srcCol = { BE:'#0c779c', NSS:'#9c0c2a', GAP:'#1a7a3c' }[section.source] || '#555';
    var srcBg  = { BE:'#e3f4fd', NSS:'#fde3e8', GAP:'#e3fde8' }[section.source] || '#eee';

    var html =
      '<div class="assess-section-intro">' +
        '<h3 class="assess-section-name">' + esc(section.label) + ' <span style="font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:7px;background:' + srcBg + ';color:' + srcCol + ';vertical-align:middle;letter-spacing:.04em;">' + section.source + '</span></h3>' +
        '<p class="assess-section-count">' + section.questions.length + ' questions · select the option that best describes your organisation</p>' +
        (section.note ? '<p style="font-size:.77rem;color:#65758a;margin:4px 0 0;line-height:1.4;">' + esc(section.note) + '</p>' : '') +
      '</div>';

    section.questions.forEach(function (q) {
      var ans    = state.answers[q.id];
      var hasAns = ans !== undefined;
      var clauseHtml = (q.maps_to || []).map(function (c) {
        return '<span style="font-size:.65rem;background:#eef0f5;color:#5a6a7a;border-radius:5px;padding:1px 5px;font-weight:600;margin-right:3px;">' + esc(c) + '</span>';
      }).join('');

      html += '<div class="assess-question">' +
        '<div class="assess-q-text">' + esc(q.statement) + '</div>' +
        (clauseHtml ? '<div class="assess-q-topic">' + clauseHtml + '</div>' : '') +
        '<div class="assess-options">';

      q.options.forEach(function (opt) {
        var sel = hasAns && ans.score === opt.score;
        html += '<button class="assess-option' + (sel ? ' assess-option--selected' : '') + '" data-qid="' + esc(q.id) + '" data-score="' + opt.score + '" type="button">' +
          '<span class="assess-opt-score">' + opt.score + '</span>' +
          '<span class="assess-opt-desc">' + esc(opt.desc) + '</span>' +
        '</button>';
      });

      html += '</div>'; // assess-options

      if (hasAns) {
        var col = ans.score >= 7 ? '#4caf7d' : ans.score >= 4 ? '#e09a3a' : '#e05252';
        html += '<div class="assess-feedback" style="border-left-color:' + col + '">' +
          esc(ans.feedback) +
        '</div>';
      }

      html += '</div>'; // assess-question
    });

    var b = $id('iso-body');
    b.innerHTML = html;

    // Option click — store answer, re-render section
    b.querySelectorAll('.assess-option').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var qid   = btn.dataset.qid;
        var score = parseInt(btn.dataset.score);
        var sec   = DATA.sections[secKey];
        var q     = sec.questions.find(function (x) { return x.id === qid; });
        if (!q) return;
        var opt = q.options.find(function (o) { return o.score === score; });
        if (!opt) return;
        state.answers[qid] = {
          score: score, feedback: opt.feedback, topic: q.topic,
          maps_to: q.maps_to, statement: q.statement,
          handbookUrl: q.handbookUrl || ''
        };
        renderSection();
        renderSectionBar();
        $id('isoScore').textContent = secAnsweredCount(state.sectionIdx) + '/' + secTotal(state.sectionIdx) + ' answered';
      });
    });

  }

  // ── Results ────────────────────────────────────────────────────────────────

  function renderResults() {
    $id('isoTitle').textContent = 'ISO 19443 — Results';
    $id('isoSectionBar').style.display = 'none';
    $id('iso-footer').style.display = 'none';

    // ── Build a flat question lookup by ID ─────────────────────────────────
    var allQ = {};
    Object.keys(DATA.sections).forEach(function (sk) {
      DATA.sections[sk].questions.forEach(function (q) { allQ[q.id] = q; });
    });

    var ids    = Object.keys(state.answers);
    var scores = ids.map(function (id) { return state.answers[id].score; });
    var total  = scores.length;
    var avg    = total ? scores.reduce(function (a, x) { return a + x; }, 0) / total : 0;
    var pct    = Math.round((avg / 10) * 100);
    var low    = scores.filter(function (s) { return s <= 2; }).length;
    var high   = scores.filter(function (s) { return s === 10; }).length;

    var ragCol, ragLbl, ragTxt;
    if      (low > total * 0.5)  { ragCol='#e05252'; ragLbl='RED';   ragTxt='Significant gaps — foundational QMS work needed before pursuing certification.'; }
    else if (high > total * 0.5) { ragCol='#4caf7d'; ragLbl='GREEN'; ragTxt='Strong position — well-placed to pursue ISO 19443 with targeted preparation.'; }
    else                         { ragCol='#e09a3a'; ragLbl='AMBER'; ragTxt='Developing — some areas solid, others need work before certification.'; }

    saveIsoScores(pct, ragLbl);

    // Dial SVG
    var cx=110, cy=100, r=78;
    var nr=(180+(pct/100)*180)*Math.PI/180;
    var nx=cx+(r-16)*Math.cos(nr), ny=cy+(r-16)*Math.sin(nr);
    function arc(s,e,c){ var sr=s*Math.PI/180,er=e*Math.PI/180; return '<path d="M'+(cx+r*Math.cos(sr))+' '+(cy+r*Math.sin(sr))+' A '+r+' '+r+' 0 0 1 '+(cx+r*Math.cos(er))+' '+(cy+r*Math.sin(er))+'" stroke="'+c+'" stroke-width="18" fill="none" stroke-linecap="round"/>'; }
    var dialSvg = '<svg viewBox="0 0 220 115" xmlns="http://www.w3.org/2000/svg" style="width:180px;height:auto;display:block;margin:0 auto 8px;">' +
      '<path d="M'+(cx-r)+' '+cy+' A '+r+' '+r+' 0 0 1 '+(cx+r)+' '+cy+'" stroke="#e0e6ed" stroke-width="18" fill="none" stroke-linecap="round"/>' +
      arc(180,240,'#e05252')+arc(240,300,'#e09a3a')+arc(300,360,'#4caf7d') +
      '<line x1="'+cx+'" y1="'+cy+'" x2="'+nx+'" y2="'+ny+'" stroke="#1a2b3c" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="'+cx+'" cy="'+cy+'" r="5" fill="#1a2b3c"/>' +
      '<text x="'+(cx-r-4)+'" y="'+(cy+20)+'" text-anchor="middle" font-size="8" fill="#e05252" font-family="sans-serif" font-weight="700">Red</text>' +
      '<text x="'+cx+'" y="'+(cy+20)+'" text-anchor="middle" font-size="8" fill="#e09a3a" font-family="sans-serif" font-weight="700">Amber</text>' +
      '<text x="'+(cx+r+4)+'" y="'+(cy+20)+'" text-anchor="middle" font-size="8" fill="#4caf7d" font-family="sans-serif" font-weight="700">Green</text>' +
    '</svg>';

    var html =
      '<div class="assess-results">' +
        '<div class="assess-results-hero">' +
          '<div class="assess-results-ring" style="--col:' + ragCol + '">' +
            '<span class="assess-ring-pct">' + pct + '%</span>' +
            '<span class="assess-ring-lbl">' + ragLbl + '</span>' +
          '</div>' +
          '<div class="assess-results-summary">' +
            dialSvg +
            '<div class="assess-results-sub" style="color:#444;text-align:center;line-height:1.4;">' + ragTxt + '</div>' +
          '</div>' +
        '</div>';

    // ── SECTION 1: Areas covered by F4N scoring ────────────────────────────
    html += '<h4 class="assess-results-section-hd">Areas covered by F4N scoring</h4>' +
      '<p style="font-size:.74rem;color:#65758a;margin:0 0 10px;line-height:1.4;">These ISO 19443 clauses are addressed by your BE and Fit for Nuclear scores. ⚛ = nuclear-specific beyond ISO 9001.</p>';

    Object.keys(DATA.clauses).forEach(function (cid) {
      var cDef   = DATA.clauses[cid];
      var f4nIds = (cDef.question_ids||[]).filter(function (qid) { return !qid.startsWith('gap') && state.answers[qid]; });
      if (!f4nIds.length) return; // skip clauses with no answered F4N questions

      var cScores = f4nIds.map(function (qid) { return state.answers[qid].score; });
      var cAvg    = cScores.reduce(function (a, x) { return a + x; }, 0) / cScores.length;
      var col     = cAvg >= 7 ? '#4caf7d' : cAvg >= 4 ? '#e09a3a' : '#e05252';
      var bg      = cAvg >= 7 ? '#f0fdf4' : cAvg >= 4 ? '#fefce8' : '#fef2f2';

      var qRows = f4nIds.map(function (qid) {
        var a  = state.answers[qid];
        var sc = a.score;
        var qc = sc >= 7 ? '#4caf7d' : sc >= 4 ? '#e09a3a' : '#e05252';
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f0f3f7;">' +
          '<span style="font-size:.75rem;color:#2a3c4d;">' + esc(a.topic) + '</span>' +
          '<span style="background:'+qc+';color:#fff;font-size:.68rem;font-weight:800;padding:1px 6px;border-radius:5px;flex-shrink:0;">' + sc + '</span>' +
        '</div>';
      }).join('');

      html += '<div style="border:1px solid '+col+'44;border-radius:7px;margin-bottom:5px;overflow:hidden;">' +
        '<div class="iso-cl-hdr" style="display:flex;align-items:center;gap:7px;background:'+bg+';padding:8px 11px;cursor:pointer;user-select:none;">' +
          '<span style="font-weight:900;font-size:.79rem;color:'+col+';min-width:48px;">'+esc(cid)+(cDef.nuclear?' ⚛':'')+'</span>' +
          '<span style="flex:1;font-size:.77rem;font-weight:600;color:#2a3c4d;">'+esc(cDef.name)+'</span>' +
          '<span style="font-weight:800;font-size:.8rem;color:'+col+';">'+cAvg.toFixed(1)+'</span>' +
          '<span class="iso-chev" style="font-size:.7rem;color:#94a3b8;margin-left:3px;transition:transform .2s;">▾</span>' +
        '</div>' +
        '<div class="iso-cl-det" style="display:none;padding:6px 11px 8px;">'+qRows+'</div>' +
      '</div>';
    });

    // ── SECTION 2: Gaps ────────────────────────────────────────────────────
    html += '<h4 class="assess-results-section-hd" style="margin-top:18px;">Gaps</h4>' +
      '<p style="font-size:.74rem;color:#65758a;margin:0 0 10px;line-height:1.4;">Clauses where scores indicate risk, or where additional evidence is needed beyond F4N.</p>';

    var anyGap = false;
    Object.keys(DATA.clauses).forEach(function (cid) {
      var cDef    = DATA.clauses[cid];
      var allIds  = cDef.question_ids || [];
      var f4nIds  = allIds.filter(function (qid) { return !qid.startsWith('gap'); });
      var gapIds  = allIds.filter(function (qid) { return qid.startsWith('gap'); });

      var answeredF4n = f4nIds.filter(function (qid) { return state.answers[qid]; });
      var f4nScores   = answeredF4n.map(function (qid) { return state.answers[qid].score; });
      var f4nAvg      = f4nScores.length ? f4nScores.reduce(function (a, x) { return a + x; }, 0) / f4nScores.length : null;

      var answeredGap = gapIds.filter(function (qid) { return state.answers[qid]; });
      var gapLowScore = answeredGap.some(function (qid) { return state.answers[qid].score <= 2; });

      // Show as a gap if: F4N avg < 7, or has gap questions with low score, or no F4N coverage at all
      var isGap = (f4nAvg !== null && f4nAvg < 7) || gapLowScore || (f4nIds.length === 0 && gapIds.length > 0);
      if (!isGap) return;

      anyGap = true;

      var col = (f4nAvg !== null && f4nAvg <= 2) ? '#e05252' : '#e09a3a';

      // Find the best handbook URL for this clause from its questions
      var hbUrl   = '';
      var hbTopic = cDef.name;
      allIds.forEach(function (qid) {
        if (!hbUrl && allQ[qid] && allQ[qid].handbookUrl) { hbUrl = allQ[qid].handbookUrl; hbTopic = allQ[qid].topic; }
      });

      // Check if the URL actually maps to a known chapter
      var slug   = hbUrl ? hbUrl.replace(/\/$/, '').split('/').pop() : '';
      var chId   = slug && HB_MAP ? HB_MAP[slug] : null;
      var hasHb  = !!(chId && window.HandbookDrawer); // will be evaluated at click time

      var hbBtn = hbUrl
        ? '<button class="assess-hb-link iso-hb-btn" data-url="' + escAttr(hbUrl) + '" data-topic="' + escAttr(hbTopic) + '" type="button">📖 View in handbook →</button>'
        : '<span style="font-size:.74rem;color:#94a3b8;font-style:italic;">Whoops, even we have gaps here — <button class="assess-hb-link iso-hb-btn" data-url="" data-topic="' + escAttr(cDef.name) + '" type="button" style="color:#29b6e8;background:none;border:none;padding:0;cursor:pointer;font-size:.74rem;">ask Frankie →</button></span>';

      // Show gap questions if answered
      var gapRows = answeredGap.map(function (qid) {
        var a  = state.answers[qid];
        var sc = a.score;
        var qc = sc >= 7 ? '#4caf7d' : sc >= 4 ? '#e09a3a' : '#e05252';
        return '<div style="display:flex;align-items:flex-start;gap:6px;padding:3px 0;border-bottom:1px solid #f0f3f7;">' +
          '<span style="font-size:.73rem;color:#555;flex:1;line-height:1.35;">' + esc(a.feedback) + '</span>' +
          '<span style="background:'+qc+';color:#fff;font-size:.68rem;font-weight:800;padding:1px 6px;border-radius:5px;flex-shrink:0;">' + sc + '</span>' +
        '</div>';
      }).join('');

      html += '<div class="assess-priority-card" style="border-left-color:' + col + ';margin-bottom:7px;">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
          '<span style="font-size:.68rem;font-weight:800;color:'+col+';background:'+col+'1a;padding:1px 6px;border-radius:4px;">'+esc(cid)+(cDef.nuclear?' ⚛':'')+'</span>' +
          '<span class="assess-priority-name" style="font-weight:700;font-size:.82rem;color:#1a2b3c;">'+esc(cDef.name)+'</span>' +
        '</div>' +
        (cDef.note ? '<div class="assess-priority-score" style="margin-bottom:6px;">'+esc(cDef.note)+'</div>' : '') +
        (gapRows ? '<div style="margin-bottom:6px;">'+gapRows+'</div>' : '') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
          hbBtn +
          '<button class="assess-hb-link iso-hb-btn" data-url="" data-topic="' + escAttr(cDef.name) + '" style="color:#29b6e8;" type="button">💬 Ask Frankie →</button>' +
        '</div>' +
      '</div>';
    });

    if (!anyGap) {
      html += '<div style="text-align:center;padding:16px;color:#4caf7d;font-size:.84rem;font-weight:600;">No significant gaps identified — strong position overall! ✓</div>';
    }

    html += '<div style="display:flex;gap:8px;margin:16px 0 6px;">' +
      '<button id="isoRetake" type="button" class="assess-restart-btn" style="flex:1;">← Start over</button>' +
      '<button id="isoAskFrankie" type="button" style="flex:1;padding:10px;border-radius:8px;border:none;background:#29b6e8;color:#fff;font-size:.83rem;font-weight:700;cursor:pointer;">Ask Frankie →</button>' +
    '</div>' +
    '</div>'; // assess-results

    var b = $id('iso-body');
    b.innerHTML = html;
    b.scrollTop = 0;

    // Clause expand/collapse (coverage section)
    b.querySelectorAll('.iso-cl-hdr').forEach(function (hdr) {
      var det  = hdr.nextElementSibling;
      var chev = hdr.querySelector('.iso-chev');
      hdr.addEventListener('click', function () {
        var open = det.style.display !== 'none';
        det.style.display    = open ? 'none' : 'block';
        chev.style.transform = open ? '' : 'rotate(180deg)';
      });
    });

    // Handbook / Frankie buttons
    b.querySelectorAll('.iso-hb-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openHandbook(btn.dataset.url, btn.dataset.topic);
      });
    });

    $id('isoRetake').addEventListener('click', function () {
      state = { phase: 'intro', sectionIdx: 0, answers: {} };
      render();
    });

    $id('isoAskFrankie').addEventListener('click', function () {
      var gaps = Object.keys(state.answers)
        .filter(function (id) { return state.answers[id].score <= 2; }).slice(0, 3)
        .map(function (id) { return state.answers[id].topic; }).join(', ');
           triggerFrankie(gaps
        ? 'My ISO 19443 main gaps are: ' + gaps + '. What should I prioritise to improve?'
        : 'I just completed my ISO 19443 Position assessment. What should I do next?');
    });
  }

  // ── Supabase save ──────────────────────────────────────────────────────────

  function saveIsoScores(pct, ragLbl) {
    var userId  = localStorage.getItem('frankieUserId');
    var token   = localStorage.getItem('frankieUserToken');
    if (!userId || !token) return;
    var payload = {
      userId:      userId,
      company:     localStorage.getItem('frankieCompanyName') || '',
      submittedAt: new Date().toISOString(),
      pct:         pct,
      rag:         ragLbl,
      answers:     state.answers
    };
    fetch(SUPA_URL + '/storage/v1/object/' + EV_BUCKET + '/' + userId + '/_iso19443.json', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'apikey':        SUPA_ANON,
        'Content-Type':  'application/json',
        'x-upsert':      'true'
      },
      body: JSON.stringify(payload)
    }).catch(function () {});
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function esc(s)     { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escAttr(s) { return (s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function triggerFrankie(prompt) {
    var el = document.getElementById('input') || document.querySelector('textarea');
    if (el) { el.value = prompt; el.dispatchEvent(new Event('input',{bubbles:true})); close(); el.focus(); }
  }

})();
