
// ── Knowledge base retrieval ──────────────────────────────────────────────────
// Hybrid search: blends keyword (BM25-style) + vector (cosine similarity).
// Multi-partition: supplier, toolkit, regs, reactors.
// Graph entity boosting: known entities in query → pinned chunk IDs.

// ── Partition config ──────────────────────────────────────────────────────────

const PARTITIONS = [
    { kb: './kb/frankie7_supplier_kb.json',  vectors: './kb/frankie7_supplier_vectors.json', lazy: false, name: 'supplier'  },
    { kb: './kb/frankie_toolkit_kb.json',    vectors: './kb/frankie_toolkit_vectors.json',   lazy: false, name: 'toolkit'   },
    { kb: './kb/frankie_regs_kb.json',       vectors: null,  /* 243MB — keyword only */      lazy: false, name: 'regs'      },
    { kb: './kb/frankie_reactors_kb.json',   vectors: null,  /* 2.1GB — graph + keyword */   lazy: true,  name: 'reactors'  },
];

const GRAPH_FILE   = './kb/frankie_graph.json';
const VECTOR_DIMS  = 1536;  // all new vectors built at full 1536 dims

// Blend weight: 0 = pure keyword, 1 = pure vector. 0.6 favours semantic.
const VECTOR_WEIGHT  = 0.6;
const KEYWORD_WEIGHT = 0.4;

// Score boost for chunks pinned by graph entity match
const GRAPH_BOOST = 3.0;

// ── Caches ────────────────────────────────────────────────────────────────────

let kbCache        = null;   // all non-lazy chunks
let reactorsCache  = null;   // lazy-loaded reactors chunks
let vectorIndex    = null;   // Map<id, Float32Array> — supplier + toolkit only
let graphCache     = null;   // frankie_graph.json

// ── Triggers for lazy reactors load ──────────────────────────────────────────

const NUCLEAR_SIGNALS = [
    'reactor', 'nuclear', 'onr', 'nrc', 'iaea', 'gda', 'fsar', 'dcd', 'pcsr',
    'sap ', ' tag ', 'containment', 'coolant', 'pressuriser', 'fuel assembly',
    'ap1000', 'ap300', 'ap600', 'apr1400', 'abwr', 'bwrx', 'esbwr', 'nuscale',
    'rolls-royce smr', 'rr smr', 'uk epr', 'hinkley', 'us-apwr', 'us epr',
    'safety analysis', 'safety case', 'design basis', 'seismic', 'psa',
    'westinghouse', 'ge-hitachi', 'framatome', 'kepco', 'mitsubishi',
    'stainless steel', 'zircaloy', 'inconel', 'rpv', 'crdm', 'eccs',
    'wano', 'inpo', 'nei ', 'nureg',
];

function isNuclearQuery(query) {
    const ql = query.toLowerCase();
    return NUCLEAR_SIGNALS.some(s => ql.includes(s));
}

// ── Entity extraction from query ──────────────────────────────────────────────

const SAP_CODE_RE  = /\b(EKP|EME|ECS|ERC|ESS|ERL|FA|FB|FC|FD|FP|FS|FT|HR|LC|MS|NS|OM|PC|PE|SC|SR|SS|ST|SY|TR|TS)\.\d+(?:\.\d+)?\b/gi;
const TAG_CODE_RE  = /\bns[-\s]?tast[-\s]?gd[-\s]?\d+\b/gi;
const NUREG_RE     = /\bNUREG[-/]?\d{4}(?:[-/]\d+)?\b/gi;

const REACTOR_ALIASES = {
    'AP1000':        ['ap1000', 'ap-1000'],
    'AP300':         ['ap300', 'ap-300'],
    'AP600':         ['ap600', 'ap-600'],
    'APR1400':       ['apr1400', 'apr-1400'],
    'ABWR':          ['abwr', 'advanced boiling water'],
    'BWRX300':       ['bwrx-300', 'bwrx300', 'bwrx 300'],
    'ESBWR':         ['esbwr'],
    'NuScale_US460': ['nuscale', 'us460', 'voygr'],
    'RR_SMR':        ['rolls-royce smr', 'rr smr', 'rrsmr'],
    'UK_EPR':        ['uk epr', 'hinkley', 'edf gw'],
    'US_APWR':       ['us-apwr', 'us apwr', 'mitsubishi apwr'],
    'US_EPR':        ['us epr', 'areva epr'],
};

