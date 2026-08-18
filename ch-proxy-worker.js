/**
 * frankie-proxy-worker.js
 * Cloudflare Worker — multi-API CORS proxy for Frankie.
 *
 * Proxies:
 *   /ch/*         → Companies House API       (env: CH_KEY)
 *   /hmrc/*       → HMRC VAT validation        (no auth)
 *   /sanctions/*  → FCDO UK Sanctions List CSV (no auth)
 *   /brave/*      → Brave Search API           (env: BRAVE_KEY)
 *   /groq/*       → Groq chat completions      (env: GROQ_KEY)
 *   /claude/*     → Claude Messages API        (env: CLAUDE_KEY)
 *   /embed/*      → OpenAI Embeddings API      (env: EMBED_KEY)
 *   /cf/*         → Contracts Finder API       (no auth — public gov.uk API)
 *   /fts/*        → Find a Tender OCDS API     (no auth — public gov.uk API)
 *   /pcs/*        → Public Contracts Scotland API (no auth — public gov.uk API)
 *   /sell2wales/* → Sell2Wales API             (no auth — public gov.wales API)
 *   /kb/*         → Frankie KB/vector files, read-only, from a private
 *                   Azure Blob container       (env: KB_BLOB_BASE, KB_BLOB_SAS)
 *   /blob/content/*  → scc.html Content Editor / Website Editor storage
 *                      (env: CONTENT_BLOB_BASE, CONTENT_BLOB_SAS)
 *   /blob/videos/*   → scc.html video library storage
 *                      (env: VIDEOS_BLOB_BASE, VIDEOS_BLOB_SAS)
 *
 * The four tender routes (2026-08-18) replace scraper.js's prior dependency on
 * the free public corsproxy.io for these calls — that proxy was intermittently
 * failing (random 429/500/network errors) under the added load of FTS +
 * Klickstream pagination. These are all read-only public government APIs with
 * no secret key of their own, so they need no new Worker secrets — just a
 * server-to-server passthrough so the browser's CORS restrictions never come
 * into play at all. scraper.js still falls back to corsproxy.io if there's no
 * active staff session (see braveSearch()/govApiUrl() there for the pattern).
 *
 * AUTH GATE (added 2026-08-03): every route below now requires a valid
 * member session. The caller must send `Authorization: Bearer <token>`
 * where <token> is the Supabase access_token issued to a signed-in member
 * (this is what members.html stores as localStorage.frankieUserToken).
 * The Worker validates it by calling Supabase's own /auth/v1/user endpoint
 * — no JWT secret needs to live in this Worker, and revoked/expired
 * sessions are rejected automatically because Supabase manages that.
 *
 * Setup — add these as Secrets in Cloudflare dashboard:
 *   Workers → ch → Settings → Environment Variables → Add Secret
 *   CH_KEY           = your Companies House API key
 *   BRAVE_KEY        = your Brave Search API key
 *   GROQ_KEY         = your Groq API key
 *   CLAUDE_KEY       = your Anthropic API key
 *   EMBED_KEY        = your OpenAI API key
 *   SUPABASE_URL     = https://qkyvmtouwrzrcyagkheo.supabase.co
 *   SUPABASE_ANON_KEY= your Supabase project's anon/public key (Settings → API)
 *   KB_BLOB_BASE     = https://<account>.blob.core.windows.net/<container>  (no trailing slash)
 *   KB_BLOB_SAS      = a READ-ONLY, container-scoped SAS query string (no leading '?'),
 *                      e.g. "sv=...&sr=c&sp=r&se=...&sig=..." — generate this with
 *                      "Read" + "List" permissions ONLY, nothing else. Never put this
 *                      in client-side code — it must only ever live as a Worker secret.
 *   CONTENT_BLOB_BASE = https://nuccolmedia.blob.core.windows.net/content
 *   CONTENT_BLOB_SAS  = read+write+delete SAS for the content container (scc.html
 *                       Content Editor / Website Editor needs to create, update and
 *                       delete JSON files). Moved here 2026-08-03 — this SAS used to
 *                       be hardcoded in plain text inside scc.html itself, readable by
 *                       anyone via view-source. Generate a FRESH SAS when setting this
 *                       secret; the old exposed one should be treated as compromised.
 *   VIDEOS_BLOB_BASE  = https://nuccolmedia.blob.core.windows.net/videos
 *   VIDEOS_BLOB_SAS   = read+write+list+delete SAS for the videos container. Same
 *                       exposure history and same advice — regenerate, don't reuse.
 *
 * To deploy:
 * 1. dash.cloudflare.com → Workers → ch → Edit code
 * 2. Replace all code with this file → Save and Deploy
 */

