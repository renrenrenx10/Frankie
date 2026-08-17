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
  'Nuclear':             ['Sellafield','Hinkley Point','Sizewell','nuclear decommissioning','small modular reactor','nuclear power station','Nuclear Decommissioning Authority'],
  // Generic manufacturing/engineering contract types — these are what NucCol's
  // supply chain members (fabricators, machine shops, valve/vessel makers,
  // surface treatment, NDT etc.) actually bid for, and most of them never
  // mention "nuclear" in the notice text even when the end customer is Sellafield/
  // EDF/RR SMR. See scc.html Granted-company list for the capability mix this
  // is drawn from (filtration, plating, cable cleats, structural steel, valves,
  // heat exchangers, containment systems, bearings, fabrication, castings).
  'Manufacturing':       ['precision machining','CNC machining','structural steel fabrication','sheet metal fabrication',
                          'stainless steel fabrication','welding fabrication','pressure vessel manufacture',
                          'heat exchanger manufacture','valve manufacture','pipework fabrication',
                          'castings and forgings','non-destructive testing','metal surface treatment',
                          'storage tank manufacture','precision engineering'],
  'Hydrogen':            ['hydrogen production','green hydrogen','electrolyser','fuel cell','HyNet'],
  'CCUS':                ['carbon capture','CCUS','direct air capture','CO2 storage'],
  'Offshore Renewables': ['offshore wind','floating wind','wind farm','tidal energy'],
  'Fusion':              ['nuclear fusion','UKAEA','STEP programme','tokamak'],
  // Cross-sector: F4N companies are engineering/manufacturing SMEs first and
  // nuclear suppliers second — the same fabrication/machining/NDT/valve/casting
  // capability that wins nuclear work is directly biddable in these sectors too,
  // and diversification revenue is part of the point of the F4N programme.
  'Rail':                ['rolling stock manufacture','railway signalling','Network Rail framework','rail depot maintenance',
                          'rail infrastructure','train maintenance','rail vehicle overhaul'],
  'Oil & Gas':           ['oil and gas','offshore platform','subsea engineering','pipeline construction',
                          'refinery maintenance','North Sea decommissioning','FPSO','topside fabrication'],
  'Defence':             ['Ministry of Defence','naval shipbuilding','submarine build','defence engineering support',
                          'armoured vehicle','MOD equipment support','warship maintenance'],
  'Aerospace':           ['aerospace component manufacture','aircraft structures','aerospace machining','MRO aviation'],
  'Water & Utilities':   ['water treatment infrastructure','wastewater treatment works','water industry AMP7',
                          'utilities infrastructure maintenance']
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
  // stages covers planning (PIN — early warning before a tender opens), tender
  // (live opportunities) and award (who won, for how much — competitor/buyer
  // intelligence, same as the AWARD notices in a Contracts Advance digest).
  const path = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=planning,tender,award&limit=25&updatedFrom=' + since;
  // FTS is a real gov.uk open-data API and may allow direct cross-origin GETs —
  // try that first (no proxy, no size cap) and only fall back to the proxy if
  // it's blocked or fails.
  const attempts = [ {url: path, label:'direct'}, {url: proxied(path), label:'proxy'} ];
  for (const attempt of attempts) {
    try {
      const r = await fetch(attempt.url, { headers:{'Accept':'application/json'}, signal:AbortSignal.timeout(20000) });
      if (!r.ok) { scraperLog('  ✗ FTS ('+attempt.label+'): HTTP '+r.status,'warn'); continue; }
      const data = await r.json();
      let n = 0;
      const releases = data.releases||[];
      for (const rel of releases) {
        const t = rel.tender; if (!t) continue;
        const sector = categTender((t.title||'') + ' ' + (t.description||''));
        if (!sector) continue;
        const url = 'https://www.find-tender.service.gov.uk/Notice/' + rel.id;
        if (!rel.id || seenTenders.has(url)) continue;
        const buyer = (rel.parties||[]).find(p => (p.roles||[]).includes('buyer'));
        const tags = rel.tag || [];
        const noticeType = tags.includes('award') ? 'AWARD' : (tags.includes('planning') ? 'PIN' : 'TENDER');
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
          value, publishedDate: rel.date||'', closingDate: (t.tenderPeriod && t.tenderPeriod.endDate) || '',
          scraped_at:new Date().toISOString() });
        seenTenders.add(url); n++;
      }
      scraperLog('  ✓ FTS ('+attempt.label+'): +'+n+' (of '+releases.length+' releases checked)');
      return;
    } catch(e) { scraperLog('  ✗ FTS ('+attempt.label+'): '+e.message,'warn'); }
  }
}

