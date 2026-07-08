// ── Frankie Handbook Drawer  v1.0 ─────────────────────────────────────────────
// Fetches HB data from members_5.html at runtime, renders a slide-in drawer
// so handbook chapters open inline inside Frankie — no page navigation needed.
//
// Usage:
//   HandbookDrawer.open('STR01')   → opens drawer at chapter STR01
//   HandbookDrawer.close()         → closes drawer
//
// Rail cards in ui.js call HandbookDrawer.open(chapterId) instead of linking.

(function () {
    'use strict';

    // ── Config ────────────────────────────────────────────────────────────────
    // Path to the members portal HTML relative to Frankie's index.html.
    // Adjust if Frankie lives in a subdirectory.
    const MEMBERS_HTML = 'members_5.html';

    // ── State ─────────────────────────────────────────────────────────────────
    let HB_DATA   = null;   // populated on first open
    let loading   = false;
    let pendingId = null;   // chapter ID to open after load

    // ── DOM injection ─────────────────────────────────────────────────────────
    function injectDrawer() {
        if (document.getElementById('hb-drawer')) return;

        const drawer = document.createElement('div');
        drawer.id        = 'hb-drawer';
        drawer.className = 'hb-drawer hb-drawer--closed';
        drawer.innerHTML = `
          <div class="hb-drawer-backdrop" id="hbDrawerBackdrop"></div>
          <div class="hb-drawer-panel">
            <div class="hb-drawer-topbar">
              <div class="hb-drawer-title" id="hbDrawerTitle">Business Excellence Handbook</div>
              <button class="hb-drawer-close" id="hbDrawerClose" aria-label="Close handbook">✕</button>
            </div>
            <div class="hb-drawer-body" id="hbDrawerBody">
              <div class="hb-drawer-loading">Loading handbook…</div>
            </div>
          </div>`;
        document.body.appendChild(drawer);

        document.getElementById('hbDrawerClose').addEventListener('click', close);
        document.getElementById('hbDrawerBackdrop').addEventListener('click', close);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    }

    // ── Load HB data from members portal ─────────────────────────────────────
    async function loadHBData() {
        if (HB_DATA) return HB_DATA;
        if (loading) return null;
        loading = true;

        try {
            const res  = await fetch(MEMBERS_HTML);
            const text = await res.text();

            // Extract the HB JSON object from the script block
            const match = text.match(/const HB\s*=\s*(\{[\s\S]*?\});\s*\n\s*(?:const|let|var|function|\/\/)/);
            if (!match) throw new Error('HB data not found in members portal');

            HB_DATA = JSON.parse(match[1]);
            loading = false;
            return HB_DATA;
        } catch (e) {
            loading = false;
            console.error('[HandbookDrawer] Failed to load HB data:', e);
            return null;
        }
    }

    // ── Find chapter by ID, or open first chapter of a section by key ───────────
    function findChapter(chapterId, data) {
        // 1. Try exact chapter ID match
        for (const [sectionKey, section] of Object.entries(data)) {
            if (!Array.isArray(section.chapters)) continue;
            const idx = section.chapters.findIndex(ch => ch.id === chapterId);
            if (idx !== -1) {
                return { section, sectionKey, chapter: section.chapters[idx], idx };
            }
        }
        // 2. Try treating chapterId as a section key — open first chapter
        if (data[chapterId] && Array.isArray(data[chapterId].chapters)) {
            const section = data[chapterId];
            const chapter = section.chapters.find(ch => ch.id) || section.chapters[0];
            if (chapter) {
                const idx = section.chapters.indexOf(chapter);
                return { section, sectionKey: chapterId, chapter, idx };
            }
        }
        return null;
    }

    // ── Render a chapter into the drawer ──────────────────────────────────────
    function renderChapter(result, data) {
        const { section, sectionKey, chapter, idx } = result;
        const body  = document.getElementById('hbDrawerBody');
        const title = document.getElementById('hbDrawerTitle');
        if (!body) return;

        title.textContent = section.label;
        title.style.color = section.color;

        const hasPrev = idx > 0;
        const hasNext = idx < section.chapters.length - 1;
        const prevCh  = hasPrev ? section.chapters[idx - 1] : null;
        const nextCh  = hasNext ? section.chapters[idx + 1] : null;

        const prevBtn = hasPrev
            ? `<button class="hb-drawer-nav-btn" onclick="window.HandbookDrawer.open('${prevCh.id}')">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>
                 ${escHtml(prevCh.t)}
               </button>`
            : '<div></div>';

        const nextBtn = hasNext
            ? `<button class="hb-drawer-nav-btn" onclick="window.HandbookDrawer.open('${nextCh.id}')">
                 ${escHtml(nextCh.t)}
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
               </button>`
            : '<div></div>';

        // Section TOC (other chapters in this section)
        const toc = section.chapters
            .filter(ch => ch.id)  // skip overview
            .map(ch => `<button class="hb-drawer-toc-item ${ch.id === chapter.id ? 'hb-drawer-toc-item--active' : ''}"
                                style="${ch.id === chapter.id ? `color:${section.color};` : ''}"
                                onclick="window.HandbookDrawer.open('${ch.id}')">
                           ${escHtml(ch.t)}
                         </button>`)
            .join('');

        body.innerHTML = `
          <div class="hb-drawer-layout">
            <aside class="hb-drawer-sidebar">
              <div class="hb-drawer-sidebar-head" style="color:${section.color}">${escHtml(section.label)}</div>
              <div class="hb-drawer-toc">${toc}</div>
            </aside>
            <div class="hb-drawer-content" id="hbDrawerContent">
              <div class="hb-eyebrow" style="color:${section.color}">
                <span style="display:block;width:16px;height:2px;background:${section.color}"></span>
                ${escHtml(section.label)}
              </div>
              <h2 class="hb-drawer-chapter-title">${escHtml(chapter.t)}</h2>
              <div class="hb-drawer-chapter-body">${chapter.b}</div>
              <div class="hb-drawer-nav-row">${prevBtn}${nextBtn}</div>
            </div>
          </div>`;

        // Scroll content to top
        const content = document.getElementById('hbDrawerContent');
        if (content) content.scrollTop = 0;
    }

    function escHtml(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Public API ────────────────────────────────────────────────────────────
    async function open(chapterId) {
        injectDrawer();

        const drawer = document.getElementById('hb-drawer');
        const body   = document.getElementById('hbDrawerBody');

        // Show drawer immediately with loading state
        drawer.classList.remove('hb-drawer--closed');
        drawer.classList.add('hb-drawer--open');
        if (body) body.innerHTML = '<div class="hb-drawer-loading"><div class="hb-drawer-spinner"></div>Loading handbook…</div>';

        // Load data if needed
        const data = await loadHBData();

        if (!data) {
            if (body) body.innerHTML = '<div class="hb-drawer-error">⚠ Could not load handbook. Check that members_5.html is in the parent directory.</div>';
            return;
        }

        const result = findChapter(chapterId, data);
        if (!result) {
            if (body) body.innerHTML = `<div class="hb-drawer-error">Chapter "${escHtml(chapterId)}" not found in handbook.</div>`;
            return;
        }

        renderChapter(result, data);
    }

    function close() {
        const drawer = document.getElementById('hb-drawer');
        if (drawer) {
            drawer.classList.remove('hb-drawer--open');
            drawer.classList.add('hb-drawer--closed');
        }
    }

    // ── Expose globally ───────────────────────────────────────────────────────
    window.HandbookDrawer = { open, close };

}());