const F4N_ALIASES = {
    'strategy':         ['strategy & leadership', 'strategic leadership', 'sl-01'],
    'people':           ['people excellence', 'sqep', 'competency framework'],
    'ops_manufacturing':['process excellence', 'lean', '5s', 'sop', 'continuous improvement'],
    'qhse':             ['qhse', 'quality management', 'health and safety', 'iso 9001', 'iso 19443'],
    'supply_chain':     ['supply chain', 'procurement', 'supplier performance', 'social value'],
    'design_pm':        ['design & pm', 'project management', 'design review'],
};

const MATERIAL_ENTITIES = [
    'stainless steel', 'carbon steel', 'inconel', 'zircaloy', 'nickel alloy',
    'austenitic', 'ferritic', 'hastelloy', 'titanium alloy',
];

const COMPONENT_ENTITIES = [
    'reactor pressure vessel', 'rpv', 'steam generator', 'pressuriser',
    'control rod drive', 'crdm', 'eccs', 'containment structure',
    'primary circuit', 'secondary circuit', 'spent fuel pool',
    'diesel generator', 'reactor coolant pump',
];

const STANDARD_ENTITIES = [
    'iso 9001', 'iso 19443', 'iso 3834', 'rcc-m', 'asme section iii',
    'n286', 'ieee', 'iec 61513', 'en 13480',
];

function extractQueryEntities(query) {
    const entities = new Set();
    const ql = query.toLowerCase();

    // SAP codes  e.g. EKP.1, MS.4
    for (const m of query.matchAll(SAP_CODE_RE)) {
        entities.add(m[0].toUpperCase());
        entities.add(`sap:${m[0].toUpperCase()}`);
    }
    // TAG codes  e.g. ns-tast-gd-013
    for (const m of query.matchAll(TAG_CODE_RE)) {
        const norm = m[0].toLowerCase().replace(/\s+/g, '-');
        entities.add(norm);
        entities.add(`tag:${norm}`);
    }
    // NUREG numbers
    for (const m of query.matchAll(NUREG_RE)) {
        entities.add(m[0].toUpperCase());
    }
    // Reactor names
    for (const [reactorId, aliases] of Object.entries(REACTOR_ALIASES)) {
        if (aliases.some(a => ql.includes(a))) {
            entities.add(reactorId);
            entities.add(`reactor:${reactorId}`);
        }
    }
    // F4N pillars
    for (const [pillar, aliases] of Object.entries(F4N_ALIASES)) {
        if (aliases.some(a => ql.includes(a))) {
            entities.add(pillar);
            entities.add(`f4n:${pillar}`);
        }
    }
    // Materials
    for (const mat of MATERIAL_ENTITIES) {
        if (ql.includes(mat)) {
            entities.add(mat);
            entities.add(`material:${mat.replace(/ /g, '_')}`);
        }
    }
    // Components
    for (const comp of COMPONENT_ENTITIES) {
        if (ql.includes(comp)) {
            entities.add(comp);
            entities.add(`component:${comp.replace(/ /g, '_')}`);
        }
    }
    // Standards
    for (const std of STANDARD_ENTITIES) {
        if (ql.includes(std)) {
            entities.add(std);
            entities.add(`standard:${std.replace(/ /g, '_')}`);
        }
    }
    // Regulatory bodies
    for (const rb of ['ONR', 'NRC', 'IAEA', 'INPO', 'WANO', 'NEI']) {
        if (ql.includes(rb.toLowerCase())) {
            entities.add(rb);
            entities.add(`regbody:${rb}`);
        }
    }

    return [...entities];
}

// ── Graph loader ──────────────────────────────────────────────────────────────

async function loadGraph() {
    if (graphCache) return graphCache;
    try {
        const r = await fetch(GRAPH_FILE);
        if (!r.ok) return null;
        graphCache = await r.json();
        console.log(`Frankie: graph loaded — ${graphCache.meta.total_nodes} nodes, ${graphCache.meta.entity_keys} entity keys`);
    } catch (e) {
        console.warn('Frankie: graph not available —', e.message);
        graphCache = null;
    }
    return graphCache;
}

// ── KB loaders ────────────────────────────────────────────────────────────────

async function loadPartitionKb(partition) {
    try {
        const r = await fetch(partition.kb);
        if (!r.ok) return [];
        const data = await r.json();
        const chunks = Array.isArray(data) ? data : (data.chunks || []);
        console.log(`Frankie: loaded ${partition.name} KB — ${chunks.length.toLocaleString()} chunks`);
        return chunks;
    } catch (e) {
        console.warn(`Frankie: failed to load ${partition.name} KB —`, e.message);
        return [];
    }
}

