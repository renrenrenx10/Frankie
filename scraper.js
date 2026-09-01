// scraper.js — browser-based content scraper for Frankie SCC
// News/events/RSS calls go through corsproxy.io to handle CORS from localhost.
// Tender API calls (CF/FTS/PCS/Sell2Wales) prefer the gated Cloudflare Worker
// (SCC_WORKER, defined in scc.html) when a staff session is active — see the
// GOV_SOURCES block below — and fall back to corsproxy.io only when signed out.

const PROXY = 'https://api.allorigins.win/raw?url=';
const proxied = url => PROXY + encodeURIComponent(url);

// ── GOV TENDER API ROUTING ───────────────────────────────────────────────────
// SCC_WORKER's /cf, /fts, /pcs, /sell2wales routes (ch-proxy-worker.js,
// 2026-08-18) are a real server-to-server passthrough to these public gov
// APIs: no CORS, no POST-body mangling (the specific way corsproxy.io broke
// Contracts Finder's search), no shared-proxy rate limit. They require the
// same staff Supabase session already used for the blob routes (SCC_WORKER,
// sccSession — both globals from scc.html, which loads before this file).
// With no active session the worker would 401, so fall back to corsproxy.io
// straight to the public API — fine for the GET-only sources (FTS/PCS/
// Sell2Wales), degraded but functional for CF's POST search (see cfFetch).
const GOV_SOURCES = {
  cf:  'https://www.contractsfinder.service.gov.uk',
  fts: 'https://www.find-tender.service.gov.uk',
  pcs: 'https://api.publiccontractsscotland.gov.uk',
  s2w: 'https://api.sell2wales.gov.wales',
};
const WORKER_PREFIX = { cf: '/cf', fts: '/fts', pcs: '/pcs', s2w: '/sell2wales' };

function hasStaffSession() {
  return typeof sccSession !== 'undefined' && !!sccSession?.access_token;
}

