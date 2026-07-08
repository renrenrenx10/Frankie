// ── Frankie Plant Explorer Drawer  v1.0 ───────────────────────────────────────
// Loads plant_tree_data.json, searches for a component/commodity keyword,
// and renders matching locations grouped by site → building → system → component.
//
// Usage:
//   PlantDrawer.open('pumps')        → search all sites for 'pumps'
//   PlantDrawer.open('pumps', 'Nuclear Island')  → focus on one site
//   PlantDrawer.close()

(function () {
    'use strict';

    const DATA_FILE = 'kb/plant_tree_data.json';

    // Zone number → building label + colour (fallback if data doesn't load)
    const ZONE_COLOURS = {
        'Nuclear Island':                '#1a9edd',
        'Balance of Plant':              '#1a6ab4',
        'Turbine Island':                '#1a6ab4',
        'Site Development & Construction': '#888',
    };

    let PLANT_DATA = null;
    let loading    = false;

    // ── DOM ───────────────────────────────────────────────────────────────────
    function injectDrawer() {
        if (document.getElementById('plant-drawer')) return;
        const el = document.createElement('div');
        el.id        = 'plant-drawer';
        el.className = 'plant-drawer plant-drawer--closed';
        el.innerHTML = `
          <div class="plant-drawer-backdrop" id="plantDrawerBackdrop"></div>
          <div class="plant-drawer-panel">
            <div class="plant-drawer-topbar">
              <span class="plant-drawer-icon">🏭</span>
              <div class="plant-drawer-title" id="plantDrawerTitle">Plant Explorer</div>
              <button class="plant-drawer-close" id="plantDrawerClose" aria-label="Close">✕</button>
            </div>
            <div class="plant-drawer-search-bar">
              <input class="plant-drawer-search" id="plantDrawerSearch" type="search"
                     placeholder="Search components, systems, commodities…" autocomplete="off">
            </div>
            <div class="plant-drawer-body" id="plantDrawerBody">
              <div class="plant-drawer-loading">Loading plant data…</div>
            </div>
          </div>`;
        document.body.appendChild(el);

        document.getElementById('plantDrawerClose').addEventListener('click', close);
        document.getElementById('plantDrawerBackdrop').addEventListener('click', close);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

        const searchEl = document.getElementById('plantDrawerSearch');
        let debounce;
        searchEl.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                if (PLANT_DATA) renderResults(extractKeywords(searchEl.value.trim()) || searchEl.value.trim());
            }, 200);
        });
    }

    // ── Data load ─────────────────────────────────────────────────────────────
    async function loadData() {
        if (PLANT_DATA) return PLANT_DATA;
        if (loading) return null;
        loading = true;
        try {
            console.log('[PlantDrawer] Fetching:', DATA_FILE, '— page:', location.href);
            const res  = await fetch(DATA_FILE);
            console.log('[PlantDrawer] Response:', res.status, res.statusText, res.url);
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${res.url}`);
            PLANT_DATA = await res.json();
            loading    = false;
            return PLANT_DATA;
        } catch (e) {
            loading = false;
            console.error('[PlantDrawer] Failed to load plant data:', e);
            const body = document.getElementById('plantDrawerBody');
            if (body) body.innerHTML = `<div class="plant-drawer-hint plant-drawer-hint--error">⚠ Could not load plant data.<br><small>${esc(e.message)}</small></div>`;
            return null;
        }
    }

    // ── Search ────────────────────────────────────────────────────────────────
    function searchTree(term, tree) {
        const q = term.toLowerCase().trim();
        if (!q) return [];

        const matches = []; // { site, location, system, component, sub }

        for (const site of tree) {
            for (const loc of (site.locations || [])) {
                for (const sys of (loc.systems || [])) {
                    for (const comp of (sys.components || [])) {
                        // Match at component level
                        const compHit = comp.name.toLowerCase().includes(q);

                        for (const sub of (comp.subcomponents || [])) {
                            const subHit = sub.name.toLowerCase().includes(q)
                                || (sub.resolvedCap || '').toLowerCase().includes(q)
                                || (sub.commodityGroup || '').toLowerCase().includes(q)
                                || (sub.category || '').toLowerCase().includes(q);

                            if (compHit || subHit) {
                                matches.push({
                                    site:      site.name,
                                    location:  loc.name,
                                    system:    sys.name,
                                    component: comp.name,
                                    sub:       sub.name,
                                    cap:       sub.resolvedCap || sub.commodityGroup || '',
                                    companies: (sub.companies || []).length,
                                });
                            }
                        }

                        // Component with no subcomponents but matching name
                        if (compHit && (comp.subcomponents || []).length === 0) {
                            matches.push({
                                site: site.name, location: loc.name,
                                system: sys.name, component: comp.name,
                                sub: '', cap: '', companies: 0,
                            });
                        }
                    }
                }
            }
        }
        return matches;
    }

    // ── Render ────────────────────────────────────────────────────────────────
    function siteColour(siteName) {
        for (const [key, col] of Object.entries(ZONE_COLOURS)) {
            if (siteName.includes(key.split(' ')[0])) return col;
        }
        return '#65758a';
    }

    function renderResults(term) {
        const body = document.getElementById('plantDrawerBody');
        const title = document.getElementById('plantDrawerTitle');
        if (!body || !PLANT_DATA) return;

        if (!term) {
            body.innerHTML = '<div class="plant-drawer-hint">Type a component or commodity to search the plant hierarchy.</div>';
            title.textContent = 'Plant Explorer';
            return;
        }

        const matches = searchMulti(term, PLANT_DATA.plant_tree);

        if (!matches.length) {
            body.innerHTML = `<div class="plant-drawer-hint">No matches for "<strong>${esc(term)}</strong>" in the plant tree.</div>`;
            title.textContent = 'Plant Explorer';
            return;
        }

        // Group by site → location
        const bySite = {};
        for (const m of matches) {
            if (!bySite[m.site]) bySite[m.site] = {};
            const key = m.location;
            if (!bySite[m.site][key]) bySite[m.site][key] = [];
            bySite[m.site][key].push(m);
        }

        title.textContent = `Plant Explorer — ${matches.length} match${matches.length !== 1 ? 'es' : ''}`;

        // Auto-expand the site with the most matches
        const topSite = Object.entries(bySite)
            .sort((a,b) => Object.values(b[1]).reduce((n,a)=>n+a.length,0) - Object.values(a[1]).reduce((n,a)=>n+a.length,0))[0][0];

        let html = '';
        for (const [site, locs] of Object.entries(bySite)) {
            const col   = siteColour(site);
            const total = Object.values(locs).reduce((n, arr) => n + arr.length, 0);
            const open  = site === topSite;
            const siteId = `psite-${site.replace(/\W+/g,'_')}`;

            html += `
              <div class="plant-site-block">
                <button class="plant-site-header plant-site-toggle" data-target="${siteId}" aria-expanded="${open}" type="button">
                  <span class="plant-site-dot" data-col="${col}"></span>
                  <span class="plant-site-name">${esc(site)}</span>
                  <span class="plant-site-count">${total}</span>
                  <span class="plant-site-chevron">${open ? '▴' : '▾'}</span>
                </button>
                <div class="plant-site-body" id="${siteId}" ${open ? '' : 'hidden'}>`;

            for (const [locName, items] of Object.entries(locs)) {
                const bySys = {};
                for (const m of items) {
                    if (!bySys[m.system]) bySys[m.system] = [];
                    bySys[m.system].push(m);
                }

                html += `<div class="plant-loc-block">
                  <div class="plant-loc-name">📍 ${esc(locName)}</div>`;

                for (const [sysName, sItems] of Object.entries(bySys)) {
                    html += `<div class="plant-sys-block">
                      <div class="plant-sys-name">${esc(sysName)}</div>
                      <ul class="plant-comp-list">`;

                    const seen = new Set();
                    for (const m of sItems) {
                        const key = `${m.component}|${m.sub}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        html += `<li class="plant-comp-item">
                          <span class="plant-comp-name">${esc(m.component)}</span>
                          ${m.sub && m.sub !== m.component ? `<span class="plant-sub-name">› ${esc(m.sub)}</span>` : ''}
                          ${m.cap ? `<span class="plant-cap-tag">${esc(m.cap)}</span>` : ''}
                        </li>`;
                    }

                    html += `</ul></div>`;
                }
                html += `</div>`;
            }
            html += `</div></div>`; // close plant-site-body + plant-site-block
        }

        body.innerHTML = html;

        // Apply dynamic colours (avoids CSP inline-style block on render)
        body.querySelectorAll('.plant-site-dot[data-col]').forEach(el => {
            el.style.background = el.dataset.col;
        });
        body.querySelectorAll('.plant-site-toggle[data-target]').forEach(btn => {
            const col = btn.querySelector('.plant-site-dot')?.style.background;
            if (col) btn.style.borderLeftColor = col;
        });

        // Toggle handler
        body.addEventListener('click', e => {
            const btn = e.target.closest('.plant-site-toggle');
            if (!btn) return;
            const panel  = document.getElementById(btn.dataset.target);
            const chevron = btn.querySelector('.plant-site-chevron');
            if (!panel) return;
            const nowOpen = panel.hasAttribute('hidden');
            panel.toggleAttribute('hidden', !nowOpen);
            btn.setAttribute('aria-expanded', nowOpen);
            if (chevron) chevron.textContent = nowOpen ? '▴' : '▾';
        });
    }

    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Keyword extraction ────────────────────────────────────────────────────
    // Strips question/stop words from a natural-language query so the plant
    // tree search receives meaningful component/commodity terms only.
    const STOP_WORDS = new Set([
        'where','can','be','found','in','a','an','the','is','are','was','were',
        'what','which','how','when','why','who','will','would','could','should',
        'do','does','did','have','has','had','i','we','you','they','it','this',
        'that','these','those','and','or','but','for','of','to','with','on','at',
        'from','by','about','nuclear','plant','used','use','within','inside',
        'my','me','us','them','their','its','our','your','into','across','all',
        'any','some','no','not','if','as','so','up','out','each','both','few',
        'more','most','other','such','than','too','very','just','because','then',
    ]);

    function extractKeywords(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w))
            .join(' ');
    }

    // Search for each keyword individually and union results (de-duped)
    function searchMulti(keywords, tree) {
        const words = keywords.split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        if (words.length === 1) return searchTree(words[0], tree);

        const seen = new Set();
        const results = [];
        for (const w of words) {
            for (const m of searchTree(w, tree)) {
                const key = `${m.site}|${m.location}|${m.system}|${m.component}|${m.sub}`;
                if (!seen.has(key)) { seen.add(key); results.push(m); }
            }
        }
        return results;
    }

    // ── Public API ────────────────────────────────────────────────────────────
    async function open(searchTerm) {
        injectDrawer();

        const drawer = document.getElementById('plant-drawer');
        const body   = document.getElementById('plantDrawerBody');
        const searchEl = document.getElementById('plantDrawerSearch');

        drawer.classList.remove('plant-drawer--closed');
        drawer.classList.add('plant-drawer--open');
        body.innerHTML = '<div class="plant-drawer-loading"><div class="plant-drawer-spinner"></div>Loading plant data…</div>';

        const data = await loadData();
        if (!data) {
            body.innerHTML = '<div class="plant-drawer-hint">⚠ Could not load plant data.</div>';
            return;
        }

        // Extract keywords from the raw query (strips question/stop words)
        const raw  = searchTerm || window.frankieLastQuery || '';
        const term = extractKeywords(raw);
        searchEl.value = term;
        renderResults(term);
        searchEl.focus();
    }

    function close() {
        const drawer = document.getElementById('plant-drawer');
        if (drawer) {
            drawer.classList.remove('plant-drawer--open');
            drawer.classList.add('plant-drawer--closed');
        }
    }

    window.PlantDrawer = { open, close };

}());
