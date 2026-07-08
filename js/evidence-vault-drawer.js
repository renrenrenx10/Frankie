// ── Evidence Vault Drawer ────────────────────────────────────────────────────
// Lets companies upload evidence documents against each BE question.
// Files go to Supabase Storage: evidence-docs/{userId}/{section-slug}/filename
// Triggered via: window.EvidenceVault.open()

(function () {
  'use strict';

  const SUPABASE_URL  = 'https://qkyvmtouwrzrcyagkheo.supabase.co';
  const ANON_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreXZtdG91d3J6cmN5YWdraGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODQzNjMsImV4cCI6MjA5MDk2MDM2M30.gKEgkVA-VjOnS_084W79kpzOdZhFQkhFp63MAe_FTd4';
  const BUCKET        = 'evidence-docs';
  const DATA_FILE     = 'kb/be_evidence_map.json';

  let DATA        = null;
  let sectionIdx  = 0;
  let uploads     = {};   // { 'sec-slug/Q1': [{name, path}] }
  let loadingUploads = false;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getUser() {
    return {
      userId:  localStorage.getItem('frankieUserId'),
      token:   localStorage.getItem('frankieUserToken'),
      company: localStorage.getItem('frankieCompanyName') || 'Your Company',
    };
  }

  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function uploadKey(secName, qNum) {
    return slugify(secName) + '/Q' + qNum;
  }

  function authHeaders(token) {
    return {
      'Authorization': 'Bearer ' + (token || ANON_KEY),
      'apikey': ANON_KEY,
    };
  }

  // ── Supabase Storage ─────────────────────────────────────────────────────

  async function uploadFile(file, secName, qNum) {
    const { userId, token, company } = getUser();
    if (!userId || !token) throw new Error('Not authenticated');

    const safe = file.name.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
    const path = `${userId}/${slugify(secName)}/${safe}`;

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method:  'POST',
      headers: { ...authHeaders(token), 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
      body:    file,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Upload failed (${res.status})`);
    }

    // Write profile so SCC can identify this company
    await writeProfile(userId, token, company);

    return { name: file.name, path };
  }

  async function writeProfile(userId, token, company) {
    const profile = JSON.stringify({ userId, company, updated: new Date().toISOString() });
    const blob    = new Blob([profile], { type: 'application/json' });
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${userId}/_profile.json`, {
      method:  'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body:    blob,
    });
  }

  async function listFiles(secName) {
    const { userId, token } = getUser();
    if (!userId || !token) return [];

    const prefix = `${userId}/${slugify(secName)}/`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method:  'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ prefix, limit: 100, offset: 0 }),
    });

    if (!res.ok) return [];
    const items = await res.json();
    return (items || []).filter(f => f.name && !f.name.endsWith('/'));
  }

  async function deleteFile(path) {
    const { token } = getUser();
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method:  'DELETE',
      headers: authHeaders(token),
    });
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  function inject() {
    if (document.getElementById('ev-drawer')) return;
    const el = document.createElement('div');
    el.id = 'ev-drawer';
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML = `
      <div class="assess-backdrop" id="evBackdrop"></div>
      <div class="assess-panel ev-panel">
        <div class="assess-topbar">
          <span class="assess-icon">📁</span>
          <div class="assess-title">Assessment Evidence Vault</div>
          <button class="assess-close" id="evClose" aria-label="Close">✕</button>
        </div>

        <div id="evAuthWarn" class="ev-auth-warn" hidden>
          <p>⚠️ Please access Frankie through the <strong>NucCoL Members Portal</strong> to upload evidence documents.</p>
        </div>

        <div id="evMain" hidden>
          <div class="ev-company-bar" id="evCompanyBar"></div>
          <div class="assess-section-bar" id="evSectionBar"></div>
          <div class="ev-body" id="evBody">
            <div class="assess-loading">Loading evidence guide…</div>
          </div>
          <div class="ev-footer" id="evFooter">
            <button class="assess-nav" id="evPrev" type="button">← Back</button>
            <button class="ev-submit-btn" id="evSubmit" type="button">View Summary</button>
            <button class="assess-nav assess-nav--primary" id="evNext" type="button">Next →</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);

    document.getElementById('evClose').onclick    = close;
    document.getElementById('evBackdrop').onclick = close;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.getElementById('evPrev').onclick   = () => navigate(-1);
    document.getElementById('evNext').onclick   = () => navigate(1);
    document.getElementById('evSubmit').onclick = showSummary;
    document.getElementById('evSectionBar').addEventListener('click', e => {
      const btn = e.target.closest('.assess-sec-pill');
      if (btn) { sectionIdx = +btn.dataset.idx; renderSection(); }
    });
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  async function loadData() {
    if (DATA) return true;
    try {
      const r = await fetch(DATA_FILE);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      DATA = await r.json();
      return true;
    } catch (e) {
      document.getElementById('evBody').innerHTML =
        '<p class="ev-error">Could not load evidence guide. Please refresh and try again.</p>';
      return false;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function sections() {
    return DATA ? Object.keys(DATA) : [];
  }

  function renderSectionBar() {
    const bar = document.getElementById('evSectionBar');
    bar.innerHTML = sections().map((name, i) => {
      const count   = uploadCountForSection(name);
      const total   = DATA[name].length;
      const active  = i === sectionIdx;
      return `<button class="assess-sec-pill${active ? ' assess-sec-pill--active' : ''}" data-idx="${i}" type="button">
        <span>${name}</span>
        <span class="ev-sec-count${count === total ? ' ev-sec-count--done' : ''}">${count}/${total}</span>
      </button>`;
    }).join('');
  }

  function uploadCountForSection(secName) {
    return DATA[secName].filter(q => {
      const key = uploadKey(secName, q.q);
      return uploads[key] && uploads[key].length > 0;
    }).length;
  }

  function renderSection() {
    renderSectionBar();
    const secName = sections()[sectionIdx];
    const questions = DATA[secName];

    document.getElementById('evBody').innerHTML = `
      <div class="ev-section-title">${secName}</div>
      <div class="ev-questions">
        ${questions.map(q => renderQuestion(secName, q)).join('')}
      </div>`;

    // Bind upload inputs
    questions.forEach(q => {
      const key   = uploadKey(secName, q.q);
      const input = document.getElementById(`ev-input-${key}`);
      if (input) input.addEventListener('change', e => handleUpload(e, secName, q));
      const del = document.getElementById(`ev-del-${key}`);
      if (del) del.addEventListener('click', () => handleDelete(secName, q));
    });

    // Nav buttons
    const last = sections().length - 1;
    document.getElementById('evPrev').style.visibility = sectionIdx === 0 ? 'hidden' : 'visible';
    document.getElementById('evNext').textContent = sectionIdx === last ? 'Summary ✓' : 'Next →';
    if (sectionIdx === last) {
      document.getElementById('evNext').onclick = showSummary;
    } else {
      document.getElementById('evNext').onclick = () => navigate(1);
    }
  }

  function renderQuestion(secName, q) {
    const key     = uploadKey(secName, q.q);
    const files   = uploads[key] || [];
    const hasFile = files.length > 0;

    const examplesList = q.evidence_examples
      .map(e => `<li>${e}</li>`)
      .join('');

    const filesList = files.map((f, fi) => `
      <span class="ev-file-chip">
        <span class="ev-file-name">📄 ${f.name}</span>
        <button class="ev-file-del" data-key="${key}" data-fi="${fi}" type="button" title="Remove">✕</button>
      </span>`).join('');

    return `
      <div class="ev-question${hasFile ? ' ev-question--done' : ''}" id="ev-q-${key}">
        <div class="ev-q-header">
          <span class="ev-q-num">Q${q.q}</span>
          <span class="ev-q-topic">${q.topic}</span>
          ${hasFile ? '<span class="ev-tick">✓</span>' : ''}
        </div>
        <div class="ev-q-statement">${q.statement}</div>
        <div class="ev-evidence-block">
          <div class="ev-evidence-label">Evidence required <span class="ev-evidence-type">${q.evidence_type}</span></div>
          <ul class="ev-evidence-list">${examplesList}</ul>
        </div>
        <div class="ev-upload-row">
          ${filesList}
          <label class="ev-upload-btn" for="ev-input-${key}">
            ${hasFile ? '+ Add another' : '📎 Upload evidence'}
            <input id="ev-input-${key}" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" multiple hidden>
          </label>
        </div>
        <div class="ev-upload-status" id="ev-status-${key}"></div>
      </div>`;
  }

  // ── Upload / Delete ───────────────────────────────────────────────────────

  async function handleUpload(e, secName, q) {
    const files  = Array.from(e.target.files);
    if (!files.length) return;

    const key    = uploadKey(secName, q.q);
    const status = document.getElementById('ev-status-' + key);
    status.textContent = 'Uploading…';
    status.className   = 'ev-upload-status ev-upload-status--loading';

    const results = [];
    const errors  = [];

    for (const file of files) {
      try {
        const result = await uploadFile(file, secName, q.q);
        results.push(result);
      } catch (err) {
        errors.push(file.name + ': ' + err.message);
      }
    }

    if (!uploads[key]) uploads[key] = [];
    uploads[key].push(...results);

    if (errors.length) {
      status.textContent = 'Some files failed: ' + errors.join('; ');
      status.className   = 'ev-upload-status ev-upload-status--error';
    } else {
      status.textContent = '';
      status.className   = 'ev-upload-status';
    }

    // Re-render this question
    const qEl = document.getElementById('ev-q-' + key);
    if (qEl) {
      qEl.outerHTML = renderQuestion(secName, q);
      const newInput = document.getElementById('ev-input-' + key);
      if (newInput) newInput.addEventListener('change', ev => handleUpload(ev, secName, q));
    }

    // Bind delete buttons
    document.querySelectorAll('.ev-file-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const k  = btn.dataset.key;
        const fi = +btn.dataset.fi;
        handleDeleteByKey(k, fi, secName);
      });
    });

    renderSectionBar();
  }

  async function handleDeleteByKey(key, fi, secName) {
    const file = uploads[key] && uploads[key][fi];
    if (!file) return;
    try { await deleteFile(file.path); } catch (_) {}
    uploads[key].splice(fi, 1);

    // Find question and re-render
    const questions = DATA[secName];
    const parts     = key.split('/Q');
    const qNum      = +parts[1];
    const q         = questions.find(x => x.q === qNum);
    if (q) {
      const qEl = document.getElementById('ev-q-' + key);
      if (qEl) {
        qEl.outerHTML = renderQuestion(secName, q);
        const input = document.getElementById('ev-input-' + key);
        if (input) input.addEventListener('change', ev => handleUpload(ev, secName, q));
        document.querySelectorAll('.ev-file-del').forEach(btn => {
          btn.addEventListener('click', () => {
            handleDeleteByKey(btn.dataset.key, +btn.dataset.fi, secName);
          });
        });
      }
    }
    renderSectionBar();
  }

  // ── Load existing uploads ─────────────────────────────────────────────────

  async function loadExistingUploads() {
    if (loadingUploads || !DATA) return;
    loadingUploads = true;

    const secNames = sections();
    for (const secName of secNames) {
      try {
        const files = await listFiles(secName);
        files.forEach(f => {
          const { userId } = getUser();
          const namePart   = f.name;
          const path       = `${userId}/${slugify(secName)}/${namePart}`;

          // Map to a question — best effort by filename, otherwise assign to Q1 of section
          // Store as unassigned if we can't determine question
          const key = slugify(secName) + '/unassigned';
          if (!uploads[key]) uploads[key] = [];
          uploads[key].push({ name: namePart, path });
        });
      } catch (_) {}
    }
    loadingUploads = false;
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  function showSummary() {
    const secNames = sections();
    let totalQ     = 0;
    let doneQ      = 0;
    let totalFiles = 0;

    const rows = secNames.map(secName => {
      const qs = DATA[secName];
      const secDone = qs.filter(q => {
        const key = uploadKey(secName, q.q);
        return uploads[key] && uploads[key].length > 0;
      });
      totalQ     += qs.length;
      doneQ      += secDone.length;
      totalFiles += secDone.reduce((n, q) => n + (uploads[uploadKey(secName, q.q)] || []).length, 0);

      return `<div class="ev-sum-row">
        <div class="ev-sum-sec">${secName}</div>
        <div class="ev-sum-stat${secDone.length === qs.length ? ' ev-sum-stat--done' : ''}">
          ${secDone.length}/${qs.length} questions evidenced
        </div>
      </div>`;
    }).join('');

    const pct = Math.round((doneQ / totalQ) * 100);

    document.getElementById('evBody').innerHTML = `
      <div class="ev-summary">
        <div class="ev-sum-hero">
          <div class="ev-sum-pct">${pct}%</div>
          <div class="ev-sum-label">Evidence uploaded</div>
          <div class="ev-sum-sub">${doneQ} of ${totalQ} questions have documents · ${totalFiles} file${totalFiles !== 1 ? 's' : ''} total</div>
        </div>
        <div class="ev-sum-rows">${rows}</div>
        <p class="ev-sum-note">Your evidence is saved securely. Your SCC can access it when your assessment is scheduled.</p>
        <button class="ev-sum-back" type="button" id="evSumBack">← Back to questions</button>
      </div>`;

    document.getElementById('evSumBack').onclick = () => renderSection();
    document.getElementById('evPrev').style.visibility = 'hidden';
    document.getElementById('evNext').style.visibility = 'hidden';
    document.getElementById('evSubmit').style.display  = 'none';
  }

  // ── Navigate ──────────────────────────────────────────────────────────────

  function navigate(dir) {
    const max = sections().length - 1;
    sectionIdx = Math.max(0, Math.min(max, sectionIdx + dir));
    renderSection();
  }

  // ── Open / Close ──────────────────────────────────────────────────────────

  async function open() {
    inject();

    const drawer = document.getElementById('ev-drawer');
    drawer.classList.remove('assess-drawer--closed');
    drawer.classList.add('assess-drawer--open');
    document.body.style.overflow = 'hidden';

    const { userId, token, company } = getUser();

    if (!userId || !token) {
      document.getElementById('evAuthWarn').hidden = false;
      document.getElementById('evMain').hidden     = true;
      return;
    }

    document.getElementById('evAuthWarn').hidden = true;
    document.getElementById('evMain').hidden     = false;
    document.getElementById('evCompanyBar').innerHTML =
      `<span class="ev-company-name">📂 ${company}</span><span class="ev-company-sub">Your evidence is private and visible only to you and your SCC.</span>`;

    // Reset footer visibility
    document.getElementById('evPrev').style.visibility   = 'visible';
    document.getElementById('evNext').style.visibility   = 'visible';
    document.getElementById('evSubmit').style.display    = '';

    const ok = await loadData();
    if (!ok) return;

    sectionIdx = 0;
    renderSection();
    loadExistingUploads().then(() => renderSectionBar());
  }

  function close() {
    const drawer = document.getElementById('ev-drawer');
    if (drawer) { drawer.classList.remove('assess-drawer--open'); drawer.classList.add('assess-drawer--closed'); }
    document.body.style.overflow = '';
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.EvidenceVault = { open, close };

})();