// Resolve a gov-API path+query (or a full URL — pagination `links.next`
// cursors come back as absolute URLs) to a fetchable {url, headers} pair.
function govApiUrl(key, pathOrUrl) {
  const base = GOV_SOURCES[key];
  const pathAndQuery = pathOrUrl.startsWith(base) ? pathOrUrl.slice(base.length) : pathOrUrl;
  if (hasStaffSession() && typeof SCC_WORKER !== 'undefined') {
    return { url: SCC_WORKER + WORKER_PREFIX[key] + pathAndQuery, headers: { Authorization: 'Bearer ' + sccSession.access_token } };
  }
  return { url: proxied(base + pathAndQuery), headers: {} };
}
function rssUrl(feedUrl) {
  if (hasStaffSession() && typeof SCC_WORKER !== 'undefined') {
    return { url: SCC_WORKER + '/rss?url=' + encodeURIComponent(feedUrl), headers: { Authorization: 'Bearer ' + sccSession.access_token } };
  }
  return { url: proxied(feedUrl), headers: {} };
}

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
  // NOTE: each term here = one POST request for Contracts Finder per scraper
  // run (now routed through the gated Worker when signed in — see cfFetch —
  // so the old ~50-70 request corsproxy.io rate-limit ceiling no longer
  // applies to a signed-in run; it still applies to the signed-out fallback
  // path, so keep the list high-signal rather than exhaustive regardless).
  // These terms also double as the client-side text filter for FTS/PCS/
  // Sell2Wales/Brave-covered portals (see categTender()) — expanded
  // 2026-08-18 to catch real notices that CPV-code matching (see
  // CPV_SECTORS below) also doesn't cover cleanly, or as a second signal
  // alongside it.
  'Nuclear':             ['Sellafield','Hinkley Point','Sizewell','nuclear decommissioning','small modular reactor',
                          'radioactive waste','nuclear safety'],
  // Generic manufacturing/engineering contract types — these are what NucCol's
  // supply chain members (fabricators, machine shops, valve/vessel makers,
  // surface treatment, NDT etc.) actually bid for, and most of them never
  // mention "nuclear" in the notice text even when the end customer is Sellafield/
  // EDF/RR SMR. See scc.html Granted-company list for the capability mix this
  // is drawn from (filtration, plating, cable cleats, structural steel, valves,
  // heat exchangers, containment systems, bearings, fabrication, castings).
  'Manufacturing':       ['precision machining','structural steel fabrication','pressure vessel manufacture',
                          'valve manufacture','castings and forgings','non-destructive testing',
                          'storage tank manufacture','CNC machining','metal fabrication','foundry',
                          'welding fabrication'],
  'Hydrogen':            ['hydrogen production','electrolyser','HyNet','fuel cell','green hydrogen'],
  'CCUS':                ['carbon capture','CCUS','CO2 capture','carbon dioxide storage'],
  'Offshore Renewables': ['offshore wind','floating wind','wind turbine','wind farm construction'],
  'Fusion':              ['nuclear fusion','UKAEA STEP programme','tokamak','fusion energy'],
  // Cross-sector: F4N companies are engineering/manufacturing SMEs first and
  // nuclear suppliers second — the same fabrication/machining/NDT/valve/casting
  // capability that wins nuclear work is directly biddable in these sectors too,
  // and diversification revenue is part of the point of the F4N programme.
  'Rail':                ['rolling stock manufacture','railway signalling','rail depot maintenance',
                          'railway infrastructure','train maintenance'],
  'Oil & Gas':           ['offshore platform','subsea engineering','North Sea decommissioning',
                          'well decommissioning','pipeline construction'],
  'Defence':             ['naval shipbuilding','defence engineering support','MOD equipment support',
                          'submarine','armoured vehicle'],
  'Aerospace':           ['aerospace component manufacture','MRO aviation','aircraft component','airframe'],
  'Water & Utilities':   ['water treatment infrastructure','water industry AMP7','sewage treatment',
                          'wastewater treatment']
};

