#!/usr/bin/env python3
"""
Frankie — Embedding Precompute Script
--------------------------------------
Generates vector embeddings for all frankie4_kb.json chunks using
OpenAI text-embedding-3-small and writes kb_vectors.json to the kb/ folder.

Usage:
    python scripts/precompute_embeddings.py --key sk-...
    python scripts/precompute_embeddings.py  # reads OPENAI_API_KEY from .env

Re-run any time you update the KB. Full regeneration takes ~10 seconds.
Cost: ~$0.009 per full run (less than 1 cent).
"""

import json
import os
import sys
import time
import argparse
from pathlib import Path

# ── Args ──────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description='Precompute Frankie KB embeddings')
parser.add_argument('--key',    type=str, help='OpenAI API key (or set OPENAI_API_KEY)')
parser.add_argument('--model',  type=str, default='text-embedding-3-small', help='Embedding model')
parser.add_argument('--batch',  type=int, default=100, help='Chunks per API batch (max 2048)')
parser.add_argument('--dims',   type=int, default=None, help='Embedding dimensions (e.g. 256 for smaller output files)')
parser.add_argument('--kb',     type=str, default=None, help='Path to KB JSON (auto-detected if omitted)')
parser.add_argument('--out',    type=str, default=None, help='Output path (default: kb/kb_vectors.json)')
args = parser.parse_args()

# ── Resolve API key ───────────────────────────────────────────────────────────

api_key = args.key or os.environ.get('OPENAI_API_KEY')
if not api_key:
    # Try .env in project root
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith('OPENAI_API_KEY='):
                api_key = line.split('=', 1)[1].strip().strip('"\'')
                break

if not api_key:
    print('ERROR: No OpenAI API key found.')
    print('  Pass it with --key sk-... or set OPENAI_API_KEY in your environment or .env file.')
    sys.exit(1)

print(f'Using model: {args.model}')

# ── Resolve paths ─────────────────────────────────────────────────────────────

script_dir = Path(__file__).parent
project_root = script_dir.parent
kb_path = Path(args.kb) if args.kb else project_root / 'kb' / 'frankie_normalized_kb.json'
out_path = Path(args.out) if args.out else project_root / 'kb' / 'kb_vectors.json'

if not kb_path.exists():
    print(f'ERROR: KB file not found at {kb_path}')
    sys.exit(1)

# ── Load KB ───────────────────────────────────────────────────────────────────

print(f'Loading KB from {kb_path}...')
raw = json.loads(kb_path.read_text(encoding='utf-8'))
chunks = raw if isinstance(raw, list) else raw.get('chunks', list(raw.values()))
print(f'Loaded {len(chunks):,} chunks')

# ── Build texts to embed ───────────────────────────────────────────────────────
# Combine section + content_type + text for richer semantic signal

def chunk_to_embed_text(chunk):
    parts = []

    if chunk.get('title'):
        parts.append(chunk['title'])

    if chunk.get('source'):
        parts.append(chunk['source'])

    if chunk.get('content'):
        parts.append(chunk['content'])

    # frankie4/5 KB chunks use 'text' rather than 'content'
    if not parts and chunk.get('text'):
        parts.append(chunk['text'])

    return '\n'.join(parts)[:8000]  # stay well within token limits

texts = [chunk_to_embed_text(c) for c in chunks]
ids = [
    c.get('id')
    or c.get('title')
    or str(i)
    for i, c in enumerate(chunks)
]

# ── Embed in batches ──────────────────────────────────────────────────────────

try:
    import urllib.request
    import urllib.error
except ImportError:
    print('ERROR: urllib not available')
    sys.exit(1)

def embed_batch(batch_texts, api_key, model):
    body = {'model': model, 'input': batch_texts, 'encoding_format': 'float'}
    if args.dims:
        body['dimensions'] = args.dims
    payload = json.dumps(body).encode('utf-8')

    req = urllib.request.Request(
        'https://api.openai.com/v1/embeddings',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            # Sort by index to guarantee order
            return [item['embedding'] for item in sorted(data['data'], key=lambda x: x['index'])]
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f'\nHTTP {e.code}: {body}')
        raise

batch_size = min(args.batch, 2048)
all_embeddings = []
total_batches = (len(texts) + batch_size - 1) // batch_size

print(f'Embedding {len(texts):,} chunks in {total_batches} batches of {batch_size}...')

for i in range(0, len(texts), batch_size):
    batch_num = i // batch_size + 1
    batch = texts[i:i + batch_size]

    print(f'  Batch {batch_num}/{total_batches} ({len(batch)} chunks)...', end=' ', flush=True)
    t0 = time.time()

    retries = 3
    for attempt in range(retries):
        try:
            embeddings = embed_batch(batch, api_key, args.model)
            all_embeddings.extend(embeddings)
            print(f'done ({time.time()-t0:.1f}s)')
            break
        except Exception as e:
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f'retrying in {wait}s...', end=' ', flush=True)
                time.sleep(wait)
            else:
                print(f'FAILED: {e}')
                sys.exit(1)

    # Polite rate limit pause between batches (~85K tokens/batch, 1M TPM limit → 7s gap)
    if i + batch_size < len(texts):
        time.sleep(7)

# ── Write output ──────────────────────────────────────────────────────────────

print(f'\nWriting vectors to {out_path}...')

output = {
    'model':      args.model,
    'generated':  time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'chunk_count': len(all_embeddings),
    'dimensions': len(all_embeddings[0]) if all_embeddings else 0,
    'vectors': [
        {'id': ids[i], 'vector': all_embeddings[i]}
        for i in range(len(all_embeddings))
    ]
}

out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(output, separators=(',', ':')), encoding='utf-8')

size_mb = out_path.stat().st_size / 1_048_576
print(f'Done. {len(all_embeddings):,} vectors written ({size_mb:.1f} MB)')
print(f'\nNext: serve Frankie and the retrieval layer will pick up kb_vectors.json automatically.')
