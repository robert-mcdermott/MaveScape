# Network requests

MaveScape analyses your files on your computer and sends them nowhere. It reaches the internet
for one purpose: public data, such as a protein's UniProt entry or a score set published in
MaveDB. This page lists every request it
can make, every host it may contact, and what each request sends (requirement P3).

- **One way out.** The page in your window contacts nothing but the MaveScape program that serves
  it: its Content-Security-Policy (`connect-src 'self'`) forbids anything else. The program's
  fetcher (`fetch.go`) asks the services.
- **One list.** The fetcher may contact only the hosts below, and checks every request against
  that list as it is sent, redirects included. Anything else is refused before a byte leaves.
- **Public identifiers.** Requests carry accessions and URNs. A request that would send a
  sequence is made only after you have seen exactly what it sends and confirmed it.
- **Cached.** Each answer is kept, with the record of where and when it was retrieved, so the same
  request is not sent again for a month, and works offline.

The Network dialog (the status bar's **Public data**) shows the same list, and what is in the
cache.

## Switches

| Flag | Effect |
| --- | --- |
| `--offline` | No network request at all. Public data come only from copies already in the cache; anything else is refused with a message saying so. |
| `--no-fetch` | Public data are off: no request, no cache. The page says so where it would have offered them. |
| `--mavedb URN` | Opens a MaveDB score set when MaveScape starts (as `mavescape urn:mavedb:…`): its record and tables, through the requests below. |
| `--cache-dir DIR` | The cache's folder. The default is `<user cache dir>/MaveScape`: `~/Library/Caches/MaveScape` on macOS, `~/.cache/MaveScape` on Linux, `%LocalAppData%\MaveScape` on Windows. |

`mavescape run` and `mavescape validate` read only the files they are given: public data are off
in their private window. A MaveScape served as a plain web site, without the program, has no
public data.

The fetcher honors the `HTTPS_PROXY` and `NO_PROXY` environment variables, for networks that
require a proxy.

## Hosts

The only hosts MaveScape may contact, and the paths it may ask for on each. A request to any other
host, path, port or scheme (HTTPS only) is refused before it is sent.

| Host | Paths | Service | Used for |
| --- | --- | --- | --- |
| `rest.uniprot.org` | all | UniProt | a target's entry; finding a target by its sequence (MaveScape 0.3) |
| `api.mavedb.org` | `/api/` | MaveDB | score sets' records, scores, counts and mapped variants, and the search (MaveScape 0.3) |
| `files.rcsb.org` | all | RCSB PDB | structures (MaveScape 0.5, to come) |
| `data.rcsb.org` | all | RCSB PDB | structures' metadata (MaveScape 0.5, to come) |
| `www.ebi.ac.uk` | `/pdbe/` | PDBe | structures and their residue mappings (to come) |
| `alphafold.ebi.ac.uk` | all | AlphaFold DB | predicted structures and alignments (to come) |
| `eutils.ncbi.nlm.nih.gov` | `/entrez/eutils/` | NCBI E-utilities | RefSeq and GenBank records, for targets named by a transcript (MaveScape 0.3); ClinVar observations (to come) |
| `rest.ensembl.org` | all | Ensembl | transcripts, for targets named by one (MaveScape 0.3) |
| `gnomad.broadinstitute.org` | `/api` | gnomAD | population frequencies (to come) |

Hosts marked "to come" are on the list now so that the list is fixed in one place; no request
uses them yet. Each later version that adds a request adds it to the table below.

## Requests

Each request the page can make of the program, the request the program makes in turn, and what
leaves your computer.

| The page asks | The program asks | What is sent | For | Cached |
| --- | --- | --- | --- | --- |
| `/api/fetch/uniprot/{accession}` | `https://rest.uniprot.org/uniprotkb/{accession}.json?fields=accession,id,protein_name,gene_names,organism_name,length,sequence` | a UniProt accession (P62993) | the entry's names, organism and sequence, to place the target in it (Experiment, Target: **Check against UniProt**; the `check_target` action) | 30 days; up to 8 MB |
| `/api/fetch/uniparc` with `?sequence=…` | `https://rest.uniprot.org/uniparc/sequence?sequence={sequence}&fields=upi,accession,organism,protein,gene&dbTypes=UniProtKB/Swiss-Prot,UniProtKB/Swiss-Prot%20protein%20isoforms,UniProtKB/TrEMBL&active=true` | **a protein sequence (the target's), only once you confirm** | the UniProt entries with exactly that sequence, to find a target that has no accession (Experiment, Target: **Find in UniProt by sequence…**) | kept; up to 16 MB |
| `/api/fetch/mavedb/score-sets/{urn}` | `https://api.mavedb.org/api/v1/score-sets/{urn}` | a MaveDB URN (urn:mavedb:00000835-a-1) | the score set's record: its title, target, license, publications, keywords, columns and calibrations (Open from MaveDB; `open_mavedb`; `mavescape --mavedb`) | 7 days; up to 32 MB |
| `/api/fetch/mavedb/score-sets/{urn}/scores` | `https://api.mavedb.org/api/v1/score-sets/{urn}/scores` | a MaveDB URN | the score set's published scores (CSV) | 30 days; up to 256 MB |
| `/api/fetch/mavedb/score-sets/{urn}/counts` | `https://api.mavedb.org/api/v1/score-sets/{urn}/counts` | a MaveDB URN | the counts the authors deposited beside the scores (CSV), when they did | 30 days; up to 256 MB |
| `/api/fetch/mavedb/score-sets/{urn}/mapped-variants` | `https://api.mavedb.org/api/v1/score-sets/{urn}/mapped-variants` | a MaveDB URN | MaveDB's mapping of the score set's variants to the human reference: VRS identifiers, HGVS on the reference, ClinGen allele IDs (Open from MaveDB, **Mapped variants**, when you tick it) | 7 days; up to 256 MB |
| `/api/fetch/ncbi/nuccore/{accession}` | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id={accession}&rettype=gb&retmode=text&tool=mavescape` | a RefSeq or GenBank nucleotide accession (NM_007294.3) | the record's sequence and features (GenBank), for a score set's target named by a RefSeq transcript, or a target fetched by its accession (Experiment, Target) | 30 days; up to 32 MB |
| `/api/fetch/ensembl/transcript/{id}` | `https://rest.ensembl.org/sequence/id/{id}?type=cdna&mask_feature=1` | an Ensembl transcript identifier, without its version (ENST00000460680) | the transcript's sequence in Ensembl's current release, its coding part in capitals, for a score set's target named by an Ensembl transcript | 30 days; up to 16 MB |
| `/api/fetch/mavedb/search` with `?text=…&page=…` | `https://api.mavedb.org/api/v1/score-sets/search` (POST `{"text": …, "published": true, "limit": 100, "offset": …}`) | the words searched for (GRB2, abundance…) and the page of results | the published score sets that match, 100 at a time (Open from MaveDB; `search_mavedb`) | 1 day; up to 32 MB |

The program also answers two requests of its own, which contact nothing: `/api/fetch` (the mode,
the cache's folder, these hosts and requests) and `/api/fetch/cache` (what is in the cache).

## A request that sends a sequence

Your target's sequence may be unpublished. The program will not send it unless the request
carries the header `X-MaveScape-Confirm: send-sequence`, which the page adds only when you click
**Send it** in a dialog that shows the whole request, sequence included. Without it, the program
answers HTTP 428 with the exact request it would make, and sends nothing. A lookup already in the
cache is answered from it, sending nothing. No remote-control action sends a sequence: only the
person at the window can decide to.

## What every request carries

- `User-Agent: MaveScape/<version> (local research software; docs/NETWORK.md)`
- `Accept: application/json` (`text/csv` for a table, `text/plain` for a GenBank record)
- When a cached copy is being checked: `If-None-Match` (its ETag) and `If-Modified-Since` (its
  date), so an unchanged answer is confirmed (HTTP 304) rather than sent again.

Nothing else: no cookies, no `Referer` (removed from redirected requests too), no `Origin`, and
nothing that names you, your computer or your files.

## Limits

- **Size.** Each request has a largest answer it accepts (the table above). An answer beyond it is
  refused, however it comes: declared, streamed, or compressed (a small compressed answer that
  expands beyond the limit stops at the limit).
- **Only JSON**, or a CSV table where the request is for one (a header of comma-separated names,
  not a page), or a GenBank record where the request is for one (beginning with its `LOCUS`
  line), is accepted from the requests above. NCBI and Ensembl answer an unknown accession with
  HTTP 400: it is read as "not found".
- **Redirects** stay on the same host, at most five, and are checked against the list too.
- **Time.** 45 seconds for a service to start answering, 120 for the whole answer.
- **Retries.** An answer of HTTP 429, 502, 503 or 504, or no answer, is tried twice more, after 1
  and 3 seconds (or the `Retry-After` the service asks, up to 10 seconds). MaveDB answers some
  requests with 504 after about ten seconds and succeeds on the next.

## The cache

Each answer is a file in `<cache dir>/<kind>/`, named by the accession (`uniprot/P62993.json`), by
a score set's URN without its colons (`mavedb/urn_mavedb_00000835-a-1.json`, `….scores.csv`,
`….counts.csv`, `….mapped.json`), by a nucleotide accession (`ncbi/NM_007294.3.gb`), by an
Ensembl transcript without its version (`ensembl/ENST00000460680.json`), by the SHA-256 of a search's words and page (`mavedb-search/<sha256>.json`) or,
for a sequence's lookup, by the SHA-256 of the sequence (`uniparc/<sha256>.json`), beside
`<name>.meta.json`, its retrieval record (docs/FORMATS.md, "The cache of public data"): the
service, the URL it came from, when it was retrieved and last confirmed, and the ETag, date and
release the service gave. A lookup's record names its request with `{sequence}` in place of the
sequence: the cache holds public answers only, never your sequence.

- A copy younger than its kind's age (30 days for UniProt entries, MaveDB's tables, NCBI's and
  Ensembl's records, 7 for a MaveDB record, which gains calibrations, and its mapped variants, 1
  for a search; a sequence's lookup is kept) is
  served without asking. An older one is checked with the service: confirmed unchanged, or
  replaced.
- When the service cannot be reached, or MaveScape is offline, an older copy is served, marked
  stale (`X-MaveScape-Cache: stale`). An entry the service says no longer exists (HTTP 404) is
  not served from the cache.
- To fetch again regardless, add `?refresh=1` to the request. To empty the cache, delete its
  folder.

Every answer the page receives says where it came from, in headers the page records:
`X-MaveScape-Cache` (`hit`, `miss`, `revalidated` or `stale`), `X-MaveScape-Service`,
`X-MaveScape-Source`, `X-MaveScape-Retrieved`, `X-MaveScape-Checked`, `X-MaveScape-ETag` and
`X-MaveScape-Version` (UniProt's release, such as `2026_03`). MaveDB gives no ETag or release: a
record's own dates (published, modified) say which version it is. A RefSeq accession names its
version (NM_007294.3), and NCBI sends that version. Ensembl serves its current release only, so
the transcript is asked for without its version and its answer names the version it holds
(ENST00000460680.6): where a score set names another (.5), MaveScape says so, and checks every
variant's reference base against the sequence it got.

## How this is checked

- `go test` (`fetch_test.go`): only the listed hosts, paths, scheme and port; nothing sent to an
  unlisted host; redirects; size limits, streamed and compressed answers included; retries; MaveDB's
  records, tables, mapped variants and search (URNs of published score sets only, CSV answers, the
  search's words POSTed and cached); NCBI's GenBank records and Ensembl's transcripts (accessions
  only, an unknown one "not found", an answer of the wrong kind refused);
  revalidation by ETag; stale copies; `--offline` and `--no-fetch`; the sequence sent only once
  confirmed; this page lists every request and host (`TestNetworkDocumentListsEveryRequest`); no
  script in the page names another origin in a request.
- `validation/remote-session.mjs` drives a whole session offline, and records every request the
  page makes: none goes beyond its own origin.
- `validation/mavedb-live.mjs` opens the feasibility records from MaveDB, live (CI runs it), and
  checks that the tables MaveDB sends are the ones the validation pins.