// ── CPV CODE SECTOR MAP ──────────────────────────────────────────────────────
// CPV (Common Procurement Vocabulary) codes are the EU/UK-standard structured
// classification every OCDS release carries under tender.classification
// (scheme "CPV"). They catch real sector-relevant notices that literal
// phrase-matching above misses because free-text titles/descriptions are
// worded unpredictably — e.g. a real live example: an AMRC "Fibre Reinforced
// Thermoplastic Tape Winding Equipment Upgrade" tender (genuinely pressure-
// vessel/composites manufacturing work) carries CPV 42000000 "Industrial
// machinery" but contains none of our literal terms. Curated 2026-08-18 from
// the official CPV 2008 code list (cpv/cpv_2008_xml.zip in this repo) —
// verified against all ~9,450 codes to contain zero cross-sector collisions
// (see scratch validation). Sectors with no clean dedicated CPV code (CCUS,
// Fusion) are intentionally omitted here and rely on text terms only. Prefix
// length varies per entry: short prefixes are used only where the whole CPV
// sub-block is genuinely homogeneous (e.g. '346' is exclusively railway
// rolling stock — verified); noisier parent blocks (e.g. tanks/containers
// under '4461', which also covers unrelated packaging like corks and food
// cans) are listed as explicit longer codes instead to avoid false positives.
const CPV_SECTORS = {
  'Nuclear': [
    '09340','09341','09343',             // nuclear fuels, uranium, radioactive materials
    '4215',                              // nuclear reactors and parts (clean block)
    '45251110','45251111',               // nuclear-power station / reactor construction
    '90521',                             // radioactive waste services (excludes 90523 non-radioactive)
    '98113100',                          // nuclear safety services
    '35113110','35113200','35113210','35113420', // nuclear/radiological protection equipment
  ],
  'Manufacturing': [
    '4213',                              // valves/taps/actuators (clean block)
    '44610000','44611400','44615',       // tanks/pressure vessels (explicit — parent has packaging noise)
    '45223210',                          // structural steelworks
    '45262400','45262410','45262420','45262423','45262425','45262426','45262670', // structural steel erection / metalworking
    '71632200','71631',                  // NDT + technical inspection services
    '43415000','43420000','24957100',    // foundry moulds/machinery/binders
    '42610000','42611000','42612',       // machining centres / machine tools
    '42662','44315100','44315200','45262680','45442000','45442120','45442200', // welding + protective coating
  ],
  'Hydrogen': ['24111600','31122100'],
  'Offshore Renewables': [
    '311213',                            // windmills/wind turbines/generators/wind farm
    '45262421','45262424',               // offshore mooring / offshore-module fabrication
    '7652','60651600',                   // offshore installation/supply services
  ],
  'Rail': [
    '346',                               // railway/tramway locomotives, rolling stock, parts (clean block)
    '3494',                              // railway equipment/track materials
    '45234',                             // construction work for railways (clean block)
    '5022',                              // repair/maintenance of locomotives/rolling stock
    '71311230',                          // railway engineering services
  ],
  'Oil & Gas': [
    '4313','34514',                      // drilling/production platforms & equipment incl. subsea (clean block)
    '4416',                              // pipelines/piping (clean block)
    '45231200','45231210','45231220',    // construction work for oil/gas pipelines
    '45255',                             // oil & gas industry construction — platforms/wells/refinery/terminal/drilling (clean block)
    '76300000','76310000','76320000','76330000','76331000','76340000', // drilling services
    '76430','76600000','76121000',       // well-drilling/production services, pipeline/subsea inspection
    '45262422',                          // subsea drilling work
    '44161400','44161410',               // underwater/subsea pipelines
  ],
  'Defence': [
    '354','355','356','357',             // military vehicles/warships/aircraft/electronic systems (clean blocks)
    '506','5084',                        // repair/maintenance of defence materiel & weapon systems (508 alone catches unrelated 5080-5088x "misc repair" junk)
    '7342','7343',                       // military R&D / test & evaluation
    '75220000','75221000','75222000',    // defence services
  ],
  'Aerospace': [
    '347',                               // civil aircraft/spacecraft, parts, equipment (clean block)
    '5021',                              // repair/maintenance of aircraft
    '4813',                              // aviation ground support/test software
    '7221213',                           // aviation software development services
  ],
  'Water & Utilities': [
    '651',                               // water distribution (clean, small block)
    '45231300','45232100','45232150',    // water/sewage pipeline construction
    '45245',                             // dredging/pumping for water treatment plant
    '45252',                             // sewage/purification treatment plant construction
    '45259100',                          // wastewater-plant repair/maintenance
    '904',                               // sewage services (clean block)
    '90733400',                          // surface water treatment services
    '42996',                             // sewage treatment machinery
  ],
};

function cpvSector(cpvCode) {
  if (!cpvCode) return null;
  const digits = String(cpvCode).split('-')[0];
  for (const [sector, prefixes] of Object.entries(CPV_SECTORS)) {
    if (prefixes.some(p => digits.startsWith(p))) return sector;
  }
  return null;
}

// CPV first (precise, catches unpredictable wording), text terms as fallback.
function sectorForRelease(rel) {
  const cls = rel.tender?.classification;
  if (cls?.scheme === 'CPV' && cls.id) {
    const s = cpvSector(cls.id);
    if (s) return s;
  }
  return categTender((rel.tender?.title || '') + ' ' + (rel.tender?.description || ''));
}

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

