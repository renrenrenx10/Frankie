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

// Groq access is gated by the staff Supabase session and proxied through
// SCC_WORKER's /groq route — same pattern as scc.html's groqCall() for the
// report generator. The Groq API key lives server-side in the Worker; it's
// never held or sent from the browser, so there's no client-side key to
// configure in Settings. Signed-out visitors simply get no AI enrichment —
// scraperGroqCall() returns null and every caller here already treats that
// as "skip, keep going" rather than as an error.
async function scraperGroqCall(prompt, maxTokens) {
  if (!hasStaffSession() || typeof SCC_WORKER === 'undefined') return null;
  try {
    const res = await fetch(SCC_WORKER + '/groq/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sccSession.access_token },
      body: JSON.stringify({
        model: (typeof localStorage !== 'undefined' && localStorage.getItem('frankieGroqModel')) || 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens || 800
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (e) { return null; }
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

// ── REGION DETECTION ─────────────────────────────────────────────────────
// Coarse three-bucket geography (added 2026-09-08) for the Content Editor
// badge / newsletter grouping / members-site filter — deliberately NOT full
// country tagging. Checked against the title+summary text itself (not the
// feed's publisher), so a UK trade-press outlet covering a French EPR still
// tags Europe. Short/ambiguous tokens (uk, us, eu, edf, onr, hse, nda, cgn,
// uae) are matched on word boundaries so they don't fire inside ordinary
// words; longer terms use plain substring matching.
function hasTerm(t, term) {
  if (term.length <= 3) return new RegExp('\\b' + term + '\\b', 'i').test(t);
  return t.includes(term);
}

// A handful of feeds are single-purpose enough that the source alone
// settles it, regardless of what the headline/summary says — e.g. every
// HSE press release is UK Health & Safety Executive business by
// definition. Checked before any keyword matching.
const SOURCE_REGION_OVERRIDES = {
  'HSE': 'UK', 'Sizewell C': 'UK', 'ONR': 'UK',
  'Great British Energy': 'UK', 'Rolls-Royce SMR': 'UK', 'NucCol LinkedIn': 'UK'
};

// US state names — energy/wind trade press headlines routinely name a
// state with no "US"/"United States" wording at all ("Wyoming approves
// 650MW..."), which is otherwise invisible to this gazetteer.
const US_STATES = [
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada',
  'new hampshire','new jersey','new mexico','new york','north carolina',
  'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont',
  'virginia','washington','west virginia','wisconsin','wyoming'
];

const REGION_TERMS = {
  'UK': [
    'uk','united kingdom','britain','british','england','scotland','wales',
    'northern ireland','sellafield','hinkley point','hinkley','sizewell',
    'rolls-royce smr','rolls-royce','onr','desnz','hse','nda',
    'great british energy','gb energy','wylfa','moorside','urenco','magnox',
    'torness','heysham','hunterston','dungeness','whitehall','westminster'
  ],
  'Europe': [
    'europe','european','france','french','edf','framatome','orano','flamanville',
    'germany','german','finland','finnish','olkiluoto','fennovoima','poland','polish',
    'sweden','swedish','vattenfall','netherlands','dutch','belgium','belgian','doel',
    'tihange','czech','slovakia','hungary','paks','romania','cernavoda','spain',
    'spanish','italy','italian','ukraine','ukrainian','zaporizhzhia','switzerland',
    'swiss','norway','norwegian','eu','european union','brussels'
  ],
  'Rest of World': [
    'united states','u.s.','usa','america','american','westinghouse','nuscale',
    'terrapower','x-energy','china','chinese','cnnc','cgn','japan','japanese',
    'tepco','fukushima','south korea','korean','kepco','khnp','india','indian',
    'canada','canadian','bruce power','russia','russian','rosatom','middle east',
    'uae','barakah','saudi','egypt','el dabaa','turkey','akkuyu','australia',
    'australian','asia','asia-pacific','apac',
    ...US_STATES
  ]
};
const REGION_ORDER = ['UK','Europe','Rest of World'];

function regionScores(t) {
  const scores = {};
  for (const region of REGION_ORDER) scores[region] = REGION_TERMS[region].filter(term => hasTerm(t, term)).length;
  return scores;
}

// Title signal wins outright when it unambiguously names one region — a
// dateline/place name in the headline beats a company-nationality mention
// buried in the summary (RWE described as "the German utility" in the body
// text of a story about a *California* lease exit is a US story, not a
// European one). Only when the title itself is ambiguous or silent do we
// fall back to scoring the full text, and a genuine tie there (a round-up
// spanning two regions) is left null rather than guessed — the Groq
// fallback or manual tagging in the Content Editor handles those.
function detectRegion(title, summary, source) {
  if (source && SOURCE_REGION_OVERRIDES[source]) return SOURCE_REGION_OVERRIDES[source];

  const titleText = ' ' + String(title||'').toLowerCase() + ' ';
  const titleScores = regionScores(titleText);
  const titleHits = REGION_ORDER.filter(r => titleScores[r] > 0);
  if (titleHits.length === 1) return titleHits[0];

  const fullText = titleText + String(summary||'').toLowerCase() + ' ';
  const fullScores = regionScores(fullText);
  const maxScore = Math.max(...REGION_ORDER.map(r => fullScores[r]));
  if (maxScore === 0) return null;
  const winners = REGION_ORDER.filter(r => fullScores[r] === maxScore);
  return winners.length === 1 ? winners[0] : null;
}

// detectRegion() above is free/instant but leaves plenty of items untagged
// (no unambiguous place-name signal in the headline/summary). Anything it
// misses gets swept into one batched Groq call per chunk here — only when a
// Groq key is configured in Settings. No key = those items just keep
// region:null and stay editable by hand in the Content Editor (the edit
// modal renders whatever fields exist on the item, so no extra UI needed).
async function classifyRegionsWithGroq(items) {
  const todo = items.filter(i => !i.region);
  if (!todo.length) return;
  const CHUNK = 25;
  for (let c = 0; c < todo.length; c += CHUNK) {
    const chunk = todo.slice(c, c + CHUNK);
    const list = chunk.map((i, idx) => `${idx}: ${i.title} — ${(i.summary||'').slice(0,160)}`).join('\n');
    try {
      const content = await scraperGroqCall(
        'For each numbered news headline below, decide which region it primarily relates to: ' +
        '"UK", "Europe" (non-UK), or "Rest of World". Reply with ONLY a JSON object mapping ' +
        'each number to one of those three exact strings, nothing else.\n\n' + list,
        800
      );
      if (!content) { scraperLog('  ✗ Region classify: no response from Groq worker', 'warn'); continue; }
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const map = JSON.parse(m[0]);
      let tagged = 0;
      chunk.forEach((item, idx) => {
        const region = map[idx] ?? map[String(idx)];
        if (REGION_ORDER.includes(region)) { item.region = region; tagged++; }
      });
      scraperLog('  🌍 Region-tagged '+tagged+'/'+chunk.length+' via Groq');
    } catch (e) { scraperLog('  ✗ Region classify: '+e.message, 'warn'); }
  }
}

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
                          'wastewater treatment'],
  // Added 2026-10-26. Used ONLY when a release carries no CPV at all, and all
  // words are now required as whole words — so these read like real wording.
  'Petrochemical':       ['petrochemical plant','oil refinery','refinery turnaround',
                          'catalytic cracker','process plant shutdown'],
  'Pharma':              ['pharmaceutical plant','cleanroom installation',
                          'sterile manufacturing facility'],
  'Renewables':          ['solar farm construction','battery energy storage',
                          'onshore wind farm','pumped storage hydro']
};

// ── CONTRACTS FINDER SEARCH TERMS ────────────────────────────────────────────
// Separate from TENDER_SEARCHES, added 2026-10-26. CF's server-side keyword
// search does not honour multi-word phrases — it appears to OR the words. The
// first shadow run returned 100 results against hitCounts of 5,000-29,000 with
// NONE containing the phrase, for 'storage tank manufacture', 'North Sea
// decommissioning', 'water industry AMP7', 'petrochemical plant', 'process
// plant shutdown', 'pharmaceutical plant' and 'sterile manufacturing
// facility'; 'precision machining' and 'structural steel fabrication' timed
// out outright. Since every term is one POST per run, phrases spend requests
// on junk.
//
// So: CF gets single distinctive words (~24 requests instead of ~60), and
// TENDER_SEARCHES stays as the classification vocabulary for categTender().
const CF_KEYWORDS = {
  'Nuclear':             ['Sellafield','Sizewell','UKAEA','radioactive','decommissioning'],
  'Manufacturing':       ['machining','fabrication','forgings','castings','weldment','foundry'],
  'Hydrogen':            ['electrolyser','hydrogen'],
  'CCUS':                ['CCUS'],
  'Offshore Renewables': ['turbine'],
  'Petrochemical':       ['refinery','petrochemical'],
  'Pharma':              ['cleanroom'],
  'Rail':                ['signalling'],
  'Oil & Gas':           ['subsea'],
  'Defence':             ['submarine'],
  'Aerospace':           ['airframe'],
  'Water & Utilities':   ['wastewater'],
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
  'Petrochemical': [
    '45253400',                          // petrochemical plant construction
    '45255200',                          // oil refinery construction work
  ],
  'Pharma': [
    '45253500',                          // pharmaceutical plant construction
    '45214631',                          // installation works of cleanrooms
  ],
  'Renewables': [
    '09331','09332',                     // solar panels/modules, solar installation
    '45251140','45251160',               // thermal, wind-power installation works
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
// ── TENDER FILTER, REBUILT 2026-10-26 ───────────────────────────────────────
// Capability is now the GATE; sector is only a LABEL. A notice is kept when an
// F4N member company could make or service the thing, whatever market it sits
// in. That is the inverse of the old design, where a sector match was the
// entry ticket — which is how relevant non-nuclear work was being missed.
//
// The old sectorForRelease() also had a structural fault: a CPV MISS fell
// through to text, so CPV could only ever say "yes". A taxi notice carries CPV
// 60120000, cpvSector() correctly returned null, and the text matcher then
// overrode that correct "no". CPV_SECTORS was never the problem — it was being
// overruled.

// Hard no. Checked first, never reaches text matching. Drawn from the actual
// noise in the 2026-10 sample pull.
const CPV_EXCLUDE = [
  '85',    // Health and social work services
  '80',    // Education and training services
  '75',    // Administration, defence and social security services
  '79',    // Business services: law, marketing, recruitment, printing
  '66',    // Financial and insurance services
  '60',    // Transport services  <- the taxi flood
  '15',    // Food, beverages, tobacco
  '03',    // Agricultural, farming, fishing, forestry
  '18',    // Clothing, footwear, luggage
  '22',    // Printed matter
  '55',    // Hotel, restaurant and retail trade
  '64',    // Postal and telecommunications services
  '65',    // Public utilities (billing/supply, not plant)
  '70',    // Real estate services
  '72',    // IT services
  '77',    // Agricultural, forestry, horticultural services
  '92',    // Recreational, cultural and sporting services
  '98',    // Other community, social and personal services
  '33',    // Medical equipment and pharmaceutical PRODUCTS.
           //   Pharmaceutical PLANT is 45253500 and stays in scope below.
  '48',    // Software packages
  '30',    // Office and computing machinery
  '9091',  // Cleaning services — was '90919', too narrow: it missed the
           //   90910000 parent, which was 8 hits in the first shadow run
  '45453', // Overhaul and refurbishment (housing stock)
  // Added from the 2026-10-26 shadow run histogram:
  '37',    // Musical instruments, sports goods, games, toys
  '63',    // Supporting transport services; travel agencies
  '5042',  // Repair/maintenance of medical and surgical equipment
];

// The gate. Recall-oriented by design: "could one of our companies make or
// service this?" — NOT "is this nuclear?". Curated 2026-10-26 against all
// 9,454 codes in cpv/cpv_2008_xml.zip, children read to confirm homogeneity
// before any short prefix was used.
const CPV_CAPABILITIES = {
  'Machinery & rotating equipment': [
    '42',                 // whole division, minus the 4296 carve-out below
    '43',                 // whole division (incl. casting, foundry, rolling)
    '3111','3112','3113','3116',  // motors, generators, alternators, parts
    '3114',               // cooling towers
  ],
  'Pressure vessels & tanks': [
    // 4461 minus its packaging tail: 44617 (boxes/cartons), 44618 (corks,
    // stoppers, lids, cans), 44619 (cases, barrels, crates) are not
    // fabrication work. NB 35411 is BATTLE TANKS — deliberately not here.
    '44610','44611','44612','44613','44614','44615','44616',
  ],
  'Pipework, valves & fittings': [
    '4213',               // taps, cocks, valves and similar (42 codes)
    '4416',               // pipeline, piping, pipes, casing, tubing (54)
    '4413',               // sewer mains
    '45232','45231200','45231210','45231220',  // pipeline construction work
    '4533',               // plumbing and sanitary works
  ],
  'Fabrication & structural steel': [
    '4421',               // structures and parts of structures (57 codes)
    '4417','4433','4443','4445','4446','4447',
    '45223210',           // structural steelworks
    '45262400','45262410','45262420','45262423','45262425','45262426','45262670',
  ],
  'Welding, coating & surface treatment': [
    '4266',               // soldering, brazing, welding tools, hot-spraying
    '44315',              // welding consumables
    '45262680',           // welding work
    '45442000','45442120','45442200',  // protective coating / painting
    '4294',               // machinery for heat treatment of materials
  ],
  'Castings, forgings & foundry': [
    '4342','4372','4371', // foundry mould-forming, casting, metal-rolling
    '24957100','43415000','43420000',
  ],
  'NDT, inspection & testing': [
    // Explicit codes, not the 7163 block: 71631200 is automobile (MOT) work
    // and 71631300 is building inspection — neither is member capability.
    '71630000','71631000','71631100','71631400','71631430','71631440',
    '71632000','71632100','71632200',
    '7173',               // industrial inspection / quality control services
    '716',                // Technical testing, analysis and consultancy —
                          //   the group parent. All three children (7161
                          //   composition/purity, 7162 analysis, 7163
                          //   technical inspection) were already listed, but
                          //   71600000 itself was dropping as a root code in
                          //   the 3rd shadow run. Added 2026-10-26.
    '5041',               // repair/maintenance of measuring & testing kit
  ],
  'Electrical & instrumentation': [
    '3117','3121','3122','3123',   // transformers, switchgear, circuit parts
    '313',                // insulated wire and cable
    '4431','4432',        // wire products, cable and related products
    '4531',               // electrical installation work
    '38',                 // measuring/testing/navigational instruments.
                          //   Broad — check the shadow histogram and trim to
                          //   3842/3854/3858 if lab/optical noise shows up.
  ],
  'Seals, bearings & fasteners': [
    '4444','4453','4454','4455',   // bearings, fasteners, chain, springs
                          // NB 4452 (locks/keys/hinges) deliberately excluded
                          //   — it reintroduced the door-lock noise.
  ],
  'Plant construction & modular build': [
    '4525',               // plants, mining and manufacturing construction:
                          //   incl. 45251110/11 nuclear power station,
                          //   45253400 petrochemical, 45253500 pharmaceutical,
                          //   45255 oil & gas, 45255200 refinery
    '45214631',           // installation works of cleanrooms
    '4535','4532',        // mechanical installations, insulation work
  ],
  'Machinery repair & maintenance': [
    '5051','5053',        // pumps/valves/taps/metal containers, machinery
    '507',                // building installations M&E — broadened from the
                          //   5071-5075 children, which missed the 50700000
                          //   parent (5 hits in the first shadow run).
                          //   Includes 5076 (public conveniences) — harmless.
    '5043',               // repair/maintenance of precision equipment
    '5024','5022',        // marine vessels, rail vehicles
  ],
  'Engineering & design services': [
    '713',                // consultative/design/misc/integrated engineering +
                          //   engineering-related scientific & technical (124)
    '7155',               // blacksmith services
    '71521','71541',      // construction supervision, construction management
  ],
  'Marine & offshore fabrication': [
    '345',                // ships and boats — broadened from '3451', which
                          //   missed the 34500000 parent
    '45241',              // harbour construction works
    '45262421','45262422','45262424',
    '7652',               // offshore installation / supply services
  ],
};

// Inside division 42 but command/control, printing, graphics and office
// automation — not member capability.
const CPV_CAPABILITY_CARVEOUTS = ['4296'];

function capabilityForCode(cpvCode) {
  if (!cpvCode) return null;
  const digits = String(cpvCode).split('-')[0];
  if (CPV_CAPABILITY_CARVEOUTS.some(p => digits.startsWith(p))) return null;
  for (const [cap, prefixes] of Object.entries(CPV_CAPABILITIES)) {
    if (prefixes.some(p => digits.startsWith(p))) return cap;
  }
  return null;
}

// A CPV that is a bare division/group/class root — 45000000 "Construction
// work", 50000000 "Repair and maintenance services", 90500000 "Refuse and
// waste related services" — carries no information: the buyer filed against a
// top-level parent instead of a real code. In the 2026-10-26 shadow run these
// were ~51 of the 146 codes counted as "unmapped". Treating them as "CPV says
// no" is wrong, but accepting them is worse (45000000 is ALL construction), so
// they fall through to the text matcher and the buyer check instead.
//
// Four or fewer significant digits once trailing zeros are stripped:
//   45000000 -> '45'     = 2 -> uninformative
//   45210000 -> '4521'   = 4 -> uninformative
//   44221100 -> '442211' = 6 -> specific  (windows/doors — stays dropped)
// CPV_EXCLUDE is checked first, so known-noise roots stay hard drops.
function cpvUninformative(cpvCode) {
  const digits = String(cpvCode || '').split('-')[0].replace(/0+$/, '');
  return digits.length > 0 && digits.length <= 4;
}

function cpvExcluded(cpvCode) {
  if (!cpvCode) return false;
  const digits = String(cpvCode).split('-')[0];
  return CPV_EXCLUDE.some(p => digits.startsWith(p));
}

// Highest-signal filter available and previously unused. Nuclear supply chain
// work is identified by WHO IS BUYING far more reliably than by wording:
// "Provision of Scaffolding Services" at Sellafield is member work with no
// nuclear words and CPV 45262100. Move to a blob once it settles so it can be
// edited from SCC without a code change.
const NUCLEAR_BUYERS = [
  'sellafield','nuclear decommissioning authority','nuclear restoration services',
  'nuclear waste services','llw repository','nuclear transport solutions',
  'direct rail services','magnox','dounreay','ukaea','atomic energy authority',
  'national nuclear laboratory','urenco','springfields','westinghouse',
  'nnb gen','sizewell c','rolls royce smr','great british energy',
  'great british nuclear','office for nuclear regulation','awe plc',
  'devonport royal dockyard','babcock marine','cavendish nuclear',
  'doosan babcock','assystem','submarine delivery agency',
  'defence equipment and support','edf energy',
];

function buyerIsNuclear(buyerName) {
  const n = String(buyerName || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  return NUCLEAR_BUYERS.some(b => n.includes(b));
}

// ── Diagnostics ─────────────────────────────────────────────────────────────
const filterStats = {
  seen:0, cpvPresent:0, cpvAbsent:0,
  keptBuyer:0, keptCapability:0, keptCpvSector:0, keptText:0,
  droppedExcluded:0, droppedCpvUnmapped:0, droppedNoText:0,
  cpvUninformativeRoot:0, unmappedCpv:{}, excludedCpv:{}, rootDroppedCpv:{},
  shadowDisagreed:0,
};
function resetFilterStats() {
  Object.assign(filterStats, {
    seen:0, cpvPresent:0, cpvAbsent:0,
    keptBuyer:0, keptCapability:0, keptCpvSector:0, keptText:0,
    droppedExcluded:0, droppedCpvUnmapped:0, droppedNoText:0,
    cpvUninformativeRoot:0, unmappedCpv:{}, excludedCpv:{}, rootDroppedCpv:{},
    shadowDisagreed:0,
  });
}

// 'shadow'  — compute and COUNT the new decision, but RETURN THE OLD ONE.
//             Nothing about what gets saved changes. Start here.
// 'enforce' — act on the new decision.
// Flipped to 'enforce' 2026-10-26 after three shadow runs:
//   - gate 3 (unmapped): every code in the histogram verified as genuine
//     noise across two runs — windows, house construction, pest control,
//     refuse bins, traffic lights, freezers, mains gas
//   - gate 0 (excluded): top 25 verified — education, software, insurance,
//     marketing, IT, cleaning, medical, transport, relocation. No false
//     exclusions, and the two collision bugs that WERE there are fixed
//   - keep rate steady at 11-17% across runs of 195, 580 and 1,358 releases
// Set back to 'shadow' to measure again without changing what gets saved.
const FILTER_MODE = 'enforce';

// The old behaviour, kept so shadow mode can return it and the two compared.
function _sectorForReleaseLegacy(rel) {
  const cls = rel.tender?.classification;
  if (cls?.scheme === 'CPV' && cls.id) {
    const s = cpvSector(cls.id);
    if (s) return s;
  }
  return categTender((rel.tender?.title || '') + ' ' + (rel.tender?.description || ''));
}

// Returns null to DROP, or { sector, capability, gate } to KEEP.
// sector may be null on a keep — a buyer or capability match is reason enough.
function classifyRelease(rel) {
  filterStats.seen++;
  const cls   = rel.tender?.classification;
  const cpv   = (cls?.scheme === 'CPV' && cls.id) ? cls.id : null;
  const text  = (rel.tender?.title || '') + ' ' + (rel.tender?.description || '');
  const buyer = rel.buyer?.name || '';
  if (cpv) filterStats.cpvPresent++; else filterStats.cpvAbsent++;

  let decision = null;

  // Gate 0 — hard no, UNLESS a curated list explicitly claims the code.
  // FIXED 2026-10-26 (after the 2nd shadow run): broad exclusion prefixes were
  // shadowing codes deliberately curated into CPV_SECTORS. '98' killed
  // 98113100 nuclear safety services; '60' killed 60651600 offshore supply
  // ship services; '75' killed 75220000/75221000/75222000 defence services;
  // '65' killed the whole 651xx water distribution block; '48' and '72' killed
  // the aviation software codes; '5061' killed 50610000 inside Defence's '506'.
  // A curated capability or sector match now always beats a broad exclusion,
  // so adding an exclude prefix can never silently delete curated coverage.
  if (cpv && cpvExcluded(cpv) && !capabilityForCode(cpv) && !cpvSector(cpv)) {
    filterStats.droppedExcluded++;
    const ek = String(cpv).split('-')[0];
    filterStats.excludedCpv[ek] = (filterStats.excludedCpv[ek] || 0) + 1;
  } else if (buyerIsNuclear(buyer)) {                 // Gate 1 — buyer wins
    filterStats.keptBuyer++;
    decision = { sector:'Nuclear', capability: cpv ? capabilityForCode(cpv) : null, gate:'buyer' };
  } else {
    const capability = cpv ? capabilityForCode(cpv) : null;
    const cpvSec     = cpv ? cpvSector(cpv) : null;

    // Gate 2 — a CPV that maps to a CAPABILITY or to a SECTOR is a keep.
    // FIXED 2026-10-26: this used to test capability only, which silently
    // dropped every curated sector-specific code — 24111600 (hydrogen),
    // 09340/09341/09343 (nuclear fuels, uranium, radioactive materials),
    // 90521 (radioactive waste services), 98113100 (nuclear safety services),
    // 35113xxx (radiological protection equipment). The first shadow run
    // caught 24111600 sitting in the "unmapped" histogram, which is how this
    // was spotted. The capability map ADDS recall; it does not replace
    // CPV_SECTORS.
    if (capability || cpvSec) {
      if (capability) filterStats.keptCapability++; else filterStats.keptCpvSector++;
      decision = {
        sector: cpvSec || categTender(text) || null,
        capability,
        gate: capability ? 'cpv-capability' : 'cpv-sector',
      };
    }
    // Gate 3 — a SPECIFIC CPV that maps to nothing is a decision. Drop.
    else if (cpv && !cpvUninformative(cpv)) {
      filterStats.droppedCpvUnmapped++;
      const k = String(cpv).split('-')[0];
      filterStats.unmappedCpv[k] = (filterStats.unmappedCpv[k] || 0) + 1;
    }
    // Gate 4 — no CPV at all, OR an uninformative root code. Fall through to
    // the text matcher rather than dropping on a code that says nothing.
    else {
      if (cpv) filterStats.cpvUninformativeRoot++;
      const sector = categTender(text);
      if (sector) {
        filterStats.keptText++;
        decision = { sector, capability:null, gate: cpv ? 'root-text' : 'text' };
      } else {
        filterStats.droppedNoText++;
        if (cpv) {
          const rk = String(cpv).split('-')[0];
          filterStats.rootDroppedCpv[rk] = (filterStats.rootDroppedCpv[rk] || 0) + 1;
        }
      }
    }
  }

  const legacy = _sectorForReleaseLegacy(rel);
  if (!!legacy !== !!decision) filterStats.shadowDisagreed++;
  if (FILTER_MODE === 'shadow') {
    return legacy ? { sector: legacy, capability:null, gate:'legacy' } : null;
  }
  return decision;
}

function logFilterStats() {
  const s = filterStats;
  const kept = s.keptBuyer + s.keptCapability + s.keptCpvSector + s.keptText;
  const dropped = s.droppedExcluded + s.droppedCpvUnmapped + s.droppedNoText;
  scraperLog('── FILTER DIAGNOSTICS ('+FILTER_MODE+' mode) ──');
  scraperLog('  releases seen        : '+s.seen);
  scraperLog('  CPV present / absent : '+s.cpvPresent+' / '+s.cpvAbsent);
  scraperLog('  WOULD KEEP           : '+kept+'   (buyer '+s.keptBuyer+
             ', capability '+s.keptCapability+', cpv-sector '+s.keptCpvSector+
             ', text '+s.keptText+')');
  scraperLog('  uninformative roots  : '+s.cpvUninformativeRoot+
             '   (fell through to text, not dropped on the code)');
  scraperLog('  WOULD DROP           : '+dropped+'   (excluded '+s.droppedExcluded+
             ', CPV unmapped '+s.droppedCpvUnmapped+', no text match '+s.droppedNoText+')');
  scraperLog('  differs from current : '+s.shadowDisagreed);
  // All three drop buckets are reported. The exclusion bucket is the largest
  // (71% of releases in the 2nd shadow run) and was previously invisible — if
  // an exclude prefix is too broad, this histogram is the only place it shows.
  function hist(label, obj, limit) {
    const top = Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0, limit);
    if (!top.length) return top;
    scraperLog('  ' + label);
    top.forEach(([code,n]) => scraperLog('    '+String(n).padStart(4)+'  '+code));
    return top;
  }
  const tU = hist('top CPV dropped as UNMAPPED (triage into capability/exclude):', s.unmappedCpv, 25);
  const tE = hist('top CPV dropped as EXCLUDED (check none of these belong):',     s.excludedCpv, 25);
  const tR = hist('top CPV dropped as ROOT + no text match:',                      s.rootDroppedCpv, 15);
  try {
    console.table(tU.map(([cpv,count])=>({bucket:'unmapped',cpv,count}))
      .concat(tE.map(([cpv,count])=>({bucket:'excluded',cpv,count})))
      .concat(tR.map(([cpv,count])=>({bucket:'root',cpv,count}))));
  } catch(e){}
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
      summary:sum.slice(0,500), category:cat, region:detectRegion(title, sum, feed.source),
      date:safeDate(pub), scraped_at:new Date().toISOString() });
    seenUrls.add(url);
  }
  return results;
}

// Brave search — routed through corsproxy.io so it works from localhost
async function braveSearch(query, braveKey, count) {
  const q = encodeURIComponent(query);
  if (hasStaffSession() && typeof SCC_WORKER !== 'undefined') {
    const res = await fetch(SCC_WORKER + '/brave/res/v1/web/search?q=' + q + '&count=' + (count||10), {
      headers: { Authorization: 'Bearer ' + sccSession.access_token },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error('Brave HTTP ' + res.status);
    return res.json();
  }
  // Signed-out fallback — best-effort only, see note above.
  const targetUrl = 'https://api.search.brave.com/res/v1/web/search?q=' + q + '&count=' + (count||10);
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
// Words too generic to carry meaning inside a phrase. 'and' and 'non' were
// the live offenders: the old filter(w => w.length > 2) kept both, so
// 'castings and forgings' and 'non-destructive testing' half-matched on them.
const TERM_STOPWORDS = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'non']);

// Precompiled once per term — otherwise this is a lot of RegExp construction
// per run (~60 terms x every notice x every word).
const _termCache = new Map();
function _termWords(term) {
  let w = _termCache.get(term);
  if (!w) {
    w = term.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
      .filter(x => x.length > 2 && !TERM_STOPWORDS.has(x))
      // Light plural/tense tolerance, so 'pressure vessel manufacture' still
      // matches 'manufacture of pressure vessels'.
      .map(x => new RegExp('\\b' + x + '(s|es|ing|ed)?\\b'));
    _termCache.set(term, w);
  }
  return w;
}

// REWRITTEN 2026-10-26. The old version matched if HALF the words (rounded up)
// appeared anywhere as SUBSTRINGS — so every 2-word term degenerated into an
// OR of its two words, matched unanchored. Measured over a 1,342-record live
// pull: 'armoured vehicle' fired on "vehicle" 148 times, 'train maintenance'
// on "maintenance" 113 times, 'nuclear safety' on "safety", 'radioactive
// waste' on "waste", 'sewage treatment' on "treatment". Substring hits
// included "Window"->wind, "wellbeing"->well, "Training"->train,
// "Checkpoint"->point, "Cellular"->cell. All 1,342 were false positives.
// Now: ALL significant words, each as a WHOLE word.
function termMatches(text, term) {
  // Normalise punctuation to spaces on BOTH sides, so 'non-destructive
  // testing' matches 'non destructive testing' and vice versa.
  const t = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const rx = _termWords(term);
  if (!rx.length) return false;
  return rx.every(r => r.test(t));
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
          const cl = classifyRelease(rel);
          if (!cl) continue;
          const sector = cl.sector;
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
            capability: cl.capability || '', filterGate: cl.gate,
            cpv: (rel.tender?.classification?.scheme === 'CPV' ? rel.tender.classification.id : ''),
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
          const cl = classifyRelease(rel);
          if (!cl) continue;
          const sector = cl.sector;
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
            capability: cl.capability || '', filterGate: cl.gate,
            cpv: (rel.tender?.classification?.scheme === 'CPV' ? rel.tender.classification.id : ''),
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
  if (!hasStaffSession() && !braveKey) { scraperLog('  ℹ External portals (eTendersNI/MOD DCO/Delta/In-tend) skipped — sign in or add a Brave key in Settings','warn'); return; }
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
  // Groq itself needs no client-side key — see scraperGroqCall(): it's
  // gated on the signed-in staff session and proxied through SCC_WORKER,
  // same as everywhere else Groq is used in scc.html.
  let nNews=0, nNuccol=0, nEvents=0, nTenders=0;
  resetFilterStats();

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

    // ── 2. BRAVE-SOURCED NEWS (via Worker when signed in, else proxied) ───────
    if (hasStaffSession() || braveKey) {
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
              region:detectRegion(cleanText(r.title), cleanText(r.description), src.source),
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
      scraperLog('  ℹ No-RSS sources skipped — sign in or add a Brave key in Settings to include ONR, GBE, RR SMR etc.','warn');
    }

    if (hasStaffSession() && (newNews.some(i => !i.region) || newNuccol.some(i => !i.region))) {
      scraperLog('🌍 Region — classifying items with no keyword match via Groq…');
      await classifyRegionsWithGroq(newNews);
      await classifyRegionsWithGroq(newNuccol);
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
    for (const [sector, terms] of Object.entries(CF_KEYWORDS)) {
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

    // ── 4. EVENTS — Brave via Worker/proxy + Groq ─────────────────────────────
    if (!hasStaffSession() && !braveKey) {
      scraperLog('📅 Events skipped — sign in or add a Brave key in Settings below','warn');
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
            if (hasStaffSession()) {
              try {
                const content = await scraperGroqCall('Extract event details as JSON {title,description,event_date,location,event_type,organiser} from:\nTitle: '+r.title+'\nSnippet: '+(r.description||'')+'\nReturn ONLY valid JSON.', 300);
                if (content) {
                  const m=content.match(/\{[\s\S]*\}/);
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

    logFilterStats();

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
