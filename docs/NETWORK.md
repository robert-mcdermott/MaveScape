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
- **Public identifiers.** Requests carry accessions, URNs, gene symbols and ClinVar's record
  numbers. A request that would send a sequence is made only after you have seen exactly what it
  sends and confirmed it.
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
| `rest.uniprot.org` | all | UniProt | a target's entry and its features; finding a target by its sequence (MaveScape 0.3) |
| `api.mavedb.org` | `/api/` | MaveDB | score sets' records, scores, counts, mapped variants and annotations, and the search (MaveScape 0.3) |
| `files.rcsb.org` | all | RCSB PDB | a PDB entry's coordinates, for the Structure view (MaveScape 0.5) |
| `data.rcsb.org` | all | RCSB PDB | structures' metadata (MaveScape 0.5, to come) |
| `www.ebi.ac.uk` | `/pdbe/` | PDBe | a protein's conservation profile (PDBe-KB; MaveScape 0.3); the structures that cover a protein, by SIFTS (MaveScape 0.5) |
| `alphafold.ebi.ac.uk` | all | AlphaFold DB | AlphaMissense's predictions of a human protein (MaveScape 0.3); a protein's predicted structure and its aligned error (MaveScape 0.5) |
| `eutils.ncbi.nlm.nih.gov` | `/entrez/eutils/` | NCBI E-utilities | RefSeq and GenBank records, for targets named by a transcript; a gene's ClinVar records (MaveScape 0.3) |
| `rest.ensembl.org` | all | Ensembl | transcripts, for targets named by one (MaveScape 0.3) |
| `gnomad.broadinstitute.org` | `/api` | gnomAD | a gene's variants and their frequencies (MaveScape 0.3) |

Uses marked "to come" are on the list now so that it is fixed in one place; no request makes them
yet. Each later version that adds a request adds it to the table below. AlphaFold DB lists a
multiple sequence alignment for each entry but has refused to send them since 2026 (HTTP 403):
MaveScape does not ask for them, and reads conservation from PDBe-KB's profile or your own
alignment.

## Requests

Each request the page can make of the program, the request the program makes in turn, and what
leaves your computer.

