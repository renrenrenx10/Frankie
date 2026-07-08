// ── UI module  v3.1 ───────────────────────────────────────────────────────────
// Handles: mode dropdown, sidebar history accordion,
//          chat message append, rail source cards with links, suggest panel.

// ── Source humanisation ───────────────────────────────────────────────────────
// Maps raw source filenames/stems to display labels and icons.
// handbook_chapter_prefix is used to build a deep-link into the members portal.

const SOURCE_META = {
    // BE handbook — opens members portal at the Business Excellence handbook
    'be_handbook':                { label: 'Business Excellence Handbook', icon: '📖', handbookNav: 'handbook' },
    'be handbook':                { label: 'Business Excellence Handbook', icon: '📖', handbookNav: 'handbook' },

    // Nuclear handbook
    'nuclear_handbook':           { label: 'Nuclear Handbook',             icon: '⚛️',  handbookNav: 'nhandbook' },
    'nuclear handbook':           { label: 'Nuclear Handbook',             icon: '⚛️',  handbookNav: 'nhandbook' },

    // Plant Explorer — opens plant drawer (both underscore and space forms)
    'plant_tree':                 { label: 'Nuclear Plant Explorer',       icon: '🏭', handbookNav: null, plantNav: true },
    'plant tree':                 { label: 'Nuclear Plant Explorer',       icon: '🏭', handbookNav: null, plantNav: true },

    // F4N KB + legacy names all resolve to F4N Knowledge Base
    'frankie_normalized_kb':      { label: 'F4N Knowledge Base',           icon: '🔬', handbookNav: null },
    'frankie4_kb':                { label: 'F4N Knowledge Base',           icon: '🔬', handbookNav: null },
    'frankie_master_kb':          { label: 'F4N Knowledge Base',           icon: '🔬', handbookNav: null },
    'zone_info':                  { label: 'F4N Knowledge Base',           icon: '🔬', handbookNav: null },
    'company_dict':               { label: 'F4N Knowledge Base',           icon: '🔬', handbookNav: null },

    // Named documents
    'f4n be guidance':            { label: 'F4N BE Guidance',              icon: '📋', handbookNav: null },
    'evidence guide':             { label: 'Evidence Guide',               icon: '📋', handbookNav: null },
    'f4n sa evidence guide':      { label: 'Evidence Guide',               icon: '📋', handbookNav: null },
    'nuccol portal user guide':   { label: 'Portal User Guide',            icon: '🖥', handbookNav: null },
    'fit for portal faq':         { label: 'Portal FAQ',                   icon: '🖥', handbookNav: null },
    'nuccol f4n cq guidance':     { label: 'CQ Guidance',                  icon: '💬', handbookNav: null },
    'nuccol action plan guidance':{ label: 'Action Plan Guidance',         icon: '📌', handbookNav: null },
    'f4n supply chain consultant training manual': { label: 'SCC Training Manual', icon: '📖', handbookNav: null },
};

// Handbook chapter IDs that exist in the members portal (members_5.html)
// Maps question_id prefix → which handbook section to open
// e.g. STR01 → handbook, DES01 → handbook, PEO01 → handbook
const HANDBOOK_CHAPTER_PREFIXES = /^(STR|DES|PEO|OPS|QMS|CI|HS)\d/i;

/** Resolve a raw source string to display metadata */
function resolveSource(raw) {
    if (!raw) return SOURCE_META['frankie_normalized_kb'];
    const stem = String(raw).split('/').pop().replace(/\.[^.]+$/, '').toLowerCase().replace(/_/g, ' ');
    // Exact match first, then prefix scan
    if (SOURCE_META[stem]) return SOURCE_META[stem];
    for (const [key, meta] of Object.entries(SOURCE_META)) {
        if (stem.includes(key) || key.includes(stem)) return meta;
    }
    // Fallback: humanise the raw name
    return { label: stem.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), icon: '📄', handbookNav: null };
}

