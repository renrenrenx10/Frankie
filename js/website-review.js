// ── Frankie Website Review  v1.0 ─────────────────────────────────────────────
// Fetches a supplier website via CORS proxy, extracts text content, sends to
// Claude with nuclear supply chain criteria, renders a structured scorecard.
//
// Usage:
//   WebsiteReview.open()          → opens the drawer
//   WebsiteReview.open(url)       → pre-fills URL and auto-runs
//   WebsiteReview.close()

(function () {
    'use strict';

    const PROXY      = 'https://corsproxy.io/?';
    const MAX_CHARS  = 8000;   // max website text sent to Claude

    const CRITERIA = [
        { key: 'clarity',          label: 'Company Clarity',       icon: '🏷️',  desc: 'Is it immediately clear what this company makes or does?' },
        { key: 'nuclear',          label: 'Nuclear Relevance',      icon: '⚛️',  desc: 'Do they reference nuclear, defence, or safety-critical sectors?' },
        { key: 'quality',          label: 'Quality & Accreditation',icon: '✅',  desc: 'Are quality standards (ISO, ASME, etc.) mentioned?' },
        { key: 'technical',        label: 'Technical Depth',        icon: '🔩',  desc: 'Do they show technical specs, capabilities, or processes?' },
        { key: 'credibility',      label: 'Credibility Signals',    icon: '🤝',  desc: 'Are clients, case studies, team, or history mentioned?' },
        { key: 'contact',          label: 'Contact Accessibility',  icon: '📞',  desc: 'Is it easy to find who to contact and how?' },
    ];

    const PROMPT_SYSTEM = `You are a nuclear supply chain procurement specialist reviewing supplier websites for fit with the UK nuclear sector and F4N (Fit for Nuclear) programme. Your job is to assess whether a supplier's website gives a procurement team confidence to shortlist them.

Score each criterion 0–10 and provide a brief note. Be honest and critical — most supplier websites are poor. A score of 7+ means genuinely strong evidence, 4–6 means partial/unclear, 0–3 means absent or very weak.

Respond ONLY with valid JSON in exactly this format:
{
  "companyName": "string — best guess at company name from the content",
  "verdict": "Shortlist" | "Review" | "Pass",
  "verdictNote": "one sentence explaining the overall verdict",
  "summary": "2-3 sentence honest assessment of the website from a nuclear procurement perspective",
  "scores": {
    "clarity":     { "score": 0-10, "note": "brief note" },
    "nuclear":     { "score": 0-10, "note": "brief note" },
    "quality":     { "score": 0-10, "note": "brief note" },
    "technical":   { "score": 0-10, "note": "brief note" },
    "credibility": { "score": 0-10, "note": "brief note" },
    "contact":     { "score": 0-10, "note": "brief note" }
  },
  "strengths": ["up to 3 genuine strengths"],
  "gaps": ["up to 4 specific gaps or improvements needed"],
  "commodities": ["list of inferred product/service categories this supplier likely covers"]
}

Verdict guide: "Shortlist" = strong candidate worth contacting, "Review" = some promise but needs more info, "Pass" = not clearly relevant or credible.`;

    // ── DOM ────────────────────────────────────────────────────────────────────
    function injectDrawer() {
        if (document.getElementById('website-review-drawer')) return;
        const el = document.createElement('div');
        el.id        = 'website-review-drawer';
        el.className = 'wr-drawer wr-drawer--closed';
        el.innerHTML = `
          <div class="wr-backdrop" id="wrBackdrop"></div>
          <div class="wr-panel">
            <div class="wr-topbar">
              <span class="wr-icon">🌐</span>
              <div class="wr-title" id="wrTitle">Website Review</div>
              <button class="wr-close" id="wrClose" aria-label="Close">✕</button>
            </div>

            <div class="wr-url-bar">
              <input class="wr-url-input" id="wrUrlInput" type="url"
                     placeholder="https://www.suppliername.co.uk" autocomplete="off">
              <button class="wr-run-btn" id="wrRunBtn" type="button">Review</button>
            </div>

            <div class="wr-body" id="wrBody">
              <div class="wr-intro">
                <p class="wr-intro-text">Enter a supplier website URL and Frankie will fetch the content and score it against nuclear supply chain criteria — clarity, quality credentials, technical depth, and more.</p>
                <div class="wr-criteria-list">
                  ${CRITERIA.map(c => `<div class="wr-crit-preview"><span>${c.icon}</span><div><strong>${c.label}</strong><span>${c.desc}</span></div></div>`).join('')}
                </div>
              </div>
            </div>
          </div>`;
        document.body.appendChild(el);

        document.getElementById('wrClose').addEventListener('click', close);
        document.getElementById('wrBackdrop').addEventListener('click', close);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

        document.getElementById('wrRunBtn').addEventListener('click', runReview);
        document.getElementById('wrUrlInput').addEventListener('keydown', e => {
            if (e.key === 'Enter') runReview();
        });
    }

    // ── Fetch website ──────────────────────────────────────────────────────────
    async function fetchWebsite(url) {
        const proxyUrl = PROXY + encodeURIComponent(url);
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`Could not fetch site (proxy returned ${res.status}). The site may block automated access.`);
        return await res.text();
    }

    function htmlToText(html) {
        // Strip tags, scripts, styles; decode entities; collapse whitespace
        let text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
            .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
            .replace(/&nbsp;/g,' ').replace(/&#\d+;/g,' ')
            .replace(/\s{2,}/g,' ')
            .trim();
        return text.slice(0, MAX_CHARS);
    }

    // ── Claude call ────────────────────────────────────────────────────────────
    async function callClaude(websiteText, url) {
        const key   = localStorage.getItem('frankieClaudeKey') || '';
        const model = localStorage.getItem('frankieClaudeModel') || 'claude-sonnet-4-6';

        if (!key) throw new Error('No Claude API key saved. Add your key in the sidebar → Claude API.');

        const userMsg = `Website URL: ${url}\n\nWebsite content (extracted text):\n\n${websiteText}`;

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model,
                max_tokens: 1200,
                system: PROMPT_SYSTEM,
                messages: [{ role: 'user', content: userMsg }],
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Claude API error ${res.status}`);
        }

        const data  = await res.json();
        const text  = data.content?.[0]?.text || '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Claude returned unexpected format');
        return JSON.parse(match[0]);
    }

    // ── Main review flow ───────────────────────────────────────────────────────
    async function runReview() {
        const input = document.getElementById('wrUrlInput');
        const body  = document.getElementById('wrBody');
        const btn   = document.getElementById('wrRunBtn');
        const title = document.getElementById('wrTitle');

        let url = (input.value || '').trim();
        if (!url) { input.focus(); return; }
        if (!url.startsWith('http')) url = 'https://' + url;
        input.value = url;

        btn.disabled = true;
        btn.textContent = 'Fetching…';
        title.textContent = 'Website Review';
        body.innerHTML = `
          <div class="wr-loading">
            <div class="wr-spinner"></div>
            <div class="wr-loading-steps">
              <div class="wr-step wr-step--active" id="wrStep1">🌐 Fetching website…</div>
              <div class="wr-step" id="wrStep2">🔍 Extracting content…</div>
              <div class="wr-step" id="wrStep3">🤖 Analysing with Claude…</div>
              <div class="wr-step" id="wrStep4">📊 Building scorecard…</div>
            </div>
          </div>`;

        function step(n) {
            for (let i = 1; i <= 4; i++) {
                const el = document.getElementById(`wrStep${i}`);
                if (el) el.classList.toggle('wr-step--active', i === n);
            }
            if (n > 1) btn.textContent = n === 3 ? 'Analysing…' : 'Building…';
        }

        try {
            step(1);
            const html = await fetchWebsite(url);

            step(2);
            const text = htmlToText(html);
            if (text.length < 100) throw new Error('Could not extract meaningful content from this URL. The site may require JavaScript to render or block automated access.');

            step(3);
            const result = await callClaude(text, url);

            step(4);
            renderResult(result, url);
            title.textContent = `Review — ${result.companyName || new URL(url).hostname}`;

        } catch (e) {
            body.innerHTML = `<div class="wr-error">
              <div class="wr-error-icon">⚠️</div>
              <div class="wr-error-msg">${esc(e.message)}</div>
              <div class="wr-error-hint">Check the URL is correct and publicly accessible. Some sites block automated access.</div>
            </div>`;
        } finally {
            btn.disabled = false;
            btn.textContent = 'Review';
        }
    }

    // ── Render scorecard ───────────────────────────────────────────────────────
    function verdictStyle(v) {
        return { Shortlist: '#4caf7d', Review: '#e09a3a', Pass: '#e05252' }[v] || '#65758a';
    }

    function scoreColour(s) {
        if (s >= 7) return '#4caf7d';
        if (s >= 4) return '#e09a3a';
        return '#e05252';
    }

    function scoreBar(s) {
        const col = scoreColour(s);
        return `<div class="wr-score-bar-wrap">
          <div class="wr-score-bar" style="width:${s*10}%;background:${col}"></div>
        </div>`;
    }

    function renderResult(r, url) {
        const body = document.getElementById('wrBody');
        const col  = verdictStyle(r.verdict);

        const avgScore = Math.round(
            Object.values(r.scores).reduce((s, v) => s + v.score, 0) / Object.keys(r.scores).length * 10
        );

        let html = `
          <div class="wr-result">

            <!-- Verdict hero -->
            <div class="wr-verdict-card" style="border-color:${col}">
              <div class="wr-verdict-badge" style="background:${col}">${esc(r.verdict)}</div>
              <div class="wr-verdict-right">
                <div class="wr-verdict-company">${esc(r.companyName || '')}</div>
                <div class="wr-verdict-note">${esc(r.verdictNote || '')}</div>
                <a class="wr-verdict-url" href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>
              </div>
            </div>

            <!-- Summary -->
            <p class="wr-summary">${esc(r.summary || '')}</p>

            <!-- Scorecard -->
            <h4 class="wr-section-hd">Scorecard</h4>
            <div class="wr-scores">`;

        CRITERIA.forEach(c => {
            const s = r.scores?.[c.key];
            if (!s) return;
            const col = scoreColour(s.score);
            html += `<div class="wr-score-row">
              <div class="wr-score-label">
                <span>${c.icon}</span>
                <span>${c.label}</span>
              </div>
              ${scoreBar(s.score)}
              <div class="wr-score-num" style="color:${col}">${s.score}/10</div>
              <div class="wr-score-note">${esc(s.note || '')}</div>
            </div>`;
        });

        html += `</div>`;

        // Strengths + Gaps
        if (r.strengths?.length) {
            html += `<h4 class="wr-section-hd">Strengths</h4><ul class="wr-list wr-list--good">
              ${r.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
        }
        if (r.gaps?.length) {
            html += `<h4 class="wr-section-hd">Gaps &amp; improvements</h4><ul class="wr-list wr-list--gap">
              ${r.gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul>`;
        }

        // Commodities
        if (r.commodities?.length) {
            html += `<h4 class="wr-section-hd">Inferred capabilities</h4>
              <div class="wr-commodity-tags">
                ${r.commodities.map(c => `<span class="wr-tag">${esc(c)}</span>`).join('')}
              </div>`;
        }

        html += `<button class="wr-review-another" id="wrAnother" type="button">Review another website</button>
          </div>`;

        body.innerHTML = html;
        document.getElementById('wrAnother').addEventListener('click', () => {
            document.getElementById('wrUrlInput').value = '';
            body.innerHTML = `<div class="wr-intro"><p class="wr-intro-text">Enter another URL above to review a different supplier.</p></div>`;
            document.getElementById('wrTitle').textContent = 'Website Review';
        });
    }

    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    function open(url) {
        injectDrawer();
        const drawer = document.getElementById('website-review-drawer');
        drawer.classList.remove('wr-drawer--closed');
        drawer.classList.add('wr-drawer--open');
        if (url) {
            document.getElementById('wrUrlInput').value = url;
            runReview();
        } else {
            document.getElementById('wrUrlInput').focus();
        }
    }

    function close() {
        const drawer = document.getElementById('website-review-drawer');
        if (drawer) {
            drawer.classList.remove('wr-drawer--open');
            drawer.classList.add('wr-drawer--closed');
        }
    }

    window.WebsiteReview = { open, close };

}());
