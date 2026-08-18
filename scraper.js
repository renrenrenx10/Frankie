// scraper.js — browser-based content scraper for Frankie SCC
// All external calls go through corsproxy.io to handle CORS from localhost

const PROXY = 'https://corsproxy.io/?';
const proxied = url => PROXY + encodeURIComponent(url);

// ── RSS FEED LIST ──────────────────────────────────────────────────────────────
// rss.app feeds removed (return 402 — paywalled). Sources without direct RSS
// are fetched via Brave Search (also routed through the proxy).
const RSS_FEEDS = [
  {url:'https://www.world-nuclear-news.org/rss',          source:'World Nuclear News',      cat:'Nuclear'},
  {url:'https://www.niauk.org/feed',                      source:'NIA UK',                 cat:'Nuclear'},
  {url:'https://www.sizewellc.com/feed',                  source:'Sizewell C',             cat:'Nuclear'},
  {url:'https://neutronbytes.com/feed',                   source:'Neutron Bytes',          cat:'Nuclear'},
  {url:'https://www.energylivenews.com/feed',             source:'Energy Live News',       cat:'Nuclear'},
  {url:'https://www.h2-view.com/feed',                    source:'H2 View',                cat:'Hydrogen'},
  {url:'https://hydrogenfuelnews.com/feed',               source:'Hydrogen Fuel News',     cat:'Hydrogen'},
  {url:'https://fuelcellsworks.com/feed',                 source:'Fuel Cells Works',       cat:'Hydrogen'},
  {url:'https://www.offshorewind.biz/feed',               source:'offshoreWIND.biz',       cat:'Offshore Renewables'},
  {url:'https://www.windpowermonthly.com/rss/news',       source:'Windpower Monthly',      cat:'Offshore Renewables'},
  {url:'https://www.iaea.org/feeds/topnews',              source:'IAEA',                   cat:'Nuclear'},
  {url:'https://press.hse.gov.uk/feed',                   source:'HSE',                    cat:'Health & Safety'},
  {url:'https://feeds.bbci.co.uk/news/uk/rss.xml',        source:'BBC News',               cat:null, filter:true},
  {url:'https://feeds.bbci.co.uk/news/business/rss.xml',  source:'BBC Business',           cat:null, filter:true},
];

// Sources with no public RSS — fetched via Brave Search through proxy
const BRAVE_NEWS_SOURCES = [
  {query:'site:onr.org.uk news OR "press release"',                        source:'ONR',                  cat:'Nuclear'},
  {query:'"Great British Energy" nuclear announcement news 2026',          source:'Great British Energy', cat:'Nuclear'},
  {query:'site:rolls-royce.com SMR nuclear news 2025 OR 2026',             source:'Rolls-Royce SMR',      cat:'Nuclear'},
  {query:'site:gevernova.com OR "GE Hitachi" nuclear news 2025 OR 2026',   source:'GE Hitachi Nuclear',   cat:'Nuclear'},
  {query:'site:renews.biz offshore wind news',                             source:'reNews',               cat:'Offshore Renewables'},
  {query:'site:carboncapturemagazine.com OR site:ccsassociation.org news', source:'CCUS News',            cat:'CCUS'},
  {query:'NucCol nuclear supply chain news UK 2026',                       source:'NucCol LinkedIn',      cat:'NucCol News', blob:'nuccol'},
];

const ENERGY_KW = [
  'nuclear','reactor','uranium','hydrogen','fuel cell','carbon capture','ccus',
  'offshore wind','wind farm','fusion','tokamak','sizewell','hinkley',
  'rolls-royce','great british energy','radioactive','electrolys','desnz','onr'
];

const TENDER_SEARCHES = {
  // NOTE: each term here = one POST request through corsproxy.io per scraper
  // run, and the free public proxy rate-limits (429) somewhere around ~50-60
  // requests in quick succession — after which EVERY subsequent proxied call
  // in that run fails, including FTS and Brave, not just the remaining CF
  // terms. Keep the total list short and high-signal rather than exhaustive;
  // it's better to run more often with fewer terms than to blow the budget
  // in one run and get zero results everywhere.
  'Nuclear':             ['Sellafield','Hinkley Point','Sizewell','nuclear decommissioning','small modular reactor'],
  // Generic manufacturing/engineering contract types — these are what NucCol's
  // supply chain members (fabricators, machine shops, valve/vessel makers,
  // surface treatment, NDT etc.) actually bid for, and most of them never
  // mention "nuclear" in the notice text even when the end customer is Sellafield/
  // EDF/RR SMR. See scc.html Granted-company list for the capability mix this
  // is drawn from (filtration, plating, cable cleats, structural steel, valves,
  // heat exchangers, containment systems, bearings, fabrication, castings).
  'Manufacturing':       ['precision machining','structural steel fabrication','pressure vessel manufacture',
                          'valve manufacture','castings and forgings','non-destructive testing',
                          'storage tank manufacture'],
  'Hydrogen':            ['hydrogen production','electrolyser','HyNet'],
  'CCUS':                ['carbon capture','CCUS'],
  'Offshore Renewables': ['offshore wind','floating wind'],
  'Fusion':              ['nuclear fusion','UKAEA STEP programme'],
  // Cross-sector: F4N companies are engineering/manufacturing SMEs first and
  // nuclear suppliers second — the same fabrication/machining/NDT/valve/casting
  // capability that wins nuclear work is directly biddable in these sectors too,
  // and diversification revenue is part of the point of the F4N programme.
  'Rail':                ['rolling stock manufacture','railway signalling','rail depot maintenance'],
  'Oil & Gas':           ['offshore platform','subsea engineering','North Sea decommissioning'],
  'Defence':             ['naval shipbuilding','defence engineering support','MOD equipment support'],
  'Aerospace':           ['aerospace component manufacture','MRO aviation'],
  'Water & Utilities':   ['water treatment infrastructure','water industry AMP7']
};