// Whether `text` is relevant to a (possibly multi-word) search term.
// Deliberately NOT an exact-phrase substring check. Verified live
// (2026-08-18) against a real CF response for "storage tank manufacture"
// (hitCount 8763, size:100): 0 of 100 results contained the exact phrase,
// and 0 contained all 3 words — CF's own relevance ranking is a loose,
// word-overlap match, not phrase-based, so real notices like "Supply of
// Glass Fused Steel Tanks" or "Framework agreement for the manufacture...
// of storage" are genuinely relevant but were being discarded by a strict
// `.includes(fullTermPhrase)` check. That check was silently returning zero
// matches for every multi-word term (this one and likely others already in
// TENDER_SEARCHES, not just newly-added ones) without ever surfacing as an
// error — it just looked like "no results this run". Require a majority of
// the term's significant words instead: forgiving of word order and
// pluralisation/tense differences while still filtering out results that
// only share one incidental word (e.g. "tank" alone matching an unrelated
// aquarium refit).
function termMatches(text, term) {
  const t = text.toLowerCase();
  const words = term.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length <= 1) return t.includes(term.toLowerCase());
  const matched = words.filter(w => t.includes(w)).length;
  return matched >= Math.ceil(words.length / 2);
}

// Shared sector classifier for every keyword-less tender source (FTS, PCS,
// Sell2Wales, Brave-covered portals) — Contracts Finder has real server-side
// keyword search and doesn't need this.
function categTender(text) {
  const t = cleanText(text);
  for (const [sector, terms] of Object.entries(TENDER_SEARCHES)) {
    if (terms.some(term => termMatches(t, term))) return sector;
  }
  return null;
}

// Winning supplier(s), appended to the description for competitor intel —
// only populated on AWARD releases (CF/FTS/PCS/Sell2Wales all carry this
// under awards[].suppliers[]).
function awardSuppliers(rel) {
  return (rel.awards || []).flatMap(a => (a.suppliers || []).map(s => s.name)).filter(Boolean);
}

// ── TENDER SOURCE 2: Find a Tender (FTS) — official OCDS API, >£139k contracts ──
// No keyword param on this API — pull releases per stage and filter
// client-side via sectorForRelease() (CPV code, falling back to
// categTender()). Three separate requests (tender/planning/award) because a
// combined stages=list returned 0 releases when proxied (the comma likely
// doesn't survive some proxy query-string handling). Confirmed live
// (2026-08-18): release.id is the notice's human-facing ID
// (https://www.find-tender.service.gov.uk/Notice/<id>), release.tag is an
// array ('tender'/'planning'/['award','contract']), award releases carry the
// winning supplier under awards[].suppliers[].name, and `limit` is capped at
// 100 server-side (200 returns 400 Bad Request).
//
// Paging strategy (rewritten 2026-08-18): a single run used to always
// restart at "most recent N days, page 1" and only look 4×25=100 releases
// deep — so anything past page 4 was permanently invisible, every run,
// forever, not just missed once. Now each stage persists its links.next
// cursor in a small blob (fts-progress.json) and resumes from there next
// run, sweeping deeper into the window over successive runs instead of
// resampling the same top slice. When a stage's cursor runs out
// (links.next === null) the window is exhausted and the next run starts a
// fresh one from FTS_LOOKBACK_DAYS ago — cheap per run, cumulative coverage
// over time, and bounded (never walks back through years of history).
const FTS_STAGES = ['tender', 'planning', 'award'];
const FTS_PAGE_LIMIT = 100; // API max, confirmed live
const FTS_MAX_PAGES = 10;   // per run, per stage — up to 1,000 releases/stage/run (was 100)
const FTS_LOOKBACK_DAYS = 30; // window used only when starting a fresh sweep

function ftsNoticeType(tag) {
  if (!Array.isArray(tag)) return 'TENDER';
  if (tag.includes('award')) return 'AWARD';
  if (tag.includes('planning')) return 'PIN';
  return 'TENDER';
}