/** Build a members portal deep-link for a handbook chapter */
function handbookLink(meta, chapterId) {
    if (!meta.handbookNav) return null;
    const base = '../members_5.html';  // adjust if Frankie is in a subdirectory
    if (chapterId && HANDBOOK_CHAPTER_PREFIXES.test(chapterId)) {
        return `${base}?section=${meta.handbookNav}&ch=${encodeURIComponent(chapterId)}`;
    }
    return `${base}?section=${meta.handbookNav}`;
}

const CONTENT_TYPE_LABELS = {
    scoring_rubric:    '📊 Scoring',
    training_content:  '📖 Training',
    worked_example:    '✅ Example',
    osv_guidance:      '🔍 OSV',
    evidence_guide:    '📋 Evidence',
    portal_guide:      '🖥 Portal',
    programme_overview:'🗺 Overview',
    cq_guidance:       '💬 CQ',
    nss_content:       '⚛ NSS',
    general:           '📄 General',
};

// ── Initialise ────────────────────────────────────────────────────────────────

export function initialiseUI() {
    _bindModeDropdown();
    _bindHistoryAccordion();
    _bindClearButtons();
    _bindQuickButtons();
    _bindTierButtons();
    renderRecentPanel();
}

// ── Mode dropdown ─────────────────────────────────────────────────────────────

const MODE_LABELS = {
    company:   ['Company Mode',   'Practical F4N guidance with source-backed response cards.'],
    scc:       ['SCC Mode',        'Red flag identification and scoring perspective.'],
    osv:       ['OSV Prep Mode',   'Checklist-led onsite verification preparation.'],
    readiness: ['Readiness Mode',  'Short public diagnostic questions and guidance.'],
};

function _bindModeDropdown() {
    const toggle   = document.getElementById('modeToggle');
    const dropdown = document.getElementById('modeDropdown');
    if (!toggle || !dropdown) return;

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !dropdown.hidden;
        dropdown.hidden = open;
        toggle.setAttribute('aria-expanded', String(!open));
    });

    document.addEventListener('click', () => {
        if (!dropdown.hidden) {
            dropdown.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
        }
    });

    dropdown.querySelectorAll('.mode-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mode = btn.dataset.mode;
            const sub  = btn.dataset.sub;

            dropdown.querySelectorAll('.mode-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.getElementById('modeCurrentLabel').textContent = btn.textContent.trim();
            document.getElementById('modeCurrentSub').textContent   = sub;

            const [title, subText] = MODE_LABELS[mode] || MODE_LABELS.company;
            const modeTitle = document.getElementById('modeTitle');
            const modeSub   = document.getElementById('modeSub');
            if (modeTitle) modeTitle.textContent = title;
            if (modeSub)   modeSub.textContent   = subText;

            dropdown.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');

            // Clear messages on mode switch
            const messages = document.getElementById('messages');
            if (messages) messages.innerHTML = '';
            import('./app.js').then(m => m.clearHistory?.());
        });
    });
}

export function getActiveMode() {
    const active = document.querySelector('.mode-option.active');
    return active?.dataset?.mode || 'company';
}

// ── History accordion ─────────────────────────────────────────────────────────

function _bindHistoryAccordion() {
    const toggle = document.getElementById('historyToggle');
    const panel  = document.getElementById('recentPanel');
    if (!toggle || !panel) return;

    toggle.addEventListener('click', () => {
        const open = !panel.hidden;
        panel.hidden = open;
        toggle.setAttribute('aria-expanded', String(!open));
        toggle.querySelector('.history-chevron').textContent = open ? '▾' : '▴';
    });
}

// ── Recent panel render (called from history.js too) ─────────────────────────