async function loadKnowledgeBase(includeReactors = false) {
    // Always load non-lazy partitions
    if (!kbCache) {
        const eager = PARTITIONS.filter(p => !p.lazy);
        const datasets = await Promise.all(eager.map(loadPartitionKb));
        kbCache = datasets.flat().map((c, i) => {
            if (!c.id) c.id = `auto_${i}`;
            return c;
        });
    }

    // Lazy-load reactors on first nuclear query
    if (includeReactors && !reactorsCache) {
        const reactorPartition = PARTITIONS.find(p => p.name === 'reactors');
        if (reactorPartition) {
            reactorsCache = await loadPartitionKb(reactorPartition);
            reactorsCache = reactorsCache.map((c, i) => {
                if (!c.id) c.id = `reactor_auto_${i}`;
                return c;
            });
        }
    }

    return includeReactors && reactorsCache
        ? [...kbCache, ...reactorsCache]
        : kbCache;
}

// ── Vector loader (supplier + toolkit only) ───────────────────────────────────

async function loadVectors() {
    if (vectorIndex) return vectorIndex;
    vectorIndex = new Map();

    const vectorPartitions = PARTITIONS.filter(p => p.vectors);
    for (const partition of vectorPartitions) {
        try {
            const r = await fetch(partition.vectors);
            if (!r.ok) continue;
            const data = await r.json();
            let loaded = 0;
            for (const entry of (data.vectors || [])) {
                vectorIndex.set(entry.id, new Float32Array(entry.vector));
                loaded++;
            }
            console.log(`Frankie: loaded ${loaded.toLocaleString()} vectors from ${partition.name} (${data.model})`);
        } catch (e) {
            console.warn(`Frankie: failed to load ${partition.name} vectors —`, e.message);
        }
    }

    return vectorIndex.size > 0 ? vectorIndex : null;
}

// ── Embedding query via OpenAI ────────────────────────────────────────────────

const EMBED_TIMEOUT_MS = 10000;
const WORKER_URL = 'https://ch.rene-dorset.workers.dev';

