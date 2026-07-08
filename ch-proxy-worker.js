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
 *
 * Setup — add these as Secrets in Cloudflare dashboard:
 *   Workers → ch → Settings → Environment Variables → Add Secret
 *   CH_KEY    = your Companies House API key
 *   BRAVE_KEY = your Brave Search API key
 *   GROQ_KEY  = your Groq API key
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
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