async function fetchFTS(seenTenders, newTenders) {
  scraperLog('📋 Tenders — Find a Tender (FTS)…');
  const progress = (await loadBlob2('fts-progress.json')) || {};
  let progressChanged = false;
  for (const stage of FTS_STAGES) {
    const resuming = !!progress[stage]?.next;
    let pathOrUrl = progress[stage]?.next;
    if (!pathOrUrl) {
      const updatedFrom = new Date(Date.now() - FTS_LOOKBACK_DAYS*24*60*60*1000).toISOString().split('.')[0];
      pathOrUrl = `/api/1.0/ocdsReleasePackages?stages=${stage}&limit=${FTS_PAGE_LIMIT}&updatedFrom=${updatedFrom}`;
    }
    let n = 0, pages = 0, lastNext = null;
    for (let page = 0; page < FTS_MAX_PAGES && pathOrUrl; page++) {
      try {
        const { url, headers } = govApiUrl('fts', pathOrUrl);
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
        if (!r.ok) { scraperLog('  ✗ FTS ['+stage+'] page '+(page+1)+': HTTP '+r.status, 'warn'); break; }
        const data = await r.json();
        pages++;
        for (const rel of (data.releases || [])) {
          const noticeType = ftsNoticeType(rel.tag);
          const sector = sectorForRelease(rel);
          if (!sector) continue;
          const title = rel.tender?.title || '';
          const description = rel.tender?.description || '';
          const noticeUrl = rel.id ? 'https://www.find-tender.service.gov.uk/Notice/' + rel.id : '';
          if (!noticeUrl || seenTenders.has(noticeUrl)) continue;
          const closingDate = rel.tender?.tenderPeriod?.endDate || '';
          if (isStaleTender(closingDate, noticeType)) continue;
          const val = rel.tender?.value;
          const suppliers = awardSuppliers(rel);
          newTenders.push({
            title: cleanText(title).slice(0,255), url: noticeUrl,
            organisation: cleanText(rel.buyer?.name || '').slice(0,255),
            description: cleanText(description + (suppliers.length ? ' | Awarded to: '+suppliers.join(', ') : '')).slice(0,500),
            sector, noticeType,
            value: val?.amount ? (val.currency||'GBP')+' '+Number(val.amount).toLocaleString() : 'Not disclosed',
            publishedDate: safeDate(rel.date), closingDate,
            scraped_at: new Date().toISOString()
          });
          seenTenders.add(noticeUrl); n++;
        }
        lastNext = data.links?.next || null;
        pathOrUrl = lastNext;
        await new Promise(res => setTimeout(res, 400));
      } catch(e) { scraperLog('  ✗ FTS ['+stage+']: '+e.message, 'warn'); break; }
    }
    progress[stage] = lastNext ? { next: lastNext } : null;
    progressChanged = true;
    scraperLog('  ✓ FTS ['+stage+']: +'+n+' (scanned '+pages+' page'+(pages===1?'':'s')+
      (resuming ? ', resumed' : ', new window') + (lastNext ? ', more remaining next run' : ', window complete') + ')');
  }
  if (progressChanged) { try { await saveBlob('fts-progress.json', progress); } catch(e) { scraperLog('  ✗ FTS — failed to save paging progress: '+e.message, 'warn'); } }
}

// ── TENDER SOURCE 3: Public Contracts Scotland + Sell2Wales — same vendor ──────
// (Klickstream), same OCDS-shaped API as FTS. locale is mandatory — omitting
// it causes a genuine 500 from their own backend (reproduced through two
// different proxy paths, so it's not a proxy issue). dateFrom only accepts a
// single calendar month, so query the current month per notice type (1=PIN,
// 2=Contract Notice, 3=Award) — three requests per portal.
// NOTE (confirmed live 2026-08-18): both portals' /v1/Notices endpoint is
// currently returning HTTP 500 ("Error converting data type nvarchar to
// float") even on their own documented example query — a genuine upstream
// outage, not a parameter mistake here. Implemented per the documented spec
// (matches their published API docs exactly) and wrapped in the same
// per-request try/catch as every other source, so this degrades to a logged
// warning rather than breaking the run; it should start working again on its
// own once Klickstream fixes their backend.
const KLICKSTREAM_SOURCES = [
  { key:'pcs', source:'Public Contracts Scotland', urlBase:'https://www.publiccontractsscotland.gov.uk/Search/Search_Switch.aspx?ID=' },
  { key:'s2w', source:'Sell2Wales',                 urlBase:'https://www.sell2wales.gov.wales/search/search_switch.aspx?ID=' },
];
const KLICKSTREAM_NOTICE_TYPES = [
  { code:1, noticeType:'PIN' },
  { code:2, noticeType:'TENDER' },
  { code:3, noticeType:'AWARD' },
];

