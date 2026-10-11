// The retrieval record of public data (wave 3): what the MaveScape program's fetcher (fetch.go)
// says of each answer it serves, in X-MaveScape-* headers: the service, the URL, when it was
// retrieved and last confirmed, its release and ETag, and whether it came from the cache.

// The retrieval record the host sends with a response (fetch.go, writeCached): header(name) reads
// one of its headers.
export function retrievalOf(header) {
  const read = (name) => header(`X-MaveScape-${name}`) || null;
  return { service: read('Service'), source: read('Source'), retrieved: read('Retrieved'), checked: read('Checked'), version: read('Version'), etag: read('ETag'), cache: read('Cache') };
}

// "release 2026_03, retrieved 2026-10-10" for a record (the same text in every browser).
export function retrievalText(record) {
  const release = record?.release ?? record?.version ?? null;
  const day = /^\d{4}-\d{2}-\d{2}/.exec(record?.retrieved ?? '')?.[0] ?? null;
  return [release ? `release ${release}` : null, day ? `retrieved ${day}` : null].filter(Boolean).join(', ');
}