| The page asks | The program asks | What is sent | For | Cached |
| --- | --- | --- | --- | --- |
| `/api/fetch/uniprot/{accession}` | `https://rest.uniprot.org/uniprotkb/{accession}.json?fields=accession,id,protein_name,gene_names,organism_name,length,sequence` | a UniProt accession (P62993) | the entry's names, organism and sequence, to place the target in it (Experiment, Target: **Check against UniProt**; the `check_target` action) | 30 days; up to 8 MB |
| `/api/fetch/uniparc` with `?sequence=…` | `https://rest.uniprot.org/uniparc/sequence?sequence={sequence}&fields=upi,accession,organism,protein,gene&dbTypes=UniProtKB/Swiss-Prot,UniProtKB/Swiss-Prot%20protein%20isoforms,UniProtKB/TrEMBL&active=true` | **a protein sequence (the target's), only once you confirm** | the UniProt entries with exactly that sequence, to find a target that has no accession (Experiment, Target: **Find in UniProt by sequence…**) | kept; up to 16 MB |
| `/api/fetch/mavedb/score-sets/{urn}` | `https://api.mavedb.org/api/v1/score-sets/{urn}` | a MaveDB URN (urn:mavedb:00000835-a-1) | the score set's record: its title, target, license, publications, keywords, columns and calibrations (Open from MaveDB; `open_mavedb`; `mavescape --mavedb`; a score set kept beside a workspace to compare, Compare's Other sources, `compare` with a URN, `add_track` `mavedb-scores`) | 7 days; up to 32 MB |
| `/api/fetch/mavedb/score-sets/{urn}/scores` | `https://api.mavedb.org/api/v1/score-sets/{urn}/scores` | a MaveDB URN | the score set's published scores (CSV), also of a score set kept beside a workspace to compare | 30 days; up to 256 MB |
| `/api/fetch/mavedb/score-sets/{urn}/counts` | `https://api.mavedb.org/api/v1/score-sets/{urn}/counts` | a MaveDB URN | the counts the authors deposited beside the scores (CSV), when they did | 30 days; up to 256 MB |
| `/api/fetch/mavedb/score-sets/{urn}/mapped-variants` | `https://api.mavedb.org/api/v1/score-sets/{urn}/mapped-variants` | a MaveDB URN | MaveDB's mapping of the score set's variants to the human reference: VRS identifiers, HGVS on the reference, ClinGen allele IDs (Open from MaveDB, **Mapped variants**, when you tick it) | 7 days; up to 256 MB |
| `/api/fetch/ncbi/nuccore/{accession}` | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id={accession}&rettype=gb&retmode=text&tool=mavescape` | a RefSeq or GenBank nucleotide accession (NM_007294.3) | the record's sequence and features (GenBank), for a score set's target named by a RefSeq transcript, or a target fetched by its accession (Experiment, Target) | 30 days; up to 32 MB |
| `/api/fetch/ensembl/transcript/{id}` | `https://rest.ensembl.org/sequence/id/{id}?type=cdna&mask_feature=1` | an Ensembl transcript identifier, without its version (ENST00000460680) | the transcript's sequence in Ensembl's current release, its coding part in capitals, for a score set's target named by an Ensembl transcript | 30 days; up to 16 MB |
| `/api/fetch/uniprot/{accession}/features` | `https://rest.uniprot.org/uniprotkb/{accession}.json?fields=accession,sequence,ft_domain,ft_region,ft_repeat,ft_zn_fing,ft_dna_bind,ft_compbias,ft_coiled,ft_motif,ft_topo_dom,ft_transmem,ft_intramem,ft_signal,ft_transit,ft_propep,ft_act_site,ft_binding,ft_site,ft_mod_res,ft_lipid,ft_carbohyd,ft_disulfid,ft_crosslnk,ft_helix,ft_strand,ft_turn` | a UniProt accession (P62993) | the entry's features: domains, regions, motifs, sites, modified residues and secondary structure, as tracks beside the map (Map, Tracks: **UniProt features**; `add_track`) | 30 days; up to 16 MB |
| `/api/fetch/pdbe/conservation/{accession}` | `https://www.ebi.ac.uk/pdbe/graph-api/uniprot/sequence_conservation/{accession}` | a UniProt accession | each position's amino-acid probabilities in a profile of the protein's homologues (PDBe-KB, from 3DPatch's HMMER search), as a conservation track | 30 days; up to 16 MB |
| `/api/fetch/alphafold/{accession}/missense` | `https://alphafold.ebi.ac.uk/files/AF-{accession}-F1-aa-substitutions.csv` | a UniProt accession (canonical, without an isoform) | AlphaMissense's pathogenicity of every substitution of a human protein (CSV), as a track and beside each variant | 30 days; up to 64 MB |
| `/api/fetch/clinvar/search` with `?gene=…&page=…` | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term={term}&retmax=10000&retstart={start}&retmode=json&tool=mavescape` | a gene's symbol and the page of results, in the term `GRB2[gene] AND ("missense variant"[molecular consequence] OR "nonsense"[molecular consequence] OR "synonymous variant"[molecular consequence])` | the numbers of the ClinVar records of the gene's missense, nonsense and synonymous variants, 10,000 a page | 7 days; up to 16 MB |
| `/api/fetch/clinvar/summary` with `?ids=…` | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id={ids}&retmode=json&tool=mavescape` | up to 500 ClinVar record numbers (from the search) | each record's variant, classification, review status and date | 7 days; up to 32 MB |
| `/api/fetch/gnomad/gene/{symbol}` | `https://gnomad.broadinstitute.org/api` (POST, GraphQL: the gene's identifiers and MANE Select transcript) | a gene's symbol (GRB2) | which transcript's variants to ask for | 30 days; up to 1 MB |
| `/api/fetch/gnomad/transcript/{id}` | `https://gnomad.broadinstitute.org/api` (POST, GraphQL: the transcript's variants in gnomAD v4, `gnomad_r4`) | an Ensembl transcript identifier (ENST00000316804) | each variant's change to the protein and its allele count and number, exomes and genomes joined, as a track | 30 days; up to 128 MB |
| `/api/fetch/mavedb/score-sets/{urn}/namespaces` | `https://api.mavedb.org/api/v1/score-sets/{urn}/csv-namespaces` | a MaveDB URN | which annotations MaveDB keeps for the score set's variants (gnomAD, ClinVar's releases) | 7 days; up to 4 MB |
| `/api/fetch/mavedb/score-sets/{urn}/annotations` with `?clinvar=…` | `https://api.mavedb.org/api/v1/score-sets/{urn}/variants/data?namespaces=gnomad&namespaces=clinvar.{release}` | a MaveDB URN and a ClinVar release (2026_01) | MaveDB's annotations of the score set's variants: gnomAD's frequencies and ClinVar's classifications, by variant (CSV) | 30 days; up to 256 MB |
| `/api/fetch/mavedb/search` with `?text=…&page=…` | `https://api.mavedb.org/api/v1/score-sets/search` (POST `{"text": …, "published": true, "limit": 100, "offset": …}`) | the words searched for (GRB2, abundance…) and the page of results | the published score sets that match, 100 at a time (Open from MaveDB; `search_mavedb`) | 1 day; up to 32 MB |
| `/api/fetch/pdb/{id}` | `https://files.rcsb.org/download/{id}.cif.gz` | a PDB ID (2VWF) | the entry's coordinates (mmCIF, compressed as RCSB keeps it), with its chains and biological assemblies, for the Structure view (Structure: **Open a structure**; `open_structure`) | 30 days; up to 512 MB compressed |
| `/api/fetch/alphafold/{accession}/prediction` | `https://alphafold.ebi.ac.uk/api/prediction/{accession}` | a UniProt accession (P62993, or an isoform's, P62993-2) | the protein's AlphaFold DB entries: each model's version, the residues it covers and its mean confidence, to ask for the latest model | 30 days; up to 4 MB |
| `/api/fetch/alphafold/{accession}/model/{version}` | `https://alphafold.ebi.ac.uk/files/AF-{accession}-F1-model_v{version}.cif` | a UniProt accession and the model's version (6) | the predicted model (mmCIF, compressed as AlphaFold DB stores it) with each residue's confidence (pLDDT), for the Structure view | 30 days; up to 256 MB compressed |
| `/api/fetch/alphafold/{accession}/pae/{version}` | `https://alphafold.ebi.ac.uk/files/AF-{accession}-F1-predicted_aligned_error_v{version}.json` | a UniProt accession and the model's version (6) | the model's predicted aligned error (PAE), by which a predicted model's exposure and disorder are read (Structure as evidence, MaveScape 0.5) | 30 days; up to 256 MB |
| `/api/fetch/pdbe/best-structures/{accession}` | `https://www.ebi.ac.uk/pdbe/graph-api/mappings/best_structures/{accession}` | a UniProt accession (P62993) | the PDB entries that cover the protein: each chain with the UniProt residues SIFTS places on it, its method and resolution, ranked for the target (Structure: **Structures of the target**; `find_structures`) | 30 days; up to 32 MB |

The program also answers two requests of its own, which contact nothing: `/api/fetch` (the mode,
the cache's folder, these hosts and requests) and `/api/fetch/cache` (what is in the cache).

## A request that sends a sequence

Your target's sequence may be unpublished. The program will not send it unless the request
carries the header `X-MaveScape-Confirm: send-sequence`, which the page adds only when you click
**Send it** in a dialog that shows the whole request, sequence included. Without it, the program
answers HTTP 428 with the exact request it would make, and sends nothing. A lookup already in the
cache is answered from it, sending nothing. No remote-control action sends a sequence: only the
person at the window can decide to.

## A MaveDB deposit stays here

A MaveDB deposit (MaveScape 0.3: the run's Export menu, **Deposit in MaveDB**; `mavescape export
--format mavedb`) is written on your computer from what the workspace holds, and checked there:
MaveScape never sends your scores, counts or variant names to MaveDB (not to its `/hgvs/validate`,
not to its upload). You upload the package yourself, on mavedb.org or through its API, when you
decide to. None of the requests above writes to MaveDB; of MaveDB's, only the search is a POST
(gnomAD's queries are POSTs too, as its GraphQL API takes them, and write nothing).

## What every request carries

- `User-Agent: MaveScape/<version> (local research software; docs/NETWORK.md)`
- `Accept: application/json` (`text/csv` for a table, `text/plain` for a GenBank record, `*/*` with
  `Accept-Encoding: gzip` for a structure, so it comes compressed as the service keeps it), and
  `Content-Type: application/json` with a POST's body (MaveDB's search, gnomAD's GraphQL queries)
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
  line), or a structure where the request is for one (mmCIF or PDB, compressed or not; a
  compressed one is read to its end, which checks its length and checksum, and may expand to 2 GB
  at most), is accepted from the requests above. NCBI and Ensembl answer an unknown accession with
  HTTP 400: it is read as "not found". gnomAD answers an unknown gene or transcript with HTTP 200 and
  an error in its GraphQL answer: also read as "not found"; any other error in it is refused, and
  not cached.
- **Redirects** stay on the same host, at most five, and are checked against the list too.
- **Time.** 45 seconds for a service to start answering, 120 for the whole answer.
- **Retries.** An answer of HTTP 429, 502, 503 or 504, or no answer, is tried twice more, after 1
  and 3 seconds (or the `Retry-After` the service asks, up to 10 seconds). MaveDB answers some
  requests with 504 after about ten seconds and succeeds on the next.

## The cache

Each answer is a file in `<cache dir>/<kind>/`, named by the accession (`uniprot/P62993.json`), by
a score set's URN without its colons (`mavedb/urn_mavedb_00000835-a-1.json`, `….scores.csv`,
`….counts.csv`, `….mapped.json`), by a nucleotide accession (`ncbi/NM_007294.3.gb`), by an
Ensembl transcript without its version (`ensembl/ENST00000460680.json`), by a structure's file
name upstream (`pdb/2VWF.cif.gz`, `alphafold/AF-P62993-F1-model_v6.cif`, kept compressed as it
came: the page decompresses it), by an accession for its structures (`pdbe/P62993.best-structures.json`), by the SHA-256 of a search's words and page
(`mavedb-search/<sha256>.json`) or,
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
  request sends a deposit to MaveDB or writes to it (`TestNoRequestSendsADepositToMaveDB`); no
  script in the page names another origin in a request. `structures_test.go`: the structure
  requests send a PDB ID or an accession only, keep the bytes the service sent (compressed), and
  refuse a cut-off file or a page that is not a structure, keeping neither.
- `validation/remote-session.mjs` drives a whole session offline, and records every request the
  page makes: none goes beyond its own origin.
- `validation/mavedb-live.mjs` opens the feasibility records from MaveDB, live (CI runs it), and
  checks that the tables MaveDB sends are the ones the validation pins.
