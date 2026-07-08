// ── FAQ Drawer ────────────────────────────────────────────────────────────────
// Pre-baked answers loaded from kb/faq-answers.json.
// Clicking a question injects the answer directly into the chat — no Claude call.
// If a question has no pre-baked answer, it fires through the normal pipeline.

(function () {
    'use strict';

    const ANSWERS_URL = './kb/faq-answers.json';

    let prebakedAnswers = {}; // populated on init

    const FAQS = [
        {
            group: 'Getting Started',
            items: [
                'What are the stages of the F4N programme?',
                'What is the granting criteria for F4N membership?',
                'How do I complete the self assessment?',
                'How do I create an action plan in the portal?',
                'What is a CSIP and how do I build one?',
            ]
        },
        {
            group: 'Scoring & Evidence',
            items: [
                'What does a score of 7 mean?',
                'What is the difference between a score of 2 and a score of 7?',
                'What evidence do I need for CFSI?',
                'What evidence do I need for Strategy & Leadership?',
                'What evidence do I need for QHSE?',
            ]
        },
        {
            group: 'OSV & Verification',
            items: [
                'What happens at my Onsite Verification?',
                'How do I prepare for my OSV?',
                'What documents should I have ready for the OSV?',
                'What is SQEP and how does it affect my score?',
            ]
        },
        {
            group: 'Common Challenges',
            items: [
                'What if my company does not do design?',
                'We are a small company — how do we meet the people requirements?',
                'What ISO standards do I need for F4N?',
                'How does social value factor into my score?',
                'What is the nuclear supply chain hierarchy?',
            ]
        },
        {
            group: 'Next Steps',
            items: [
                'How do I get my score verified by an SCC?',
                'What happens after I reach a score of 7?',
                'Where can I find nuclear procurement opportunities?',
                'How do I join the NuCCoL member network?',
            ]
        },
    ];

    // ── Markdown-lite renderer ────────────────────────────────────────────────

    function renderAnswer(text) {
        let html = text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .split(/\n\n+/)
            .map(para => {
                const lines = para.split('\n');
                if (lines.every(l => l.trim().startsWith('- '))) {
                    const items = lines.map(l => `<li>${l.trim().slice(2)}</li>`).join('');
                    return `<ul>${items}</ul>`;
                }
                return `<p>${lines.join('<br>')}</p>`;
            })
            .join('');
        return html;
    }

    // ── Inject into chat ──────────────────────────────────────────────────────

    function injectIntoChat(question, answerText) {
        const messages = document.getElementById('messages');
        if (!messages) return;

        const userRow = document.createElement('div');
        userRow.className = 'row user';
        userRow.innerHTML = `<div class="avatar user">YOU</div><div class="bubble"><p>${question}</p></div>`;
        messages.appendChild(userRow);

        const botRow = document.createElement('div');
        botRow.className = 'row assistant';
        botRow.innerHTML = `<div class="avatar bot">F4N</div><div class="bubble">${renderAnswer(answerText)}</div>`;
        messages.appendChild(botRow);

        messages.scrollTop = messages.scrollHeight;
    }

    // ── Fire question ─────────────────────────────────────────────────────────

    function fireQuestion(q) {
        close();

        const prebaked = prebakedAnswers[q];
        if (prebaked) {
            injectIntoChat(q, prebaked);
            return;
        }

        // Fallback: fire through normal Frankie pipeline
        const input = document.getElementById('input');
        const composer = document.getElementById('composer');
        if (!input || !composer) return;
        input.value = q;
        input.focus();
        composer.dispatchEvent(new Event('submit'));
    }

    // ── Render drawer ─────────────────────────────────────────────────────────

    function render() {
        const overlay = document.getElementById('faq-overlay');
        const body = overlay.querySelector('.faq-body');
        body.innerHTML = '';

        FAQS.forEach(group => {
            const label = document.createElement('div');
            label.className = 'faq-group-label';
            label.textContent = group.group;
            body.appendChild(label);

            group.items.forEach(q => {
                const hasPrebaked = !!prebakedAnswers[q];
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'faq-item' + (hasPrebaked ? ' prebaked' : '');
                item.innerHTML = `
                    <span class="faq-item-text">${q}</span>
                    <span class="faq-item-icons">
                        <span class="faq-instant-dot" title="Instant answer"></span>
                        <span class="faq-arrow">›</span>
                    </span>`;
                item.addEventListener('click', () => fireQuestion(q));
                body.appendChild(item);
            });
        });

        const note = overlay.querySelector('.faq-cache-note');
        const total = FAQS.flatMap(g => g.items).length;
        const ready = Object.keys(prebakedAnswers).length;
        if (note) note.textContent = ready === total
            ? `${ready} instant answers ready`
            : `${ready} of ${total} answers pre-loaded`;
    }

    // ── Open / close ──────────────────────────────────────────────────────────

    function open() {
        render();
        document.getElementById('faq-overlay').classList.add('open');
    }

    function close() {
        document.getElementById('faq-overlay').classList.remove('open');
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    async function init() {
        try {
            const r = await fetch(ANSWERS_URL);
            if (r.ok) prebakedAnswers = await r.json();
        } catch (e) {
            console.warn('FAQ answers not loaded:', e.message);
        }

        const overlay = document.createElement('div');
        overlay.id = 'faq-overlay';
        overlay.className = 'faq-overlay';
        overlay.innerHTML = `
            <div class="faq-drawer">
                <div class="faq-header">
                    <div class="faq-header-text">
                        <h2>Common Questions</h2>
                        <p>Click any question for an instant answer.</p>
                    </div>
                    <button class="faq-close" id="faq-close-btn" type="button">✕</button>
                </div>
                <div class="faq-body"></div>
                <div class="faq-footer">
                    <span class="faq-cache-note"></span>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        document.getElementById('faq-close-btn').addEventListener('click', close);

        render();
    }

    window.FAQDrawer = { open, close };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