// ── TENDER SOURCE 3: portals with no public API/RSS ──────────────────────────────
// Devolved-nation portals (Scotland/Wales/NI), MOD Defence Contracts Online /
// Defence Sourcing Portal, and the Delta eSourcing / In-tend e-sourcing platforms
// (used by most English councils, NHS trusts and housing associations) don't
// expose a reliable keyword API or a documented RSS query string, so (like ONR/
// GBE/RR SMR above) these are covered via Brave Search through the proxy.
// MOD DCO/DSP is included specifically because defence manufacturing (machining,
// fabrication, castings/forgings, NDT, surface treatment) draws on the same
// supplier capability set as nuclear — real bid-relevant volume outside energy.
const BRAVE_TENDER_SOURCES = [
  {site:'publiccontractsscotland.gov.uk', source:'Public Contracts Scotland'},
  {site:'sell2wales.gov.wales',           source:'Sell2Wales'},
  {site:'etendersni.gov.uk',              source:'eTenders NI'},
  {site:'contracts.mod.uk',               source:'MOD Defence Contracts Online'},
  {site:'delta-esourcing.com',            source:'Delta eSourcing'},
  {site:'in-tend.co.uk',                  source:'In-tend'},
];

async function fetchExternalTenderPortals(braveKey, seenTenders, newTenders) {
  if (!braveKey) { scraperLog('  ℹ External portals (PCS/Sell2Wales/eTendersNI/MOD DCO/Delta/In-tend) skipped — add Brave key in Settings','warn'); return; }
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

    for (const [sector, terms] of Object.entries(TENDER_SEARCHES)) {
      for (const term of terms) {
        try {
          // statuses includes 'Awarded' alongside 'Open' so award notices come
          // through too — these are the competitor/buyer-intelligence records
          // (who won, for how much), not just live opportunities to bid.
          const r = await fetch(CF_URL, {
            method:'POST',
            headers:{'Content-Type':'application/json','Accept':'application/json'},
            body:JSON.stringify({searchCriteria:{keyword:term,statuses:['Open','Awarded'],types:['Contract','Pipeline']},size:100}),
            signal:AbortSignal.timeout(20000)
          });
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
            newTenders.push({ title:cleanText(e.title).slice(0,255), url,
              organisation:cleanText(e.organisationName).slice(0,255),
              description:cleanText(e.description).slice(0,500), sector, noticeType,
              value:(lo||hi)?'GBP '+(hi||lo).toLocaleString():'Not disclosed',
              publishedDate:e.publishedDate||'', closingDate:e.deadlineDate||'',
              scraped_at:new Date().toISOString() });
            seenTenders.add(url); n++;
          }
          if (n) scraperLog('  ✓ "'+term+'": +'+n);
          await new Promise(r=>setTimeout(r,500));
        } catch(e) { scraperLog('  ✗ CF "'+term+'": '+e.message,'warn'); }
      }
    }

    // ── 3b. TENDERS — Find a Tender (FTS) OCDS API, high-value (>£139k) ────────
    await fetchFTSTenders(seenTenders, newTenders);

    // ── 3c. TENDERS — external portals (devolved / MOD DCO / Delta / In-tend) ──
    scraperLog('📋 Tenders — searching devolved + defence + e-sourcing portals…');
    await fetchExternalTenderPortals(braveKey, seenTenders, newTenders);

    if (newTenders.length) { const merged = [...exTenders,...newTenders]; await saveBlob('tenders.json', merged); if (window.contentStore) { window.contentStore['tenders'] = merged; if (window.contentLoaded) window.contentLoaded['tenders'] = true; } nTenders=newTenders.length; }
    scraperLog('📋 Tenders done — '+nTenders+' new');

    // ── 4. EVENTS — Brave via proxy + Groq ────────────────────────────────────
    if (!braveKey) {
      scraperLog('📅 Events skipped — add Brave key in Settings below','warn');
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
    document.getElementById('scraper-stats').innerHTML =
      ['📰 +'+nNews+' news','🔵 +'+nNuccol+' NucCol','📅 +'+nEvents+' events','📋 +'+nTenders+' tenders']
      .map(s=>'<span style="background:var(--surface2);padding:4px 12px;border-radius:20px;font-size:.82rem">'+s+'</span>')
      .join(' ');
    scraperLog('✅ Complete — news:+'+nNews+' nuccol:+'+nNuccol+' events:+'+nEvents+' tenders:+'+nTenders);
    toast('Scraper done: +'+nNews+' news, +'+nNuccol+' NucCol, +'+nEvents+' events, +'+nTenders+' tenders');

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
