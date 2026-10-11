// The fetcher's answers as MaveScape caches them (validation/fixtures/public-data), served to the
// annotation providers (web/lib/providers) as the page's fetchPublic serves them: the same routes,
// the same cache names as fetch.go and annotations.go give them, the retrieval record from each
// answer's .meta.json. For the unit tests and the validation suite `annotations`, which read
// public data offline exactly as a window running with --offline does.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('./fixtures/public-data/', import.meta.url);
const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');
const urnName = (urn) => urn.toLowerCase().replace(/:/g, '_');

// The cache entry a route names: { kind, name }, or null for a route the fetcher does not serve.
export function cacheEntry(path) {
  const [route, query = ''] = path.split('?');
  const q = new URLSearchParams(query);
  const parts = route.split('/').map(decodeURIComponent);
  const [service] = parts;
  if (service === 'uniprot' && parts[2] === 'features') return { kind: 'uniprot', name: `${parts[1].toUpperCase()}.features.json` };
  if (service === 'uniprot') return { kind: 'uniprot', name: `${parts[1].toUpperCase()}.json` };
  if (service === 'pdbe' && parts[1] === 'conservation') return { kind: 'pdbe', name: `${parts[2].toUpperCase()}.conservation.json` };
  if (service === 'alphafold' && parts[2] === 'missense') return { kind: 'alphafold', name: `${parts[1].toUpperCase()}.aa-substitutions.csv` };
  if (service === 'clinvar' && parts[1] === 'search') return { kind: 'clinvar', name: `${q.get('gene').toUpperCase()}.search.${q.get('page') ?? 1}.json` };
  if (service === 'clinvar' && parts[1] === 'summary') return { kind: 'clinvar', name: `${sha256Hex(q.get('ids'))}.summary.json` };
  if (service === 'gnomad' && parts[1] === 'gene') return { kind: 'gnomad', name: `${parts[2].toUpperCase()}.gene.json` };
  if (service === 'gnomad' && parts[1] === 'transcript') return { kind: 'gnomad', name: `${parts[2].toUpperCase().replace(/\.\d+$/, '')}.variants.json` };
  if (service === 'mavedb' && parts[1] === 'score-sets') {
    const urn = urnName(parts[2]);
    if (!parts[3]) return { kind: 'mavedb', name: `${urn}.json` };
    if (parts[3] === 'namespaces') return { kind: 'mavedb', name: `${urn}.namespaces.json` };
    if (parts[3] === 'annotations') return { kind: 'mavedb', name: `${urn}.annotations${q.get('clinvar') ? `.clinvar_${q.get('clinvar')}` : ''}.csv` };
    return { kind: 'mavedb', name: `${urn}.${parts[3] === 'mapped-variants' ? 'mapped.json' : `${parts[3]}.csv`}` };
  }
  return null;
}

// get(path, { as }) → { ok, json | text, retrieval } as fetchPublic answers; offline: an answer not
// cached is refused as the program refuses it. asked: every path asked, in order.
export function cachedGet(root = ROOT) {
  const asked = [];
  const get = async (path, { as = 'json' } = {}) => {
    asked.push(path);
    const entry = cacheEntry(path);
    const file = entry ? new URL(`${entry.kind}/${entry.name}`, root) : null;
    if (!file || !existsSync(file)) return { ok: false, status: 403, message: `MaveScape is running with --offline: it serves only copies already in its cache, and has none of this request (${path}).` };
    const meta = JSON.parse(readFileSync(new URL(`${entry.kind}/${entry.name}.meta.json`, root), 'utf8'));
    const text = readFileSync(file, 'utf8');
    const retrieval = { service: meta.service, source: meta.source, retrieved: meta.retrieved, checked: meta.checked ?? null, etag: meta.etag ?? null, version: meta.version ?? null, cache: 'hit' };
    return as === 'text' ? { ok: true, text, retrieval } : { ok: true, json: JSON.parse(text), retrieval };
  };
  get.asked = asked;
  return get;
}