const BRAVE_EVENT_CATS = ['Nuclear','Hydrogen','CCUS','Offshore Renewables'];
let scraperRunning = false;

// ── LOGGING ────────────────────────────────────────────────────────────────────
function scraperLog(msg, type) {
  const log = document.getElementById('scraper-log');
  if (!log) return;
  const d = document.createElement('div');
  if (type === 'warn')  d.style.color = '#f9e2af';
  if (type === 'error') d.style.color = '#f38ba8';
  if (type === 'brave') d.style.color = '#89dceb';
  d.textContent = new Date().toLocaleTimeString('en-GB') + '  ' + msg;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function safeDate(str) {
  if (!str) return new Date().toISOString().slice(0,10);
  try { const d = new Date(str); return isNaN(d) ? new Date().toISOString().slice(0,10) : d.toISOString().slice(0,10); }
  catch(e) { return new Date().toISOString().slice(0,10); }
}

// A TENDER notice with a closing date in the past is stale — the source hasn't
// re-flagged it as closed but it's no longer biddable, so drop it. PIN and
// AWARD records are exempt: PINs often carry no deadline by design (they're an
// early-warning signal, not a bid window), and AWARDs are inherently
// retrospective (competitor/buyer intel), so an old date there is expected,
// not a staleness bug.
function isStaleTender(closingDate, noticeType) {
  if (noticeType && noticeType !== 'TENDER') return false;
  if (!closingDate) return false;
  const d = new Date(closingDate);
  if (isNaN(d)) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  return d < today;
}

// Strip HTML tags and decode common entities so stray markup/special chars
// (&amp;, &#39;, <p>, CDATA leftovers, etc.) never make it into stored titles/
// descriptions — these get rendered as-is in the Content Editor and newsletters.
function cleanText(str) {
  if (!str) return '';
  const withoutTags = String(str).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ');
  const withoutEntities = withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => { try { return String.fromCodePoint(parseInt(dec,10)); } catch(e) { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => { try { return String.fromCodePoint(parseInt(hex,16)); } catch(e) { return ''; } });
  return withoutEntities.replace(/\s+/g, ' ').trim();
}

function autoCateg(text) {
  const t = text.toLowerCase();
  if (!ENERGY_KW.some(k => t.includes(k))) return null;
  if (['nuclear','reactor','uranium','sizewell','hinkley','radioactive','onr'].some(k => t.includes(k))) return 'Nuclear';
  if (['hydrogen','fuel cell','electrolys'].some(k => t.includes(k))) return 'Hydrogen';
  if (['carbon capture','ccus'].some(k => t.includes(k))) return 'CCUS';
  if (['wind','offshore'].some(k => t.includes(k))) return 'Offshore Renewables';
  if (['fusion','tokamak'].some(k => t.includes(k))) return 'Fusion';
  return 'Nuclear';
}

function parseRSS(xmlText, feed, seenUrls) {
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
  const items = [...xml.querySelectorAll('item,entry')].slice(0, 15);
  const results = [];
  for (const item of items) {
    const rawTitle = item.querySelector('title')?.textContent?.trim() || '';
    const rawLink = item.querySelector('link');
    const rawUrl = (rawLink?.textContent?.trim() || rawLink?.getAttribute('href') || '').trim();
    const url = rawUrl.replace(/([^:])(\/\/+)/g, '$1/');
    const rawSum  = item.querySelector('description,summary,content')?.textContent?.trim() || '';
    const pub  = item.querySelector('pubDate,published,updated')?.textContent?.trim() || '';
    if (!url || seenUrls.has(url)) continue;
    const title = cleanText(rawTitle);
    const sum   = cleanText(rawSum);
    const cat = feed.filter ? autoCateg(title + ' ' + sum) : feed.cat;
    if (!cat) continue;
    results.push({ title:title.slice(0,255), url, source:feed.source,
      summary:sum.slice(0,500), category:cat,
      date:safeDate(pub), scraped_at:new Date().toISOString() });
    seenUrls.add(url);
  }
  return results;
}

// Brave search — routed through corsproxy.io so it works from localhost
async function braveSearch(query, braveKey, count) {
  const targetUrl = 'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + (count||10);
  const res = await fetch(proxied(targetUrl), {
    headers: {
      'X-Subscription-Token': braveKey,
      'Accept': 'application/json',
      'x-requested-with': 'XMLHttpRequest'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error('Brave HTTP ' + res.status);
  return res.json();
}

// ── TENDER SOURCE 2: Find a Tender (FTS) — official OCDS API, >£139k contracts ──
// No keyword param on this API (unlike Contracts Finder) — pull recent "tender"
// stage releases and filter client-side against TENDER_SEARCHES.
function categTender(text) {
  const t = cleanText(text).toLowerCase();
  for (const [sector, terms] of Object.entries(TENDER_SEARCHES)) {
    if (terms.some(term => t.includes(term.toLowerCase()))) return sector;
  }
  return null;
}

async function fetchFTSTenders(seenTenders, newTenders) {
  scraperLog('📋 Tenders — searching Find a Tender (FTS) OCDS API…');
  const since = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,19);
  // Small limit deliberately — full OCDS release objects (nested tender/parties/
  // documents) are large, and corsproxy.io returns 413 Payload Too Large well
  // before limit=100 releases' worth of JSON. Dedup means later runs still pick
  // up anything missed by the smaller page size.
  // Queried as three separate single-stage requests rather than one
  // "stages=planning,tender,award" call — the comma-separated form is valid
  // per FTS's own API docs, but in practice it was coming back with 0 releases
  // when routed through corsproxy.io (the comma likely isn't surviving the
  // round trip through the proxy's own query-string handling intact). Single
  // stage values are the documented example and are known to work.
  //
  // updatedFrom only returns the newest N releases across ALL of UK public-
  // sector procurement — nuclear/rail/defence/manufacturing notices are a
  // small fraction of that firehose, so a single page of 25 essentially never
  // happens to contain one. FTS's response includes a links.next cursor URL
  // (confirmed via the API docs), so page a few requests deep per stage to
  // actually scan a meaningful slice of the 30-day window rather than just
  // the most recent handful of updates from any UK buyer.
  const stages = [
    {stage:'tender',   noticeType:'TENDER'},
    {stage:'planning', noticeType:'PIN'},
    {stage:'award',    noticeType:'AWARD'}
  ];
  const MAX_PAGES = 3; // 3 stages × 3 pages = 9 proxy requests — kept modest so this doesn't eat into the same corsproxy.io rate-limit budget as the CF/Brave calls elsewhere in a run
  let totalNew = 0;
  for (const {stage, noticeType} of stages) {
    let nextUrl = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=' + stage + '&limit=25&updatedFrom=' + since;
    let page = 0, stageNew = 0, stageChecked = 0;
    while (nextUrl && page < MAX_PAGES) {
      page++;
      // FTS is a real gov.uk open-data API and may allow direct cross-origin
      // GETs — try that first only on page 1 (no proxy, no size cap); once we
      // know direct is blocked for this run there's no point retrying it on
      // every subsequent page, so later pages go straight to the proxy.
      const attempts = page === 1
        ? [ {url: nextUrl, label:'direct'}, {url: proxied(nextUrl), label:'proxy'} ]
        : [ {url: proxied(nextUrl), label:'proxy'} ];
      let pageData = null, usedLabel = '';
      for (const attempt of attempts) {
        try {
          const r = await fetch(attempt.url, { headers:{'Accept':'application/json'}, signal:AbortSignal.timeout(20000) });
          if (!r.ok) { scraperLog('  ✗ FTS ['+stage+' p'+page+'] ('+attempt.label+'): HTTP '+r.status,'warn'); continue; }
          const rawText = await r.text();
          try { pageData = JSON.parse(rawText); usedLabel = attempt.label; break; }
          catch(pe) { scraperLog('  ✗ FTS ['+stage+' p'+page+'] ('+attempt.label+'): non-JSON response — '+rawText.slice(0,120),'warn'); continue; }
        } catch(e) { scraperLog('  ✗ FTS ['+stage+' p'+page+'] ('+attempt.label+'): '+e.message,'warn'); }
      }
      if (!pageData) { scraperLog('  ✗ FTS ['+stage+' p'+page+']: all attempts failed, stopping this stage','warn'); break; }
      const releases = pageData.releases || [];
      stageChecked += releases.length;
      for (const rel of releases) {
        const t = rel.tender; if (!t) continue;
        const sector = categTender((t.title||'') + ' ' + (t.description||''));
        if (!sector) continue;
        const url = 'https://www.find-tender.service.gov.uk/Notice/' + rel.id;
        if (!rel.id || seenTenders.has(url)) continue;
        const buyer = (rel.parties||[]).find(p => (p.roles||[]).includes('buyer'));
        const closingDate = (t.tenderPeriod && t.tenderPeriod.endDate) || '';
        if (isStaleTender(closingDate, noticeType)) continue;
        // On award releases, OCDS carries the winning supplier under
        // rel.awards[].suppliers — surface it so award records double as
        // competitor/buyer-behaviour intel, not just a closed-out tender.
        let awardedTo = '';
        if (noticeType === 'AWARD' && Array.isArray(rel.awards) && rel.awards.length) {
          const suppliers = rel.awards.flatMap(a => a.suppliers||[]).map(s => s.name).filter(Boolean);
          awardedTo = cleanText(suppliers.join(', ')).slice(0,255);
        }
        const value = (t.value && t.value.amount) ? 'GBP '+Number(t.value.amount).toLocaleString()
                    : (noticeType === 'AWARD' && rel.awards && rel.awards[0] && rel.awards[0].value)
                      ? 'GBP '+Number(rel.awards[0].value.amount).toLocaleString() : 'Not disclosed';
        newTenders.push({ title:cleanText(t.title).slice(0,255), url,
          organisation:cleanText(buyer && buyer.name).slice(0,255),
          description:cleanText(t.description).slice(0,500), sector, noticeType, awardedTo,
          value, publishedDate: rel.date||'', closingDate,
          scraped_at:new Date().toISOString() });
        seenTenders.add(url); stageNew++;
      }
      nextUrl = (pageData.links && pageData.links.next) || null;
      await new Promise(res=>setTimeout(res,400));
    }
    scraperLog('  ✓ FTS ['+stage+']: +'+stageNew+' (of '+stageChecked+' releases checked across '+page+' page(s))');
    totalNew += stageNew;
  }
  return totalNew;
}

// ── TENDER SOURCE 3: devolved portals with real Klickstream OCDS APIs ────────
// Public Contracts Scotland and Sell2Wales are both built by the same vendor
// (Klickstream) and expose an actual notice-list API — same OCDS release
// shape as FTS (releases[].tender/parties/awards) — not just an HTML search
// form. This replaces the Brave site: search for these two portals, which
// was reliably returning 0 hits (Brave doesn't index their notice pages
// well). dateFrom takes a single calendar month (mm-yyyy), so this pulls the
// current month only per notice type — same trade-off as FTS's 30-day window.
const KLICKSTREAM_PORTALS = [
  {name:'Public Contracts Scotland', base:'https://api.publiccontractsscotland.gov.uk/v1/Notices',
   noticeUrl: id => 'https://www.publiccontractsscotland.gov.uk/search/Search_Switch.aspx?ID=' + id},
  {name:'Sell2Wales',                base:'https://api.sell2wales.gov.wales/v1/Notices',
   noticeUrl: id => 'https://www.sell2wales.gov.wales/search/search_switch.aspx?ID=' + id},
];
const KLICKSTREAM_NOTICE_TYPES = [ {noticeType:2, label:'TENDER'}, {noticeType:3, label:'AWARD'}, {noticeType:1, label:'PIN'} ];

async function fetchKlickstreamPortals(seenTenders, newTenders) {
  const now = new Date();
  const dateFrom = String(now.getMonth()+1).padStart(2,'0') + '-' + now.getFullYear();
  for (const portal of KLICKSTREAM_PORTALS) {
    let portalNew = 0, portalChecked = 0;
    for (const {noticeType, label} of KLICKSTREAM_NOTICE_TYPES) {
      const path = portal.base + '?dateFrom=' + dateFrom + '&noticeType=' + noticeType + '&outputType=0';
      const attempts = [ {url: path, label:'direct'}, {url: proxied(path), label:'proxy'} ];
      let data = null;
      for (const attempt of attempts) {
        try {
          const r = await fetch(attempt.url, { headers:{'Accept':'application/json'}, signal:AbortSignal.timeout(20000) });
          if (!r.ok) { scraperLog('  ✗ '+portal.name+' ['+label+'] ('+attempt.label+'): HTTP '+r.status,'warn'); continue; }
          const rawText = await r.text();
          try { data = JSON.parse(rawText); break; }
          catch(pe) { scraperLog('  ✗ '+portal.name+' ['+label+'] ('+attempt.label+'): non-JSON — '+rawText.slice(0,120),'warn'); continue; }
        } catch(e) { scraperLog('  ✗ '+portal.name+' ['+label+'] ('+attempt.label+'): '+e.message,'warn'); }
      }
      if (!data) continue;
      const releases = data.releases || [];
      portalChecked += releases.length;
      for (const rel of releases) {
        const t = rel.tender; if (!t) continue;
        const sector = categTender((t.title||'') + ' ' + (t.description||''));
        if (!sector) continue;
        // Best-effort notice link: these portals' human-facing pages use a
        // numeric ID (the OCID's last segment), confirmed working for
        // Sell2Wales; PCS is assumed identical since it's the same vendor's
        // platform, but hasn't been separately verified — if it 404s, the
        // record itself is still correct, just the deep link may need fixing.
        const numericId = (rel.ocid||rel.id||'').split('-').pop();
        const noticeUrl = numericId ? portal.noticeUrl(numericId) : '';
        if (!noticeUrl || seenTenders.has(noticeUrl)) continue;
        const buyer = (rel.parties||[]).find(p => (p.roles||[]).includes('buyer'));
        const closingDate = (t.tenderPeriod && t.tenderPeriod.endDate) || '';
        if (isStaleTender(closingDate, label)) continue;
        let awardedTo = '';
        if (label === 'AWARD' && Array.isArray(rel.awards) && rel.awards.length) {
          const suppliers = rel.awards.flatMap(a => a.suppliers||[]).map(s => s.name).filter(Boolean);
          awardedTo = cleanText(suppliers.join(', ')).slice(0,255);
        }
        newTenders.push({ title:cleanText(t.title).slice(0,255), url:noticeUrl,
          organisation:cleanText(buyer && buyer.name).slice(0,255),
          description:cleanText(t.description).slice(0,500), sector, noticeType:label, awardedTo,
          value:(t.value && t.value.amount) ? 'GBP '+Number(t.value.amount).toLocaleString() : 'Not disclosed',
          publishedDate: rel.date||'', closingDate,
          scraped_at:new Date().toISOString() });
        seenTenders.add(noticeUrl); portalNew++;
      }
      await new Promise(res=>setTimeout(res,400));
    }
    scraperLog('  ✓ '+portal.name+': +'+portalNew+' (of '+portalChecked+' notices checked)');
  }
}

// ── TENDER SOURCE 4: portals with no public API/RSS ──────────────────────────────
// eTendersNI (a different platform — European Dynamics/COSMIC, not Klickstream),
// MOD Defence Contracts Online / Defence Sourcing Portal (session-token gated —
// note the _ncp= parameter in its URLs, which a stateless fetch can't reproduce),
// and the Delta eSourcing / In-tend e-sourcing platforms (used by most English
// councils, NHS trusts and housing associations) don't expose a reliable keyword
// API, so (like ONR/GBE/RR SMR above) these are covered via Brave Search through
// the proxy. MOD DCO/DSP is included specifically because defence manufacturing
// (machining, fabrication, castings/forgings, NDT, surface treatment) draws on
// the same supplier capability set as nuclear — real bid-relevant volume outside
// energy.
const BRAVE_TENDER_SOURCES = [
  {site:'etendersni.gov.uk',              source:'eTenders NI'},
  {site:'contracts.mod.uk',               source:'MOD Defence Contracts Online'},
  {site:'delta-esourcing.com',            source:'Delta eSourcing'},
  {site:'in-tend.co.uk',                  source:'In-tend'},
];

async function fetchExternalTenderPortals(braveKey, seenTenders, newTenders) {
  if (!braveKey) { scraperLog('  ℹ External portals (eTendersNI/MOD DCO/Delta/In-tend) skipped — add Brave key in Settings','warn'); return; }
  // Deliberately skip 'Nuclear' terms here — Sellafield/Hinkley/Sizewell etc. are
  // nuclear-specific and above-threshold nuclear notices from anywhere in the UK
  // already come through FTS/CF. What these portals actually add is local/
  // sub-threshold and non-energy manufacturing work, so lead with the
  // Manufacturing terms.
  const allTerms = [...new Set(Object.entries(TENDER_SEARCHES).filter(([sec]) => sec !== 'Nuclear').flatMap(([,terms]) => terms))].slice(0,10);
  for (const src of BRAVE_TENDER_SOURCES) {
    // No literal "tender" requirement — these portals' notice pages don't always
    // contain that word, and site: + AND "tender" was over-filtering to 0 hits.
    const query = 'site:'+src.site+' (' + allTerms.join(' OR ') + ')';
    try {
      const data = await braveSearch(query, braveKey, 15);
      const hits = data.web?.results || [];
      let n = 0;
      for (const r of hits) {
        if (seenTenders.has(r.url)) continue;
        const sector = categTender((r.title||'') + ' ' + (r.description||''));
        if (!sector) continue;
        newTenders.push({ title:cleanText(r.title).slice(0,255), url:r.url,
          organisation:src.source, description:cleanText(r.description).slice(0,500),
          sector, value:'Not disclosed', publishedDate:safeDate(r.page_age), closingDate:'',
          scraped_at:new Date().toISOString() });
        seenTenders.add(r.url); n++;
      }
      // Log raw hit count too — if this stays at 0 hits (not just 0 kept), Brave
      // isn't indexing that portal's notice pages and the query won't help.
      scraperLog('  ✓ '+src.source+' [Brave]: +'+n+' (of '+hits.length+' hits found)', 'brave');
      await new Promise(res=>setTimeout(res,800));
    } catch(e) { scraperLog('  ✗ '+src.source+' [Brave]: '+e.message,'warn'); }
  }
}

// ── MAIN ───────────────────────────────────────────────────────────────────────
async function runScraper() {
  if (scraperRunning) return;
  scraperRunning = true;
  const btn = document.getElementById('scraper-run-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Running…'; }
  document.getElementById('scraper-log').innerHTML = '';
  document.getElementById('scraper-stats').innerHTML = '';

  const braveKey = localStorage.getItem('frankieBraveKey');
  const groqKey  = localStorage.getItem('frankieGroqKey');
  let nNews=0, nNuccol=0, nEvents=0, nTenders=0;

  try {
    // ── 1. RSS FEEDS (via proxy) ───────────────────────────────────────────────
    scraperLog('📰 News — fetching ' + RSS_FEEDS.length + ' RSS feeds via proxy…');
    const exNews   = await loadBlob('news')   || [];
    const exNuccol = await loadBlob('nuccol') || [];
    const seenNews   = new Set(exNews.map(x=>x.url));
    const seenNuccol = new Set(exNuccol.map(x=>x.url));
    const newNews=[], newNuccol=[];

    for (const feed of RSS_FEEDS) {
      try {
        const res = await fetch(proxied(feed.url), {signal:AbortSignal.timeout(12000)});
        if (!res.ok) { scraperLog('  ✗ '+feed.source+': HTTP '+res.status,'warn'); continue; }
        const items = parseRSS(await res.text(), feed, seenNews);
        newNews.push(...items);
        scraperLog('  ✓ '+feed.source+': +'+items.length);
      } catch(e) { scraperLog('  ✗ '+feed.source+': '+e.message,'warn'); }
    }

    // ── 2. BRAVE-SOURCED NEWS (proxied) ───────────────────────────────────────
    if (braveKey) {
      scraperLog('🔍 Fetching no-RSS sources via Brave…', 'brave');
      for (const src of BRAVE_NEWS_SOURCES) {
        const isNuccol = src.blob === 'nuccol';
        const seen = isNuccol ? seenNuccol : seenNews;
        try {
          const data = await braveSearch(src.query, braveKey, 8);
          let n=0;
          for (const r of (data.web?.results||[])) {
            if (seen.has(r.url)) continue;
            const item = { title:cleanText(r.title).slice(0,255), url:r.url, source:src.source,
              summary:cleanText(r.description).slice(0,500), category:src.cat,
              date:safeDate(r.page_age), scraped_at:new Date().toISOString() };
            if (isNuccol) { newNuccol.push(item); seenNuccol.add(r.url); }
            else          { newNews.push(item);   seenNews.add(r.url); }
            n++;
          }
          scraperLog('  ✓ '+src.source+' [Brave]: +'+n, 'brave');
          await new Promise(r=>setTimeout(r,800));
        } catch(e) { scraperLog('  ✗ '+src.source+' [Brave]: '+e.message,'warn'); }
      }
    } else {
      scraperLog('  ℹ No-RSS sources skipped — add Brave key in Settings to include ONR, GBE, RR SMR etc.','warn');
    }

    if (newNews.length)   { const merged = [...exNews, ...newNews];     await saveBlob('news.json',        merged); if (window.contentStore) { window.contentStore['news']   = merged;   if (window.contentLoaded) window.contentLoaded['news']   = true; }   nNews=newNews.length; }
    if (newNuccol.length) { const merged = [...exNuccol, ...newNuccol]; await saveBlob('nuccol_news.json', merged); if (window.contentStore) { window.contentStore['nuccol'] = merged;   if (window.contentLoaded) window.contentLoaded['nuccol'] = true; }   nNuccol=newNuccol.length; }
    scraperLog('📰 News done — '+nNews+' new articles, '+nNuccol+' NucCol posts');

    // ── 3. TENDERS — Contracts Finder via proxy ────────────────────────────────
    scraperLog('📋 Tenders — searching Contracts Finder…');
    const exTenders  = await loadBlob('tenders') || [];
    const seenTenders = new Set(exTenders.map(x=>x.url));
    const newTenders=[];
    const CF_URL = proxied('https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json');

    // Circuit breaker: corsproxy.io's free tier rate-limits (429) after enough
    // requests in quick succession, and once it does, EVERY further proxied
    // call in this run will fail too (including FTS's proxy fallback, Brave
    // events, and the external tender portals) — not just the remaining CF
    // terms. Rather than hammering a proxy that's already throttling us and
    // logging a wall of confusing cascading failures, stop on the first 429
    // (after one retry) and skip the other proxy-dependent sections cleanly.
    let proxyRateLimited = false;
    outer:
    for (const [sector, terms] of Object.entries(TENDER_SEARCHES)) {
      for (const term of terms) {
        if (proxyRateLimited) break outer;
        try {
          // statuses includes 'Awarded' alongside 'Open' so award notices come
          // through too — these are the competitor/buyer-intelligence records
          // (who won, for how much), not just live opportunities to bid.
          let r = await fetch(CF_URL, {
            method:'POST',
            headers:{'Content-Type':'application/json','Accept':'application/json'},
            body:JSON.stringify({searchCriteria:{keyword:term,statuses:['Open','Awarded'],types:['Contract','Pipeline']},size:100}),
            signal:AbortSignal.timeout(20000)
          });
          if (r.status === 429) {
            scraperLog('  ⚠ CF "'+term+'": 429 rate-limited by proxy — waiting 4s and retrying once…','warn');
            await new Promise(res=>setTimeout(res,4000));
            r = await fetch(CF_URL, {
              method:'POST',
              headers:{'Content-Type':'application/json','Accept':'application/json'},
              body:JSON.stringify({searchCriteria:{keyword:term,statuses:['Open','Awarded'],types:['Contract','Pipeline']},size:100}),
              signal:AbortSignal.timeout(20000)
            });
          }
          if (r.status === 429) {
            scraperLog('  ✗ CF "'+term+'": still 429 after retry — proxy is rate-limited, stopping remaining tender searches for this run. Try again in a few minutes.','error');
            proxyRateLimited = true;
            break outer;
          }
          if (!r.ok) { scraperLog('  ✗ CF "'+term+'": HTTP '+r.status,'warn'); continue; }
          const data = await r.json();
          let n=0;
          for (const entry of (data.noticeList||[])) {
            const e=entry.item; if (!e) continue;
            const url = e.id ? 'https://www.contractsfinder.service.gov.uk/notice/'+e.id : '';
            if (!url||seenTenders.has(url)) continue;
            if (!(e.title+' '+(e.description||'')).toLowerCase().includes(term.toLowerCase())) continue;
            const lo=parseFloat(e.valueLow)||0, hi=parseFloat(e.valueHigh)||0;
            const noticeType = e.status === 'Awarded' ? 'AWARD' : (e.type === 'Pipeline' ? 'PIN' : 'TENDER');
            if (isStaleTender(e.deadlineDate, noticeType)) continue;
            newTenders.push({ title:cleanText(e.title).slice(0,255), url,
              organisation:cleanText(e.organisationName).slice(0,255),
              description:cleanText(e.description).slice(0,500), sector, noticeType,
              value:(lo||hi)?'GBP '+(hi||lo).toLocaleString():'Not disclosed',
              publishedDate:e.publishedDate||'', closingDate:e.deadlineDate||'',
              scraped_at:new Date().toISOString() });
            seenTenders.add(url); n++;
          }
          if (n) scraperLog('  ✓ "'+term+'": +'+n);
          await new Promise(r=>setTimeout(r,700));
        } catch(e) { scraperLog('  ✗ CF "'+term+'": '+e.message,'warn'); }
      }
    }

    // ── 3b. TENDERS — Find a Tender (FTS) OCDS API, high-value (>£139k) ────────
    // FTS tries a direct (non-proxied) request first, but in-browser that's
    // almost always CORS-blocked, so in practice this falls through to the
    // same rate-limited proxy — skip it if CF already tripped the 429.
    if (proxyRateLimited) {
      scraperLog('  ℹ FTS skipped — proxy rate-limited this run','warn');
    } else {
      await fetchFTSTenders(seenTenders, newTenders);
    }

    // ── 3c. TENDERS — Public Contracts Scotland + Sell2Wales (real APIs) ───────
    if (proxyRateLimited) {
      scraperLog('  ℹ Scotland/Wales portals skipped — proxy rate-limited this run','warn');
    } else {
      scraperLog('📋 Tenders — searching Public Contracts Scotland + Sell2Wales…');
      await fetchKlickstreamPortals(seenTenders, newTenders);
    }

    // ── 3d. TENDERS — external portals (eTendersNI / MOD DCO / Delta / In-tend) ──
    if (proxyRateLimited) {
      scraperLog('  ℹ External tender portals skipped — proxy rate-limited this run','warn');
    } else {
      scraperLog('📋 Tenders — searching NI + defence + e-sourcing portals…');
      await fetchExternalTenderPortals(braveKey, seenTenders, newTenders);
    }

    if (newTenders.length || exTenders.length) {
      // Prune stale entries out of what's already stored too — not just new
      // scrapes — so old closed-out tenders that were saved before this check
      // existed (or that closed since the last run) drop off automatically.
      const prunedEx = exTenders.filter(x => !isStaleTender(x.closingDate, x.noticeType));
      const removed = exTenders.length - prunedEx.length;
      const merged = [...prunedEx, ...newTenders];
      if (newTenders.length || removed) {
        await saveBlob('tenders.json', merged);
        if (window.contentStore) { window.contentStore['tenders'] = merged; if (window.contentLoaded) window.contentLoaded['tenders'] = true; }
      }
      nTenders = newTenders.length;
      if (removed) scraperLog('  🗑 Pruned '+removed+' stale/closed tender(s) from existing list');
    }
    scraperLog('📋 Tenders done — '+nTenders+' new');

    // ── 4. EVENTS — Brave via proxy + Groq ────────────────────────────────────
    if (!braveKey) {
      scraperLog('📅 Events skipped — add Brave key in Settings below','warn');
    } else if (proxyRateLimited) {
      scraperLog('  ℹ Events skipped — proxy rate-limited this run','warn');
    } else {
      scraperLog('📅 Events — Brave search via proxy…','brave');
      const exEvents  = await loadBlob('events') || [];
      const seenEvents = new Set(exEvents.map(x=>x.url));
      const newEvents=[];

      for (const cat of BRAVE_EVENT_CATS) {
        try {
          const q = cat+' industry conference event '+new Date().getFullYear()+' UK';
          const bd = await braveSearch(q, braveKey, 5);
          for (const r of (bd.web?.results||[])) {
            if (seenEvents.has(r.url)) continue;
            let ev = {title:cleanText(r.title).slice(0,255), url:r.url, description:cleanText(r.description).slice(0,500),
              category:cat, event_date:'', location:'', event_type:'In Person',
              organiser:'', scraped_at:new Date().toISOString()};
            if (groqKey) {
              try {
                const gr = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                  method:'POST',
                  headers:{'Authorization':'Bearer '+groqKey,'Content-Type':'application/json'},
                  body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:'Extract event details as JSON {title,description,event_date,location,event_type,organiser} from:\nTitle: '+r.title+'\nSnippet: '+(r.description||'')+'\nReturn ONLY valid JSON.'}],max_tokens:300}),
                  signal:AbortSignal.timeout(15000)
                });
                if (gr.ok) {
                  const gd=await gr.json();
                  const m=(gd.choices?.[0]?.message?.content||'').match(/\{[\s\S]*\}/);
                  if (m) { try { const p=JSON.parse(m[0]); Object.assign(ev,{title:cleanText(p.title||ev.title).slice(0,255),description:cleanText(p.description||ev.description).slice(0,500),event_date:p.event_date||'',location:cleanText(p.location||''),event_type:p.event_type||'In Person',organiser:cleanText(p.organiser||'')}); } catch(pe){} }
                }
              } catch(ge) { /* Groq optional */ }
            }
            newEvents.push(ev); seenEvents.add(r.url);
          }
          scraperLog('  ✓ '+cat,'brave');
          await new Promise(r=>setTimeout(r,1000));
        } catch(e) { scraperLog('  ✗ Events '+cat+': '+e.message,'warn'); }
      }

      if (newEvents.length) { const merged = [...exEvents,...newEvents]; await saveBlob('events.json', merged); if (window.contentStore) { window.contentStore['events'] = merged; if (window.contentLoaded) window.contentLoaded['events'] = true; } nEvents=newEvents.length; }
      scraperLog('📅 Events done — '+nEvents+' new');
    }

    // ── SUMMARY ────────────────────────────────────────────────────────────────
    const rateLimitBadge = proxyRateLimited ? ' <span style="background:#f38ba8;color:#1e1e2e;padding:4px 12px;border-radius:20px;font-size:.82rem;font-weight:600">⚠ Proxy rate-limited — run again in a few minutes</span>' : '';
    document.getElementById('scraper-stats').innerHTML =
      ['📰 +'+nNews+' news','🔵 +'+nNuccol+' NucCol','📅 +'+nEvents+' events','📋 +'+nTenders+' tenders']
      .map(s=>'<span style="background:var(--surface2);padding:4px 12px;border-radius:20px;font-size:.82rem">'+s+'</span>')
      .join(' ') + rateLimitBadge;
    scraperLog('✅ Complete — news:+'+nNews+' nuccol:+'+nNuccol+' events:+'+nEvents+' tenders:+'+nTenders + (proxyRateLimited ? ' (proxy rate-limited partway through — some sections skipped, try again shortly)' : ''));
    toast(proxyRateLimited
      ? 'Scraper hit proxy rate limit — +'+nNews+' news, +'+nTenders+' tenders so far. Try again in a few minutes for the rest.'
      : 'Scraper done: +'+nNews+' news, +'+nNuccol+' NucCol, +'+nEvents+' events, +'+nTenders+' tenders');

    // Re-render whichever content tab is currently active so the editor updates immediately
    if (typeof renderContentList === 'function' && typeof activeContentTab !== 'undefined') {
      renderContentList(activeContentTab);
    }

  } catch(err) { scraperLog('❌ '+err.message,'error'); }

  scraperRunning = false;
  if (btn) { btn.disabled=false; btn.textContent='▶ Run Scraper'; }
}

function saveBraveKey() {
  const key = document.getElementById('brave-key-input')?.value.trim();
  if (key) { localStorage.setItem('frankieBraveKey', key); toast('Brave API key saved'); }
}
