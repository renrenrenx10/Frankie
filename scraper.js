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
  'Hydrogen':            ['hydrogen production','green hydrogen','electrolyser','fuel cell','HyNet'],
  'CCUS':                ['carbon capture','CCUS','direct air capture','CO2 storage'],
  'Offshore Renewables': ['offshore wind','floating wind','wind farm','tidal energy'],
  'Fusion':              ['nuclear fusion','UKAEA','STEP programme','tokamak']
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
    const title = item.querySelector('title')?.textContent?.trim() || '';
    const rawLink = item.querySelector('link');
    const rawUrl = (rawLink?.textContent?.trim() || rawLink?.getAttribute('href') || '').trim();
    const url = rawUrl.replace(/([^:])(\/\/+)/g, '$1/');
    const sum  = item.querySelector('description,summary,content')?.textContent?.trim() || '';
    const pub  = item.querySelector('pubDate,published,updated')?.textContent?.trim() || '';
    if (!url || seenUrls.has(url)) continue;
    const cat = feed.filter ? autoCateg(title + ' ' + sum) : feed.cat;
    if (!cat) continue;
    results.push({ title:title.slice(0,255), url, source:feed.source,
      summary:sum.replace(/<[^>]+>/g,'').slice(0,500), category:cat,
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
            const item = { title:(r.title||'').slice(0,255), url:r.url, source:src.source,
              summary:(r.description||'').slice(0,500), category:src.cat,
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
          const r = await fetch(CF_URL, {
            method:'POST',
            headers:{'Content-Type':'application/json','Accept':'application/json'},
            body:JSON.stringify({searchCriteria:{keyword:term,statuses:['Open'],types:['Contract','Pipeline']},size:100}),
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
            newTenders.push({ title:(e.title||'').slice(0,255), url,
              organisation:(e.organisationName||'').slice(0,255),
              description:(e.description||'').slice(0,500), sector,
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
            let ev = {title:r.title.slice(0,255), url:r.url, description:(r.description||'').slice(0,500),
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
                  if (m) { try { const p=JSON.parse(m[0]); Object.assign(ev,{title:(p.title||ev.title).slice(0,255),description:(p.description||ev.description).slice(0,500),event_date:p.event_date||'',location:p.location||'',event_type:p.event_type||'In Person',organiser:p.organiser||''}); } catch(pe){} }
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