const UPSTREAMS = {
  '/ch':        'https://api.company-information.service.gov.uk',
  '/hmrc':      'https://api.service.hmrc.gov.uk',
  '/sanctions': 'https://ofsistorage.blob.core.windows.net/publishlive/2022format',
  '/brave':     'https://api.search.brave.com',
  '/groq':      'https://api.groq.com',
  '/claude':    'https://api.anthropic.com',
  '/embed':     'https://api.openai.com',
  '/cf':          'https://www.contractsfinder.service.gov.uk',
  '/fts':         'https://www.find-tender.service.gov.uk',
  '/pcs':         'https://api.publiccontractsscotland.gov.uk',
  '/sell2wales':  'https://api.sell2wales.gov.wales',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // --- Auth gate: every route below requires a valid member session ---
    const member = await checkAuth(request, env);
    if (!member) {
      return new Response(JSON.stringify({ error: 'Unauthorized — a valid member session is required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // --- KB route: gated read-only pass-through to a private Azure Blob container ---
    if (url.pathname === '/kb' || url.pathname.startsWith('/kb/')) {
      return handleKb(url, env);
    }

    // --- Blob route: gated read/write/delete pass-through for scc.html's
    // Content Editor / Website Editor / video library. Replaces the old design
    // where the SAS token was hardcoded in plain text inside scc.html itself.
    if (url.pathname.startsWith('/blob/')) {
      return handleBlob(request, url, env);
    }

    // Match prefix
    let upstream = null;
    let pathRemainder = '';
    for (const [prefix, base] of Object.entries(UPSTREAMS)) {
      if (url.pathname.startsWith(prefix + '/') || url.pathname === prefix) {
        upstream = base;
        pathRemainder = url.pathname.slice(prefix.length) + url.search;
        break;
      }
    }

    // Special route: /fetch?url=https://... — fetches any public URL (for website scraping)
    if (url.pathname === '/fetch') {
      const target = url.searchParams.get('url');
      if (!target || !target.startsWith('http')) {
        return new Response(JSON.stringify({ error: 'Missing or invalid url param' }), {
          status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
      let resp;
      try {
        resp = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FrankieBot/1.0)', 'Accept': 'text/html,text/plain,*/*' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Fetch failed', detail: e.message }), {
          status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
      const text = await resp.text();
      // Strip HTML tags server-side to reduce payload size
      const stripped = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
                           .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
                           .replace(/<[^>]+>/g, ' ')
                           .replace(/\s{3,}/g, ' ')
                           .slice(0, 15000); // cap at 15k chars
      return new Response(JSON.stringify({ text: stripped, url: target }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    if (!upstream) {
      return new Response(JSON.stringify({ error: 'Unknown proxy path: ' + url.pathname }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const upstreamUrl = upstream + pathRemainder;

    // Build headers — inject server-side secrets
    const headers = { 'Accept': 'application/json' };

    if (upstream.includes('company-information')) {
      headers['Authorization'] = 'Basic ' + btoa((env.CH_KEY || '') + ':');
    }
    if (upstream.includes('search.brave.com')) {
      headers['X-Subscription-Token'] = env.BRAVE_KEY || '';
    }
    if (upstream.includes('api.groq.com')) {
      headers['Authorization'] = 'Bearer ' + (env.GROQ_KEY || '');
      headers['Content-Type'] = 'application/json';
    }
    if (upstream.includes('api.anthropic.com')) {
      headers['x-api-key'] = env.CLAUDE_KEY || '';
      headers['anthropic-version'] = '2023-06-01';
      headers['Content-Type'] = 'application/json';
    }
    if (upstream.includes('api.openai.com')) {
      headers['Authorization'] = 'Bearer ' + (env.EMBED_KEY || '');
      headers['Content-Type'] = 'application/json';
    }
    if (upstream.includes('contractsfinder.service.gov.uk')) {
      // POST with a JSON search-criteria body, no auth needed — a public API.
      headers['Content-Type'] = 'application/json';
    }
    if (upstream.includes('ofsistorage')) {
      headers['Accept'] = '*/*';
    }

    // For POST requests (Groq) forward the body
    const method = request.method;
    const body = (method === 'POST') ? await request.text() : undefined;

    let response;
    try {
      response = await fetch(upstreamUrl, { method, headers, body });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Upstream error', detail: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const respHeaders = new Headers();
    respHeaders.set('Access-Control-Allow-Origin', '*');
    respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    const ct = response.headers.get('Content-Type') || 'application/json';
    respHeaders.set('Content-Type', ct);

    // Stream SSE responses (Claude) directly — don't buffer
    const isStream = ct.includes('text/event-stream');
    const respBody = isStream ? response.body : await response.text();

    return new Response(respBody, { status: response.status, headers: respHeaders });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    // PUT and DELETE added 2026-08-08 — the /blob/* routes (Media Library
    // upload/delete in scc.html) need them for uploads and file removal.
    // Missing here caused the browser's CORS preflight to reject every PUT
    // request before it was ever sent, breaking Media Library uploads.
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ms-blob-type',
  };
}

// Validate the caller's Supabase session token by asking Supabase directly.
// Returns the user object if valid, or null if missing/invalid/expired/revoked.
async function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const supabaseUrl = env.SUPABASE_URL || 'https://qkyvmtouwrzrcyagkheo.supabase.co';
  try {
    const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': env.SUPABASE_ANON_KEY || '',
      },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

// Gated, read-only pass-through to a private Azure Blob container holding
// Frankie's KB/vector JSON files. The SAS token never reaches the client —
// it's injected here server-side from a Worker secret.
async function handleKb(url, env) {
  const blobBase = env.KB_BLOB_BASE;
  const sas = env.KB_BLOB_SAS;
  if (!blobBase || !sas) {
    return new Response(JSON.stringify({ error: 'KB storage not configured on this Worker' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const pathRemainder = url.pathname.slice('/kb'.length); // e.g. "/frankie7_supplier_kb.json"
  if (!pathRemainder || pathRemainder === '/') {
    return new Response(JSON.stringify({ error: 'Missing file name after /kb/' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const blobUrl = `${blobBase}${pathRemainder}?${sas}`;

  let response;
  try {
    response = await fetch(blobUrl, { method: 'GET' });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'KB fetch failed', detail: err.message }), {
      status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  if (!response.ok) {
    return new Response(JSON.stringify({ error: 'KB file not found', status: response.status }), {
      status: response.status, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const respHeaders = new Headers(corsHeaders());
  respHeaders.set('Content-Type', 'application/json');
  respHeaders.set('Cache-Control', 'private, max-age=300'); // KB changes rarely; short cache is fine
  // Stream the body straight through rather than buffering — some of these
  // files (frankie_regs_vectors.json) are hundreds of MB.
  return new Response(response.body, { status: 200, headers: respHeaders });
}

// Gated pass-through for scc.html's Azure Blob usage (Content Editor, Website
// Editor, video library). Supports GET / PUT / DELETE and preserves any
// original query string (e.g. "?restype=container&comp=list" for listing
// blobs) — the server-side SAS is appended after whatever the client sent.
async function handleBlob(request, url, env) {
  const m = url.pathname.match(/^\/blob\/(content|videos)(\/.*)?$/);
  if (!m) {
    return new Response(JSON.stringify({ error: 'Unknown blob path: ' + url.pathname }), {
      status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const container = m[1]; // 'content' or 'videos'
  const remainder = m[2] || '';
  const base = container === 'content' ? env.CONTENT_BLOB_BASE : env.VIDEOS_BLOB_BASE;
  const sas  = container === 'content' ? env.CONTENT_BLOB_SAS  : env.VIDEOS_BLOB_SAS;

  if (!base || !sas) {
    return new Response(JSON.stringify({ error: `Blob storage not configured for '${container}'` }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const originalQuery = url.search ? url.search.slice(1) : '';
  const combinedQuery  = originalQuery ? `${originalQuery}&${sas}` : sas;
  const blobUrl = `${base}${remainder}?${combinedQuery}`;

  const method = request.method;
  const headers = {};
  const ct = request.headers.get('Content-Type');
  if (ct) headers['Content-Type'] = ct;
  const blobType = request.headers.get('x-ms-blob-type');
  if (blobType) headers['x-ms-blob-type'] = blobType;

  const body = (method === 'PUT' || method === 'POST') ? await request.arrayBuffer() : undefined;

  let response;
  try {
    response = await fetch(blobUrl, { method, headers, body });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Blob request failed', detail: err.message }), {
      status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const respHeaders = new Headers(corsHeaders());
  respHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');
  return new Response(response.body, { status: response.status, headers: respHeaders });
}