// Human-facing notice links use the numeric ID that's the last segment of
// the OCID after the final '-' — confirmed working for Sell2Wales.
function ocidToId(ocid) {
  const parts = String(ocid || '').split('-');
  return parts[parts.length - 1] || '';
}

async function fetchKlickstream(seenTenders, newTenders) {
  const now = new Date();
  const dateFrom = String(now.getMonth()+1).padStart(2,'0') + '-' + now.getFullYear();
  for (const src of KLICKSTREAM_SOURCES) {
    let total = 0;
    for (const nt of KLICKSTREAM_NOTICE_TYPES) {
      const pathAndQuery = `/v1/Notices?dateFrom=${dateFrom}&noticeType=${nt.code}&outputType=0&locale=2057`;
      try {
        const { url, headers } = govApiUrl(src.key, pathAndQuery);
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
        if (!r.ok) { scraperLog('  ✗ '+src.source+' ['+nt.noticeType+']: HTTP '+r.status, 'warn'); continue; }
        const data = await r.json();
        let n = 0;
        for (const rel of (data.releases || [])) {
          const sector = sectorForRelease(rel);
          if (!sector) continue;
          const title = rel.tender?.title || '';
          const description = rel.tender?.description || '';
          const id = ocidToId(rel.ocid);
          const noticeUrl = id ? src.urlBase + id : '';
          if (!noticeUrl || seenTenders.has(noticeUrl)) continue;
          const closingDate = rel.tender?.tenderPeriod?.endDate || '';
          if (isStaleTender(closingDate, nt.noticeType)) continue;
          const val = rel.tender?.value;
          const suppliers = awardSuppliers(rel);
          newTenders.push({
            title: cleanText(title).slice(0,255), url: noticeUrl,
            organisation: cleanText(rel.buyer?.name || '').slice(0,255),
            description: cleanText(description + (suppliers.length ? ' | Awarded to: '+suppliers.join(', ') : '')).slice(0,500),
            sector, noticeType: nt.noticeType,
            value: val?.amount ? (val.currency||'GBP')+' '+Number(val.amount).toLocaleString() : 'Not disclosed',
            publishedDate: safeDate(rel.date), closingDate,
            scraped_at: new Date().toISOString()
          });
          seenTenders.add(noticeUrl); n++;
        }
        total += n;
        await new Promise(res => setTimeout(res, 400));
      } catch(e) { scraperLog('  ✗ '+src.source+' ['+nt.noticeType+']: '+e.message, 'warn'); }
    }
    scraperLog('  ✓ '+src.source+': +'+total);
  }
}