export function renderRecentPanel() {
    const panel = document.getElementById('recentPanel');
    if (!panel) return;

    let sessions = [];
    try { sessions = JSON.parse(localStorage.getItem('frankieHistory') || '[]'); } catch {}

    if (!sessions.length) {
        panel.innerHTML = '<p class="recent-empty">No previous questions yet.</p>';
        return;
    }

    const groups = {};
    [...sessions].reverse().forEach(s => {
        const label = _dateLabel(s.date);
        if (!groups[label]) groups[label] = [];
        groups[label].push(s);
    });

    panel.innerHTML = Object.entries(groups).map(([label, items]) => `
        <div class="recent-group">
          <div class="recent-date">${label}</div>
          ${items.map(s => `
          <div class="recent-item-wrap">
            <button class="recent-item" data-id="${s.id}" type="button">
              <span class="recent-mode recent-mode--${s.mode}">${s.mode}</span>
              <span class="recent-query">${_esc(s.query)}</span>
              ${s.confProfile && s.confProfile !== 'high' ? `<span class="recent-conf recent-conf--${s.confProfile}">!</span>` : ''}
            </button>
          </div>`).join('')}
        </div>`).join('');

    panel.querySelectorAll('.recent-item').forEach(btn => {
        btn.addEventListener('click', () => _replaySession(Number(btn.dataset.id)));
    });
}

function _replaySession(id) {
    let sessions = [];
    try { sessions = JSON.parse(localStorage.getItem('frankieHistory') || '[]'); } catch {}
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    const messages = document.getElementById('messages');
    if (!messages) return;
    messages.innerHTML = '';

    const userDiv = document.createElement('div');
    userDiv.className = 'row user';
    userDiv.innerHTML = `<div class="avatar user">YOU</div><div class="bubble"><p>${_esc(session.query)}</p></div>`;
    messages.appendChild(userDiv);

    const botDiv = document.createElement('div');
    botDiv.className = 'row assistant';
    botDiv.innerHTML = `<div class="avatar bot">F4N</div><div class="bubble">${session.answerHtml}</div>`;
    messages.appendChild(botDiv);
    messages.scrollTop = 0;

    const banner = document.createElement('div');
    banner.className = 'replay-banner';
    banner.innerHTML = `Saved answer from ${_formatDate(session.date)} · <button class="replay-dismiss" type="button">Dismiss</button>`;
    messages.prepend(banner);
    banner.querySelector('.replay-dismiss').addEventListener('click', () => {
        banner.remove();
        messages.innerHTML = '';
    });

    // Close history accordion after replay
    const panel  = document.getElementById('recentPanel');
    const toggle = document.getElementById('historyToggle');
    if (panel && !panel.hidden) {
        panel.hidden = true;
        toggle?.setAttribute('aria-expanded', 'false');
        if (toggle) toggle.querySelector('.history-chevron').textContent = '▾';
    }
}

// ── Clear buttons ─────────────────────────────────────────────────────────────

function _bindClearButtons() {
    document.getElementById('clearHistory')?.addEventListener('click', () => {
        const messages = document.getElementById('messages');
        if (messages) messages.innerHTML = '';
        import('./app.js').then(m => m.clearHistory?.());
    });

    document.getElementById('clearAllHistory')?.addEventListener('click', () => {
        if (confirm('Clear all saved conversation history?')) {
            import('./app.js').then(m => m.clearAllHistory?.());
            renderRecentPanel();
        }
    });
}

// ── Quick buttons ─────────────────────────────────────────────────────────────

function _bindQuickButtons() {
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById('input');
            if (input) { input.value = btn.textContent.trim(); input.focus(); }
        });
    });
}

// ── Tier buttons ──────────────────────────────────────────────────────────────

function _bindTierButtons() {
    const saved = localStorage.getItem('frankieTier') || 'free';
    document.querySelectorAll('.tier-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tier === saved);
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            localStorage.setItem('frankieTier', btn.dataset.tier);
            import('./retrieval.js').then(m => m.clearKbCache?.());
        });
    });
}

// ── Chat message append ───────────────────────────────────────────────────────