async function embedQuery(query) {
    if (localStorage.getItem('frankieEmbedEnabled') === 'false') return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

    try {
        const response = await fetch(`${WORKER_URL}/embed/v1/embeddings`, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'text-embedding-3-small',
                input: query.slice(0, 8000),
                encoding_format: 'float'
                // No dimensions override — stored vectors are full 1536 dims
            })
        });

        if (!response.ok) {
            console.warn(`Frankie: embedQuery HTTP ${response.status} — falling back to keyword`);
            return null;
        }

        const data = await response.json();
        if (!data?.data?.[0]?.embedding) return null;

        window.TM?.log({
            api: 'openai-embed', model: 'text-embedding-3-small',
            prompt_tokens: data.usage?.prompt_tokens || 0,
            source: 'frankie', note: 'embed'
        });
        return new Float32Array(data.data[0].embedding);

    } catch (err) {
        if (err.name !== 'AbortError') console.warn('Frankie: embedQuery failed —', err.message);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosine(a, b) {
    const len = Math.min(a.length, b.length);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < len; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

// ── Score normalisation ───────────────────────────────────────────────────────

export function normaliseScore(raw) {
    return typeof raw === 'number' ? Math.max(0, Math.min(raw / 10, 1)) : 0;
}

// ── Keyword scoring ───────────────────────────────────────────────────────────

function tokenize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function keywordScore(tokens, chunk) {
    const searchable = (
        (chunk.text || '') + ' ' +
        (chunk.section || '') + ' ' +
        (chunk.source_file || '') + ' ' +
        (chunk.category || '') + ' ' +
        (chunk.reactor_type || '') + ' ' +
        (chunk.regulatory_body || '')
    ).toLowerCase();
    return tokens.reduce((score, token) => {
        const matches = searchable.match(new RegExp(`\\b${token}\\b`, 'g'));
        return score + (matches ? matches.length : 0);
    }, 0);
}

// ── Tier access rules ─────────────────────────────────────────────────────────

const TIER_RULES = {
    free:   { excludeReferenceOnly: true,  allowedAudiences: new Set(['company', 'both', '']) },
    member: { excludeReferenceOnly: false, allowedAudiences: null }
};

function getActiveTier() {
    return localStorage.getItem('frankieTier') || 'free';
}

function chunkAllowedForTier(chunk, tier) {
    const rules = TIER_RULES[tier] || TIER_RULES.free;
    if (rules.excludeReferenceOnly && chunk.reference_only) return false;
    if (rules.allowedAudiences && !rules.allowedAudiences.has(chunk.audience || '')) return false;
    return true;
}

export function getGatedCount(results) {
    return results.filter(r => !chunkAllowedForTier(r, 'free')).length;
}

export function clearKbCache() {
    kbCache       = null;
    reactorsCache = null;
    vectorIndex   = null;
    graphCache    = null;
}

export async function getKbStats() {
    const chunks = await loadKnowledgeBase(false);
    const reactors = reactorsCache || [];
    const allChunks = [...chunks, ...reactors];
    const sourceFiles = new Set(allChunks.map(c => c.source || c.source_file).filter(Boolean));
    const legacyCount = allChunks.filter(c =>
        c.programme_version && c.programme_version.startsWith('legacy')
    ).length;
    return {
        totalChunks: allChunks.length,
        sourceFiles:  sourceFiles.size,
        legacyCount,
        reactorsLoaded: reactorsCache !== null,
    };
}

// ── Main search export ────────────────────────────────────────────────────────

export async function searchKnowledgeBase(query, maxSources = 5) {
    const nuclear = isNuclearQuery(query);

    // Load in parallel: KB chunks, vectors, graph
    const [chunks, vectors, graph] = await Promise.all([
        loadKnowledgeBase(nuclear),
        loadVectors(),
        loadGraph(),
    ]);

    const tier   = getActiveTier();
    const tokens = tokenize(query);

    // ── Graph entity boost ────────────────────────────────────────────────────
    const boostedIds = new Set();
    if (graph) {
        const entities = extractQueryEntities(query);
        for (const entity of entities) {
            const ids = graph.entity_index[entity] || [];
            ids.slice(0, 300).forEach(id => boostedIds.add(id));
        }
        if (boostedIds.size > 0) {
            console.log(`Frankie: graph boosted ${boostedIds.size} chunks via [${extractQueryEntities(query).slice(0,5).join(', ')}]`);
        }
    }

    // Filter by tier
    const allowedChunks = chunks.filter(c => chunkAllowedForTier(c, tier));

    // Detect gated hits (for upsell prompt)
    const allScored = chunks.map(chunk => ({
        ...chunk,
        score: keywordScore(tokens, chunk)
    }));

    // Get query embedding if vectors are available
    let queryVec = null;
    if (vectors && query.trim()) {
        queryVec = await embedQuery(query);
    }

    // Score all allowed chunks
    const scored = allowedChunks.map(chunk => {
        const kw = keywordScore(tokens, chunk);
        const graphBoost = boostedIds.has(chunk.id) ? GRAPH_BOOST : 0;

        let baseScore;
        if (queryVec && vectors) {
            const chunkVec = vectors.get(chunk.id || '');
            if (chunkVec) {
                const kwNorm = Math.min(kw / 20, 1);
                const sim    = cosine(queryVec, chunkVec);
                baseScore    = (KEYWORD_WEIGHT * kwNorm + VECTOR_WEIGHT * sim) * 10;
            } else {
                // No vector — keyword only, slight penalty so hybrid results rank higher
                baseScore = Math.min(kw / 20, 1) * 5;
            }
        } else {
            baseScore = Math.min(kw / 20, 1) * 10;
        }

        const finalScore = baseScore + graphBoost;
        return { ...chunk, score: finalScore, _kw: kw, _graphBoosted: graphBoost > 0 };
    });

    const results = scored
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSources);

    // ── Debug trace ───────────────────────────────────────────────────────────
    const mode = queryVec ? 'hybrid' : (vectors ? 'keyword+graph' : 'keyword');
    console.group(`🧠 Frankie retrieval [${mode}${nuclear ? '+nuclear' : ''}] — "${query.slice(0, 60)}"`);
    results.forEach((r, i) => {
        const src      = r.source_file || r.source || '?';
        const cat      = r.category || r.content_type || '?';
        const reactor  = r.reactor_type ? ` | ${r.reactor_type}` : '';
        const boosted  = r._graphBoosted ? ' ⚡graph' : '';
        console.log(`  #${i+1} score=${r.score.toFixed(2)} kw=${r._kw}${boosted} | ${src}${reactor} | ${cat} | "${(r.text||'').slice(0,80).replace(/\n/g,' ')}"`);
    });
    console.groupEnd();
    // ─────────────────────────────────────────────────────────────────────────

    const gatedHits = allScored
        .filter(c => !chunkAllowedForTier(c, tier) && c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    return {
        query,
        tier,
        mode:        queryVec ? 'hybrid' : (vectors ? 'vector-ready' : 'keyword'),
        nuclear,
        graphBoosted: boostedIds.size,
        confidence:   results.length ? normaliseScore(results[0].score) : 0,
        sourcesUsed:  results.length,
        gatedHits:    gatedHits.length,
        results
    };
}