// ── TENDER SOURCE 4: portals with no keyword API — covered via Brave Search ──
// eTendersNI (different platform, no public API), MOD Defence Contracts
// Online / Defence Sourcing Portal (JAGGAER ONE, session-token URLs — not
// scrapable statelessly), and In-tend (per-council/NHS-trust subdomains, no
// central API) don't expose a reliable keyword API, so these are covered via
// Brave Search through the proxy. MOD DCO/DSP is included specifically
// because defence manufacturing (machining, fabrication, castings/forgings,
// NDT, surface treatment) draws on the same supplier capability set as
// nuclear — real bid-relevant volume outside energy. PCS/Sell2Wales moved out
// of this list (2026-08-18) — they now have a real API integration above
// (fetchKlickstream). Delta eSourcing checked manually (2026-08-18): its
// current marketing site (delta-esourcing.com) no longer surfaces a no-login
// keyword search form/GET-parameterized results page — kept here as a Brave
// fallback rather than built against an unverified endpoint.
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
  // already come through CF. What these portals actually add is local/
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
        const { url: reqUrl, headers: reqHeaders } = rssUrl(feed.url);
        const res = await fetch(reqUrl, {headers: reqHeaders, signal:AbortSignal.timeout(12000)});
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

    if (newNews.length)   { const merged = [...exNews, ...newNews];     await saveBlob('news.json',        merged); if (typeof contentStore !== 'undefined') { contentStore['news']   = merged;   if (typeof contentLoaded !== 'undefined') contentLoaded['news']   = true; }   nNews=newNews.length; }
    if (newNuccol.length) { const merged = [...exNuccol, ...newNuccol]; await saveBlob('nuccol_news.json', merged); if (typeof contentStore !== 'undefined') { contentStore['nuccol'] = merged;   if (typeof contentLoaded !== 'undefined') contentLoaded['nuccol'] = true; }   nNuccol=newNuccol.length; }
    scraperLog('📰 News done — '+nNews+' new articles, '+nNuccol+' NucCol posts');

    // ── 3. TENDERS — Contracts Finder ──────────────────────────────────────────
    scraperLog('📋 Tenders — searching Contracts Finder…');
    const exTenders  = await loadBlob('tenders') || [];
    const seenTenders = new Set(exTenders.map(x=>x.url));
    const newTenders=[];
    const cfViaWorker = hasStaffSession();

    // Prefer the gated Worker (real server-to-server POST — no CORS, no
    // body-mangling) when signed in. Signed-out fallback: thingproxy.
    // freeboard.io forwards the POST body/Content-Type intact where
    // corsproxy.io was confirmed NOT to (CF silently fell back to its
    // unfiltered index — uniform score:1 on every result, unrelated titles —
    // rather than erroring), so try thingproxy first and corsproxy.io second.
    async function cfFetch(body) {
      const opts = { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, body, signal:AbortSignal.timeout(20000) };
      if (cfViaWorker) {
        const { url, headers } = govApiUrl('cf', '/api/rest/2/search_notices/json');
        return fetch(url, { ...opts, headers: { ...opts.headers, ...headers } });
      }
      const CF_TARGET = GOV_SOURCES.cf + '/api/rest/2/search_notices/json';
      try {
        const r = await fetch('https://thingproxy.freeboard.io/fetch/' + CF_TARGET, opts);
        if (r.ok || r.status === 429) return r;
      } catch(e) { /* thingproxy unreachable — fall back below */ }
      return fetch(proxied(CF_TARGET), opts);
    }

    // Circuit breaker: corsproxy.io's free tier rate-limits (429) after enough
    // requests in quick succession, and once it does, EVERY further proxied
    // call in this run will fail too (including Brave events and the external
    // tender portals) — not just the remaining CF terms. Only matters when
    // signed out (cfViaWorker false) — the Worker path doesn't share this
    // fate, so FTS/PCS/Sell2Wales run regardless. Stop on the first 429
    // (after one retry) and skip the other proxy-dependent sections cleanly.
    let proxyRateLimited = false;
    let cfConfirmedWorking = false; // sanity check — see note below
    outer:
    for (const [sector, terms] of Object.entries(TENDER_SEARCHES)) {
      for (const term of terms) {
        if (proxyRateLimited) break outer;
        try {
          // statuses includes 'Awarded' alongside 'Open' so award notices come
          // through too — these are the competitor/buyer-intelligence records
          // (who won, for how much), not just live opportunities to bid.
          const reqBody = JSON.stringify({searchCriteria:{keyword:term,statuses:['Open','Awarded'],types:['Contract','Pipeline']},size:100});
          let r = await cfFetch(reqBody);
          if (r.status === 429) {
            scraperLog('  ⚠ CF "'+term+'": 429 rate-limited by proxy — waiting 4s and retrying once…','warn');
            await new Promise(res=>setTimeout(res,4000));
            r = await cfFetch(reqBody);
          }
          if (r.status === 429) {
            scraperLog('  ✗ CF "'+term+'": still 429 after retry — proxy is rate-limited, stopping remaining tender searches for this run. Try again in a few minutes.','error');
            proxyRateLimited = true;
            break outer;
          }
          if (!r.ok) { scraperLog('  ✗ CF "'+term+'": HTTP '+r.status,'warn'); continue; }
          const data = await r.json();
          const raw = data.noticeList || [];
          const hitCount = data.hitCount || 0;
          let n = 0, matched = 0;
          for (const entry of raw) {
            const e = entry.item; if (!e) continue;
            const isRelevant = termMatches(e.title+' '+(e.description||''), term);
            if (isRelevant) matched++; else continue;
            const url = e.id ? 'https://www.contractsfinder.service.gov.uk/notice/'+e.id : '';
            if (!url||seenTenders.has(url)) continue;
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
          if (matched) cfConfirmedWorking = true;
          // Real signal for the documented failure mode (proxy silently
          // drops the POST body and CF falls back to its generic unfiltered
          // index): a large raw hit count where literally none of the
          // returned results mention the search term. NOTE: a uniform
          // relevance `score` across results is NOT a reliable signal on its
          // own — confirmed live (2026-08-18) that CF returns score:1
          // uniformly even on fully relevant, genuinely keyword-filtered
          // results routed through the gated Worker, so that check (used in
          // an earlier version of this file) produced false alarms on every
          // working request and has been replaced with this one.
          if (raw.length >= 10 && matched === 0 && hitCount > 5000) {
            scraperLog('  ⚠ CF "'+term+'": '+raw.length+' results (hitCount '+hitCount+'), none mention "'+term+'" — search may not be filtering','warn');
          }
          if (n) scraperLog('  ✓ "'+term+'": +'+n);
          await new Promise(r=>setTimeout(r,700));
        } catch(e) { scraperLog('  ✗ CF "'+term+'": '+e.message,'warn'); }
      }
    }
    scraperLog(cfViaWorker
      ? (cfConfirmedWorking ? '  ✓ CF ran via the gated Worker — genuine keyword-relevant results confirmed' : '  ℹ CF ran via the gated Worker — no term-relevant results this run')
      : (cfConfirmedWorking ? '  ✓ CF ran via public proxy fallback (no staff session) — genuine keyword-relevant results confirmed' : '  ℹ CF ran via public proxy fallback (no staff session) — sign in for reliable results'));

    // ── 3b. TENDERS — Find a Tender + PCS/Sell2Wales, via the gated Worker ─────
    // These don't share fate with the corsproxy.io circuit breaker above (they
    // route through SCC_WORKER when signed in), so they run regardless of
    // proxyRateLimited.
    await fetchFTS(seenTenders, newTenders);
    await fetchKlickstream(seenTenders, newTenders);

    // ── 3c. TENDERS — external portals (eTendersNI / MOD DCO / Delta / In-tend) ──
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
        if (typeof contentStore !== 'undefined') { contentStore['tenders'] = merged; if (typeof contentLoaded !== 'undefined') contentLoaded['tenders'] = true; }
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

      if (newEvents.length) { const merged = [...exEvents,...newEvents]; await saveBlob('events.json', merged); if (typeof contentStore !== 'undefined') { contentStore['events'] = merged; if (typeof contentLoaded !== 'undefined') contentLoaded['events'] = true; } nEvents=newEvents.length; }
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