export function appendMessage(role, html) {
    const messages = document.getElementById('messages');
    if (!messages) return null;
    const div = document.createElement('div');
    div.className = `row ${role}`;
    div.innerHTML = `<div class="avatar ${role === 'user' ? 'user' : 'bot'}">${role === 'user' ? 'YOU' : 'F4N'}</div><div class="bubble">${html}</div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    div._bubble = div.querySelector('.bubble');
    return div;
}

export function updateMessage(div, html) {
    if (div) {
        const bubble = div._bubble || div.querySelector('.bubble') || div;
        bubble.innerHTML = html;
        const messages = document.getElementById('messages');
        if (messages) messages.scrollTop = messages.scrollHeight;
    }
}

// ── Rail: source cards with links ─────────────────────────────────────────────

export function updateRail(results) {
    const rail = document.getElementById('rail');
    if (!rail) return;

    if (!results?.length) {
        rail.innerHTML = '<p class="rail-empty">No sources matched.</p>';
        return;
    }

    rail.innerHTML = results.slice(0, 5).map(r => {
        const rawSrc   = r.source || r.source_file || 'frankie_normalized_kb.json';
        const meta     = resolveSource(rawSrc);
        const ctLabel  = CONTENT_TYPE_LABELS[r.content_type] || '';
        const score    = typeof r.score === 'number' ? r.score.toFixed(1) : '—';

        // Primary label: section title if we have one, else source label
        const primaryLabel = r.section || meta.label;
        // Subtitle: source label (only if section is the primary)
        const subLabel = r.section ? meta.label : null;

        // Build link — handbook or plant sources open a drawer
        const chapterRef   = r.question_id || r.title || null;
        const isHandbook   = meta.handbookNav !== null;
        const isPlant      = !!meta.plantNav;
        const isClickable  = (isHandbook && !!chapterRef) || isPlant;

        const actionLabel  = isPlant ? '🏭 Explore in plant →' : '📖 Open in handbook →';

        const cardInner = `
            <div class="rail-card-top">
              <span class="rail-source-icon">${meta.icon}</span>
              <span class="rail-source-label">${_esc(primaryLabel)}</span>
              ${ctLabel ? `<span class="rail-ct-badge">${ctLabel}</span>` : ''}
            </div>
            ${subLabel ? `<div class="rail-source-sub">${_esc(subLabel)}</div>` : ''}
            ${r.question_id ? `<div class="rail-qid">${_esc(r.question_id)}</div>` : ''}
            <div class="rail-score">Match: ${score}</div>
            ${isClickable ? `<div class="rail-action">${actionLabel}</div>` : ''}`;

        if (isPlant) {
            return `<button class="rail-card rail-card--link" type="button" onclick="window.PlantDrawer && window.PlantDrawer.open(window.frankieLastQuery)">${cardInner}</button>`;
        }
        if (isHandbook && chapterRef) {
            return `<button class="rail-card rail-card--link" type="button" onclick="window.HandbookDrawer && window.HandbookDrawer.open('${_esc(chapterRef)}')">${cardInner}</button>`;
        }
        return `<div class="rail-card">${cardInner}</div>`;
    }).join('');
}

// ── Rail: suggested follow-up questions ──────────────────────────────────────

export function updateSuggestions(suggestions) {
    const panel = document.getElementById('suggestPanel');
    const head  = document.getElementById('suggestHead');
    if (!panel) return;

    if (!suggestions?.length) {
        panel.innerHTML = '';
        if (head) head.style.display = 'none';
        return;
    }

    if (head) head.style.display = '';

    panel.innerHTML = suggestions.map(q => `
      <button class="suggest-btn" type="button">${_esc(q)}</button>`).join('');

    panel.querySelectorAll('.suggest-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById('input');
            if (input) {
                input.value = btn.textContent;
                input.focus();
            }
        });
    });
}

// ── Load status ───────────────────────────────────────────────────────────────

export function setLoadStatus(text) {
    // No longer a dedicated element — could update status btn label if needed
    const label = document.getElementById('statusBtnLabel');
    // Only update if it's still in "Checking" state
    if (label && label.textContent === 'Checking…') {
        label.textContent = text;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _dateLabel(iso) {
    const d = new Date(iso), now = new Date();
    const diff = Math.floor((now - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7)  return `${diff} days ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function _formatDate(iso) {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
