package main

// Public data (wave 3, slice 1; requirement P3). MaveScape reaches the internet only here: only for
// the requests in publicRequests, which docs/NETWORK.md lists (TestNetworkDocumentListsEveryRequest
// checks it), and only on the hosts in publicHosts, which every request is checked against as it
// is sent, redirects included. Requests carry public identifiers (accessions, URNs); one that
// would send a sequence is made only once the person has seen what it sends and confirmed it (the
// page asks; the host refuses the request without its confirmation). Every response is cached
// with its retrieval record (cache.go). --offline serves cached copies only and contacts nothing;
// --no-fetch switches the feature off. The download, limit and serve parts are adapted from
// Proteoscope 0.10.0 fetch.go; the host list, retries, revalidation and the confirmation are new.

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	maxDownloadBytes = 256 << 20
	jsonContentType  = "application/json"
	noFetchMessage   = "Public data are switched off (mavescape --no-fetch)."
	// The header with which the page confirms that a request may send a sequence.
	confirmHeader   = "X-MaveScape-Confirm"
	confirmSequence = "send-sequence"
	// The longest sequence looked up (UniProt reads it from the URL).
	maxLookupResidues = 5000
	userAgent         = "MaveScape/%s (local research software; docs/NETWORK.md)"
)

// A host MaveScape may contact, and the path its requests stay under.
type publicHost struct {
	Host    string `json:"host"`
	Path    string `json:"path"`
	Service string `json:"service"`
}

// The hosts MaveScape may contact; nothing else (docs/NETWORK.md, "Hosts").
var publicHosts = []publicHost{
	{Host: "api.mavedb.org", Path: "/api/", Service: "MaveDB"},
	{Host: "rest.uniprot.org", Path: "/", Service: "UniProt"},
	{Host: "files.rcsb.org", Path: "/", Service: "RCSB PDB"},
	{Host: "data.rcsb.org", Path: "/", Service: "RCSB PDB"},
	{Host: "www.ebi.ac.uk", Path: "/pdbe/", Service: "PDBe"},
	{Host: "alphafold.ebi.ac.uk", Path: "/", Service: "AlphaFold DB"},
	{Host: "eutils.ncbi.nlm.nih.gov", Path: "/entrez/eutils/", Service: "NCBI E-utilities"},
	{Host: "rest.ensembl.org", Path: "/", Service: "Ensembl"},
	{Host: "gnomad.broadinstitute.org", Path: "/api", Service: "gnomAD"},
}

var (
	errNotAllowed       = errors.New("not on MaveScape's list of public services (docs/NETWORK.md)")
	errUpstreamNotFound = errors.New("not found upstream")
	errTooLarge         = errors.New("download too large")
	accessionPattern    = regexp.MustCompile(`^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-[0-9]+)?$`)
	sequencePattern     = regexp.MustCompile(`^[ACDEFGHIKLMNPQRSTVWYUOXBZ]+$`)
)

// permitPublic allows a URL only on a listed host, under its path, over HTTPS on the default port,
// with no user name and no dot segments.
func permitPublic(u *url.URL) error {
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	refuse := func(why string) error { return fmt.Errorf("%s (%s): %w", host, why, errNotAllowed) }
	if u.Scheme != "https" {
		return refuse("not HTTPS")
	}
	if u.User != nil {
		return refuse("a user name in the address")
	}
	if port := u.Port(); port != "" && port != "443" {
		return refuse("port " + port)
	}
	p := u.EscapedPath()
	if p == "" {
		p = "/"
	}
	if clean := path.Clean(p); clean != p && clean+"/" != p {
		return refuse("a path with dot segments or empty parts")
	}
	for _, allowed := range publicHosts {
		if host == allowed.Host {
			if underPath(p, allowed.Path) {
				return nil
			}
			return refuse("outside " + allowed.Path)
		}
	}
	return refuse("an unlisted host")
}

func underPath(p, prefix string) bool {
	if strings.HasSuffix(prefix, "/") {
		return strings.HasPrefix(p, prefix)
	}
	return p == prefix || strings.HasPrefix(p, prefix+"/")
}

// guardedTransport checks every request as it is sent, the first and each redirect.
type guardedTransport struct {
	permit func(*url.URL) error
	next   http.RoundTripper
}

func (g guardedTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if err := g.permit(r.URL); err != nil {
		return nil, err
	}
	return g.next.RoundTrip(r)
}

// A request MaveScape can make: the route the page asks, what it asks upstream, and what leaves the
// computer (docs/NETWORK.md, "Requests").
type publicRequest struct {
	Route    string `json:"route"`
	Service  string `json:"service"`
	Upstream string `json:"upstream"`
	Sends    string `json:"sends"`
	Why      string `json:"why"`
	// Sequence: the request sends a sequence, and is made only once the person confirms it.
	Sequence bool `json:"sequence"`
	// Method: GET, or POST with the body resolve makes (a search).
	Method string `json:"method"`
	// Format: what the answer must be, JSON or CSV.
	Format string `json:"format"`
	// The cache folder, how long a copy is used before it is checked again (negative: always), the
	// largest response accepted, and the response header that names the service's release.
	Kind    string        `json:"-"`
	MaxAge  time.Duration `json:"-"`
	Limit   int64         `json:"-"`
	Version string        `json:"-"`
	// Missing: an upstream status other than 404 that means "no such record" (NCBI and Ensembl
	// answer an unknown accession with HTTP 400).
	Missing int `json:"-"`
	// resolve: the cache entry's name, the upstream URL and a POST's body, or what is wrong with
	// the request.
	resolve  func(r *http.Request) (call, error)
	notFound func(r *http.Request) string
	// answer: a check of a JSON answer beyond its being JSON (gnomAD's GraphQL answers an unknown
	// gene with HTTP 200 and an error): errUpstreamNotFound, another error, or nil.
	answer func(body []byte) error
}

// A request resolved: the cache entry's name, the URL asked for, and a POST's body.
type call struct {
	name, source string
	body         []byte
}

const (
	formatJSON         = "json"
	formatCSV          = "csv"
	formatGenBank      = "genbank"
	csvContentType     = "text/csv; charset=utf-8"
	genbankContentType = "text/plain; charset=utf-8"
)

func (r publicRequest) method() string {
	if r.Method == "" {
		return http.MethodGet
	}
	return r.Method
}

func (r publicRequest) contentType() string {
	switch r.Format {
	case formatCSV:
		return csvContentType
	case formatGenBank:
		return genbankContentType
	}
	return jsonContentType
}

const (
	uniprotEntryFields = "accession,id,protein_name,gene_names,organism_name,length,sequence"
	// UniParc's answer limited to the active UniProtKB entries.
	uniparcQuery = "&fields=upi,accession,organism,protein,gene&dbTypes=UniProtKB/Swiss-Prot,UniProtKB/Swiss-Prot%20protein%20isoforms,UniProtKB/TrEMBL&active=true"
)

var publicRequests = []publicRequest{
	{
		Route:    "GET /api/fetch/uniprot/{accession}",
		Service:  "UniProt",
		Upstream: "https://rest.uniprot.org/uniprotkb/{accession}.json?fields=" + uniprotEntryFields,
		Sends:    "a UniProt accession (P62993)",
		Why:      "the entry's names, organism and sequence, to place the target in it",
		Format:   formatJSON,
		Kind:     "uniprot", MaxAge: defaultCacheMaxAge, Limit: 8 << 20, Version: "X-UniProt-Release",
		resolve: func(r *http.Request) (call, error) {
			accession, ok := normalizeAccession(r.PathValue("accession"))
			if !ok {
				return call{}, errors.New("Not a UniProt accession: give one such as P62993 or P62993-2.")
			}
			return call{name: accession + ".json", source: "https://rest.uniprot.org/uniprotkb/" + accession + ".json?fields=" + uniprotEntryFields}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("UniProt has no entry %s.", strings.ToUpper(r.PathValue("accession")))
		},
	},
	{
		Route:    "GET /api/fetch/uniparc",
		Service:  "UniProt",
		Upstream: "https://rest.uniprot.org/uniparc/sequence?sequence={sequence}" + uniparcQuery,
		Sends:    "a protein sequence (the target's)",
		Why:      "the entries with exactly that sequence, to find a target that has no accession",
		Sequence: true,
		Format:   formatJSON,
		Kind:     "uniparc", MaxAge: -1, Limit: 16 << 20, Version: "X-UniProt-Release",
		resolve: func(r *http.Request) (call, error) {
			sequence := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("sequence")))
			switch {
			case sequence == "":
				return call{}, errors.New("Give the protein sequence to look up (?sequence=…).")
			case !sequencePattern.MatchString(sequence):
				return call{}, errors.New("A protein sequence is written in the one-letter amino-acid code, without stops or gaps.")
			case len(sequence) > maxLookupResidues:
				return call{}, fmt.Errorf("UniProt looks up sequences of up to %d residues; this one has %d.", maxLookupResidues, len(sequence))
			}
			return call{name: sha256Hex(sequence) + ".json", source: "https://rest.uniprot.org/uniparc/sequence?sequence=" + sequence + uniparcQuery}, nil
		},
		notFound: func(*http.Request) string {
			return "No UniProt entry has exactly this sequence. A domain or a construct is found by its protein's accession instead."
		},
	},
	// MaveDB (wave 3, slice 2): a score set's record, its scores and counts, and the search.
	{
		Route:    "GET /api/fetch/mavedb/score-sets/{urn}",
		Service:  "MaveDB",
		Upstream: mavedbAPI + "/score-sets/{urn}",
		Sends:    "a MaveDB URN (urn:mavedb:00000835-a-1)",
		Why:      "the score set's record: its title, target, license, publications, keywords, columns and calibrations",
		Format:   formatJSON,
		Kind:     "mavedb", MaxAge: 7 * 24 * time.Hour, Limit: 32 << 20,
		resolve: mavedbCall("", ".json"),
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("MaveDB has no published score set %s.", r.PathValue("urn"))
		},
	},
	{
		Route:    "GET /api/fetch/mavedb/score-sets/{urn}/scores",
		Service:  "MaveDB",
		Upstream: mavedbAPI + "/score-sets/{urn}/scores",
		Sends:    "a MaveDB URN",
		Why:      "the score set's published scores (CSV)",
		Format:   formatCSV,
		Kind:     "mavedb", MaxAge: defaultCacheMaxAge, Limit: maxDownloadBytes,
		resolve: mavedbCall("/scores", ".scores.csv"),
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("MaveDB has no published score set %s.", r.PathValue("urn"))
		},
	},
	{
		Route:    "GET /api/fetch/mavedb/score-sets/{urn}/counts",
		Service:  "MaveDB",
		Upstream: mavedbAPI + "/score-sets/{urn}/counts",
		Sends:    "a MaveDB URN",
		Why:      "the counts the authors deposited beside the scores (CSV)",
		Format:   formatCSV,
		Kind:     "mavedb", MaxAge: defaultCacheMaxAge, Limit: maxDownloadBytes,
		resolve: mavedbCall("/counts", ".counts.csv"),
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("MaveDB has no published score set %s.", r.PathValue("urn"))
		},
	},
	{
		Route:    "GET /api/fetch/mavedb/score-sets/{urn}/mapped-variants",
		Service:  "MaveDB",
		Upstream: mavedbAPI + "/score-sets/{urn}/mapped-variants",
		Sends:    "a MaveDB URN",
		Why:      "MaveDB's mapping of the score set's variants to the human reference: VRS identifiers, HGVS on the reference, ClinGen allele IDs",
		Format:   formatJSON,
		Kind:     "mavedb", MaxAge: 7 * 24 * time.Hour, Limit: maxDownloadBytes,
		resolve: mavedbCall("/mapped-variants", ".mapped.json"),
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("MaveDB has no mapped variants for %s.", r.PathValue("urn"))
		},
	},
	{
		Route:    "GET /api/fetch/mavedb/search",
		Service:  "MaveDB",
		Method:   http.MethodPost,
		Upstream: mavedbAPI + "/score-sets/search",
		Sends:    "the words searched for (GRB2, abundance…) and the page of results",
		Why:      "the published score sets that match, 100 at a time",
		Format:   formatJSON,
		Kind:     "mavedb-search", MaxAge: 24 * time.Hour, Limit: 32 << 20,
		resolve: func(r *http.Request) (call, error) {
			text := strings.Join(strings.Fields(r.URL.Query().Get("text")), " ")
			page := 1
			if raw := r.URL.Query().Get("page"); raw != "" {
				n, err := strconv.Atoi(raw)
				if err != nil || n < 1 || n > maxSearchPages {
					return call{}, fmt.Errorf("The page of results is a whole number from 1 to %d.", maxSearchPages)
				}
				page = n
			}
			switch {
			case text == "":
				return call{}, errors.New("Give the words to search MaveDB for (?text=…).")
			case len(text) > maxSearchText || strings.IndexFunc(text, unicode.IsControl) >= 0:
				return call{}, fmt.Errorf("A search is up to %d characters of text.", maxSearchText)
			}
			body, err := json.Marshal(mavedbSearch{Text: text, Published: true, Limit: mavedbPage, Offset: (page - 1) * mavedbPage})
			if err != nil {
				return call{}, err
			}
			return call{name: sha256Hex(fmt.Sprintf("%s\x00%d", strings.ToLower(text), page)) + ".json", source: mavedbAPI + "/score-sets/search", body: body}, nil
		},
		notFound: func(*http.Request) string { return "MaveDB's search did not answer." },
	},
}

// Targets named by an accession (wave 3, slice 3): a RefSeq or GenBank record from NCBI, and an
// Ensembl transcript's sequence.
var accessionRequests = []publicRequest{
	{
		Route:    "GET /api/fetch/ncbi/nuccore/{accession}",
		Service:  "NCBI E-utilities",
		Upstream: ncbiEfetch + "?db=nuccore&id={accession}&rettype=gb&retmode=text&tool=mavescape",
		Sends:    "a RefSeq or GenBank nucleotide accession (NM_007294.3)",
		Why:      "the record's sequence and features (GenBank), for a target named by its transcript",
		Format:   formatGenBank,
		Kind:     "ncbi", MaxAge: defaultCacheMaxAge, Limit: 32 << 20, Missing: http.StatusBadRequest,
		resolve: func(r *http.Request) (call, error) {
			accession, ok := normalizeNucleotideAccession(r.PathValue("accession"))
			if !ok {
				return call{}, errors.New("Not a nucleotide accession: give one such as NM_007294.3 or L09137.")
			}
			return call{name: accession + ".gb", source: ncbiEfetch + "?db=nuccore&id=" + accession + "&rettype=gb&retmode=text&tool=mavescape"}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("NCBI has no nucleotide record %s.", strings.ToUpper(r.PathValue("accession")))
		},
	},
	{
		Route:    "GET /api/fetch/ensembl/transcript/{id}",
		Service:  "Ensembl",
		Upstream: "https://rest.ensembl.org/sequence/id/{id}?type=cdna&mask_feature=1",
		Sends:    "an Ensembl transcript identifier, without its version (ENST00000460680)",
		Why:      "the transcript's sequence in Ensembl's current release, its coding part in capitals, for a target named by its transcript",
		Format:   formatJSON,
		Kind:     "ensembl", MaxAge: defaultCacheMaxAge, Limit: 16 << 20, Missing: http.StatusBadRequest,
		resolve: func(r *http.Request) (call, error) {
			id, ok := normalizeEnsemblTranscript(r.PathValue("id"))
			if !ok {
				return call{}, errors.New("Not an Ensembl transcript: give one such as ENST00000460680.")
			}
			return call{name: id + ".json", source: "https://rest.ensembl.org/sequence/id/" + id + "?type=cdna&mask_feature=1"}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("Ensembl has no transcript %s in its current release.", strings.ToUpper(r.PathValue("id")))
		},
	},
}

func init() {
	publicRequests = append(publicRequests, accessionRequests...)
}

const ncbiEfetch = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

var (
	// RefSeq (NM_007294.3) and INSDC (L09137.2) nucleotide accessions.
	nucleotidePattern = regexp.MustCompile(`^((AC|NC|NG|NM|NR|NT|NW|NZ|XM|XR)_[0-9]{6,9}|[A-Z][0-9]{5}|[A-Z]{2}[0-9]{6,8})(\.[0-9]+)?$`)
	// Ensembl transcripts, of human (ENST) and other species (ENSMUST…); the version is dropped,
	// Ensembl serving its current release only.
	ensemblTranscriptPattern = regexp.MustCompile(`^(ENS[A-Z]*T[0-9]{11})(\.[0-9]+)?$`)
)

func normalizeNucleotideAccession(raw string) (string, bool) {
	accession := strings.ToUpper(strings.TrimSpace(raw))
	return accession, nucleotidePattern.MatchString(accession)
}

func normalizeEnsemblTranscript(raw string) (string, bool) {
	m := ensemblTranscriptPattern.FindStringSubmatch(strings.ToUpper(strings.TrimSpace(raw)))
	if m == nil {
		return "", false
	}
	return m[1], true
}

const (
	mavedbAPI = "https://api.mavedb.org/api/v1"
	// MaveDB returns at most 100 score sets a page.
	mavedbPage     = 100
	maxSearchPages = 100
	maxSearchText  = 200
)

// MaveDB's search, as its API takes it (POST /score-sets/search).
type mavedbSearch struct {
	Text      string `json:"text"`
	Published bool   `json:"published"`
	Limit     int    `json:"limit"`
	Offset    int    `json:"offset"`
}

// A published score set's URN (urn:mavedb:00000835-a-1); temporary ones (tmp:…) are not public.
var mavedbURN = regexp.MustCompile(`^urn:mavedb:[0-9]{8}-[a-z0-9]+-[0-9]+$`)

func normalizeURN(raw string) (string, bool) {
	urn := strings.ToLower(strings.TrimSpace(raw))
	return urn, mavedbURN.MatchString(urn)
}

// Score sets to open in the window, named on the command line (mavescape --mavedb urn:…) or by a
// later launch; each with an id, so the page opens it once (wave 3, slice 2).
type startupRecord struct {
	ID  int    `json:"id"`
	URN string `json:"urn"`
}

type startupRecords struct {
	mu      sync.Mutex
	records []startupRecord
}

// add takes URNs (and MaveDB addresses that hold one), and returns what is not a published score
// set's URN.
func (s *startupRecords) add(urns []string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var problems []string
	for _, raw := range urns {
		found := mavedbURNIn.FindString(strings.ToLower(raw))
		if urn, ok := normalizeURN(found); ok {
			s.records = append(s.records, startupRecord{ID: len(s.records) + 1, URN: urn})
		} else {
			problems = append(problems, fmt.Sprintf("%q is not the URN of a published MaveDB score set (urn:mavedb:00000835-a-1).", raw))
		}
	}
	return problems
}

func (s *startupRecords) list() []startupRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]startupRecord{}, s.records...)
}

var mavedbURNIn = regexp.MustCompile(`urn:mavedb:[0-9]{8}-[a-z0-9]+-[0-9]+`)

// looksLikeURN: a command-line argument that names a score set rather than a file.
func looksLikeURN(arg string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(arg)), "urn:mavedb:")
}

// mavedbCall resolves a request about a score set: its URL (the score set's, then suffix) and its
// cache name (the URN without colons, which some file systems refuse, then extension).
func mavedbCall(suffix, extension string) func(r *http.Request) (call, error) {
	return func(r *http.Request) (call, error) {
		urn, ok := normalizeURN(r.PathValue("urn"))
		if !ok {
			return call{}, errors.New("Not the URN of a published MaveDB score set: give one such as urn:mavedb:00000835-a-1.")
		}
		return call{name: strings.ReplaceAll(urn, ":", "_") + extension, source: mavedbAPI + "/score-sets/" + urn + suffix}, nil
	}
}

func sha256Hex(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

func requestOfKind(kind string) (publicRequest, bool) {
	for _, request := range publicRequests {
		if request.Kind == kind {
			return request, true
		}
	}
	return publicRequest{}, false
}

func normalizeAccession(raw string) (string, bool) {
	accession := strings.ToUpper(strings.TrimSpace(raw))
	return accession, accessionPattern.MatchString(accession)
}

// --- The fetcher ----------------------------------------------------------------------------------

type fetcher struct {
	// on, offline (cached copies only) or off (--no-fetch).
	mode  string
	cache *diskCache
	// remote: nil when offline or off, so nothing can be sent.
	remote *upstream
	// origins: the address each listed origin is reached at (tests point them at local servers).
	origins map[string]string
	now     func() time.Time
}

func fetchMode(cfg config) string {
	switch {
	case cfg.noFetch:
		return "off"
	case cfg.offline:
		return "offline"
	default:
		return "on"
	}
}

func newFetcher(cfg config) *fetcher {
	f := &fetcher{mode: fetchMode(cfg), now: time.Now}
	if f.mode == "off" {
		return f
	}
	f.cache = openCache(cfg.cacheDir)
	if f.mode == "on" {
		f.remote = newUpstream(permitPublic)
	}
	return f
}

func (f *fetcher) describe() string {
	switch {
	case f.mode == "off":
		return "Public data: off (--no-fetch)"
	case f.cache == nil && f.mode == "offline":
		return "Public data: offline, and no cache"
	case f.cache == nil:
		return "Public data: from the listed services (docs/NETWORK.md), not cached"
	case f.mode == "offline":
		return "Public data: offline, copies already in " + f.cache.dir + " only"
	default:
		return "Public data: from the listed services (docs/NETWORK.md), cached in " + f.cache.dir
	}
}

func (f *fetcher) register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/fetch", f.status)
	if f.mode == "off" {
		mux.HandleFunc("/api/fetch/", func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusForbidden, noFetchMessage)
		})
		return
	}
	mux.HandleFunc("GET /api/fetch/cache", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"entries": f.cache.list()})
	})
	for _, request := range publicRequests {
		mux.HandleFunc(request.Route, f.serve(request))
	}
}

// GET /api/fetch: the mode, the cache's folder, the hosts and the requests.
func (f *fetcher) status(w http.ResponseWriter, r *http.Request) {
	body := map[string]any{"mode": f.mode, "hosts": publicHosts, "requests": publicRequests}
	if f.cache != nil {
		body["cache"] = f.cache.dir
	}
	writeJSON(w, body)
}

// serve answers a request from the cache while its copy is fresh ("?refresh=1" asks again); else
// asks the service, confirming an unchanged copy by its ETag or date; and serves an older copy,
// marked stale, when the service cannot be reached or MaveScape is offline.
func (f *fetcher) serve(request publicRequest) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := request.resolve(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		name, source := c.name, c.source
		refresh := r.URL.Query().Get("refresh") != ""
		entry, ok, stale := f.cache.load(request.Kind, name, request.MaxAge)
		if ok && !stale && !refresh {
			writeCached(w, entry, "hit")
			return
		}
		if f.remote == nil {
			if ok {
				writeCached(w, entry, "stale")
				return
			}
			writeError(w, http.StatusForbidden, fmt.Sprintf("MaveScape is running with --offline: it serves only copies already in its cache, and has none of this %s request.", request.Service))
			return
		}
		if request.Sequence && r.Header.Get(confirmHeader) != confirmSequence {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusPreconditionRequired)
			json.NewEncoder(w).Encode(map[string]any{
				"error":   fmt.Sprintf("This request sends %s to %s: MaveScape makes it only once you have confirmed it.", request.Sends, request.Service),
				"confirm": map[string]string{"service": request.Service, "host": hostOf(source), "url": source, "sends": request.Sends, "why": request.Why},
			})
			return
		}
		var previous *cacheMeta
		if ok {
			previous = &entry.meta
		}
		fresh, err := f.remote.get(r.Context(), f.origin(source), request, previous, c.body)
		if err != nil {
			log.Printf("fetch %s/%s: %v", request.Kind, name, err)
			if ok && !errors.Is(err, errUpstreamNotFound) {
				writeCached(w, entry, "stale")
				return
			}
			if errors.Is(err, errUpstreamNotFound) {
				writeError(w, http.StatusNotFound, request.notFound(r))
				return
			}
			writeFetchError(w, err)
			return
		}
		now := f.now().UTC()
		if fresh.notModified {
			writeCached(w, f.cache.touch(request.Kind, name, entry, now), "revalidated")
			return
		}
		// A request that sent a sequence is recorded without it: the cache keeps only public answers,
		// and the sequence's SHA-256 names the answer.
		recorded := source
		if request.Sequence {
			recorded = request.Upstream
		}
		entry = cached{body: fresh.body, meta: cacheMeta{
			ContentType: request.contentType(), Service: request.Service, Source: recorded, Method: request.Method, Request: string(c.body),
			Retrieved: now.Format(time.RFC3339), ETag: fresh.etag, LastModified: fresh.lastModified, Version: fresh.version,
		}}
		f.cache.store(request.Kind, name, entry)
		writeCached(w, entry, "miss")
	}
}

// origin: the URL to ask for a listed URL (itself, unless a test points its origin elsewhere).
func (f *fetcher) origin(source string) string {
	for from, to := range f.origins {
		if strings.HasPrefix(source, from+"/") {
			return to + strings.TrimPrefix(source, from)
		}
	}
	return source
}

func hostOf(source string) string {
	u, err := url.Parse(source)
	if err != nil {
		return ""
	}
	return u.Host
}

// writeCached sends a response with its retrieval record in X-MaveScape-* headers.
func writeCached(w http.ResponseWriter, entry cached, cacheStatus string) {
	header := w.Header()
	header.Set("Content-Type", entry.meta.ContentType)
	header.Set("Content-Length", strconv.Itoa(len(entry.body)))
	header.Set("Cache-Control", "no-store")
	header.Set("X-MaveScape-Cache", cacheStatus)
	for name, value := range map[string]string{
		"X-MaveScape-Service": entry.meta.Service, "X-MaveScape-Source": entry.meta.Source, "X-MaveScape-Retrieved": entry.meta.Retrieved,
		"X-MaveScape-Checked": entry.meta.Checked, "X-MaveScape-ETag": entry.meta.ETag, "X-MaveScape-Version": entry.meta.Version,
	} {
		if value != "" {
			header.Set(name, value)
		}
	}
	w.Write(entry.body)
}

type fetchError struct {
	status  int
	message string
	// upstream: the status the service answered with, when that caused the error.
	upstream int
	cause    error
}

func (e *fetchError) Error() string { return e.message }
func (e *fetchError) Unwrap() error { return e.cause }

func fetchErrorf(status int, format string, args ...any) error {
	return &fetchError{status: status, message: fmt.Sprintf(format, args...)}
}

func writeFetchError(w http.ResponseWriter, err error) {
	var fetchErr *fetchError
	if errors.As(err, &fetchErr) {
		writeError(w, fetchErr.status, fetchErr.message)
		return
	}
	writeError(w, http.StatusBadGateway, err.Error())
}

// --- Downloads ------------------------------------------------------------------------------------

type upstream struct {
	client *http.Client
	// The waits before each retry, and the longest Retry-After honored.
	retries []time.Duration
	maxWait time.Duration
}

func newUpstream(permit func(*url.URL) error) *upstream {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 45 * time.Second
	return &upstream{
		client:  &http.Client{Timeout: 120 * time.Second, Transport: guardedTransport{permit: permit, next: transport}, CheckRedirect: sameHostRedirect},
		retries: []time.Duration{time.Second, 3 * time.Second},
		maxWait: 10 * time.Second,
	}
}

var errRedirect = errors.New("redirect refused")

func sameHostRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return fmt.Errorf("too many redirects: %w", errRedirect)
	}
	if req.URL.Scheme != via[0].URL.Scheme || !strings.EqualFold(req.URL.Host, via[0].URL.Host) {
		return fmt.Errorf("to %s: %w", req.URL.Host, errRedirect)
	}
	// Go names the page redirected from; a redirected request carries nothing the first did not.
	req.Header.Del("Referer")
	return nil
}

type fetched struct {
	body                        []byte
	etag, lastModified, version string
	notModified                 bool
}

// get asks for source, retrying when the service is briefly unavailable (HTTP 429, 502, 503, 504,
// or no answer), with previous's ETag and date so that an unchanged copy is confirmed (HTTP 304)
// rather than sent again.
func (u *upstream) get(ctx context.Context, source string, request publicRequest, previous *cacheMeta, body []byte) (fetched, error) {
	for attempt := 0; ; attempt++ {
		result, wait, err := u.attempt(ctx, source, request, previous, body)
		if err == nil || wait < 0 || attempt >= len(u.retries) {
			return result, err
		}
		if wait == 0 || wait > u.maxWait {
			wait = u.retries[attempt]
		}
		select {
		case <-ctx.Done():
			return fetched{}, err
		case <-time.After(wait):
		}
	}
}

// attempt makes one request. wait is how long to wait before trying again: negative for an error
// that another try would not change, zero for the usual wait, or what the service asked.
func (u *upstream) attempt(ctx context.Context, source string, request publicRequest, previous *cacheMeta, payload []byte) (fetched, time.Duration, error) {
	var reader io.Reader
	if payload != nil {
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, request.method(), source, reader)
	if err != nil {
		return fetched{}, -1, err
	}
	req.Header.Set("User-Agent", fmt.Sprintf(userAgent, version))
	switch request.Format {
	case formatCSV:
		req.Header.Set("Accept", "text/csv")
	case formatGenBank:
		req.Header.Set("Accept", "text/plain")
	default:
		req.Header.Set("Accept", jsonContentType)
	}
	if payload != nil {
		req.Header.Set("Content-Type", jsonContentType)
	}
	if previous != nil {
		if previous.ETag != "" {
			req.Header.Set("If-None-Match", previous.ETag)
		}
		if previous.LastModified != "" {
			req.Header.Set("If-Modified-Since", previous.LastModified)
		}
	}
	resp, err := u.client.Do(req)
	if err != nil {
		if errors.Is(err, errNotAllowed) || errors.Is(err, errRedirect) || ctx.Err() != nil {
			return fetched{}, -1, &fetchError{status: http.StatusBadGateway, message: fmt.Sprintf("%s: %v", request.Service, unwrapURLError(err)), cause: err}
		}
		return fetched{}, 0, upstreamFailure(request.Service, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotModified && previous != nil:
		return fetched{notModified: true}, 0, nil
	case resp.StatusCode == http.StatusNotFound || (request.Missing != 0 && resp.StatusCode == request.Missing):
		return fetched{}, -1, errUpstreamNotFound
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusBadGateway || resp.StatusCode == http.StatusServiceUnavailable || resp.StatusCode == http.StatusGatewayTimeout:
		return fetched{}, retryAfter(resp.Header.Get("Retry-After")), &fetchError{status: http.StatusBadGateway, message: fmt.Sprintf("%s is not answering now (HTTP %d); try again later.", request.Service, resp.StatusCode), upstream: resp.StatusCode}
	case resp.StatusCode != http.StatusOK:
		return fetched{}, -1, &fetchError{status: http.StatusBadGateway, message: fmt.Sprintf("%s answered HTTP %d.", request.Service, resp.StatusCode), upstream: resp.StatusCode}
	case resp.ContentLength > request.Limit:
		return fetched{}, -1, tooLarge(request.Service, request.Limit)
	}
	body, err := decompressIfGzip(resp.Body)
	if err != nil {
		return fetched{}, -1, fetchErrorf(http.StatusBadGateway, "%s sent compressed data that could not be read: %v", request.Service, err)
	}
	data, err := readLimited(body, request.Limit)
	if errors.Is(err, errTooLarge) {
		return fetched{}, -1, tooLarge(request.Service, request.Limit)
	}
	if err != nil {
		return fetched{}, 0, upstreamFailure(request.Service, err)
	}
	switch {
	case request.Format == formatCSV:
		if !looksLikeCSV(data) {
			return fetched{}, -1, fetchErrorf(http.StatusBadGateway, "%s sent a response that is not a CSV table.", request.Service)
		}
	case request.Format == formatGenBank:
		if !looksLikeGenBank(data) {
			return fetched{}, -1, fetchErrorf(http.StatusBadGateway, "%s sent a response that is not a GenBank record.", request.Service)
		}
	case !json.Valid(data):
		return fetched{}, -1, fetchErrorf(http.StatusBadGateway, "%s sent a response that is not JSON.", request.Service)
	case request.answer != nil:
		if err := request.answer(data); err != nil {
			return fetched{}, -1, err
		}
	}
	log.Printf("fetched %s%s (%d bytes)", resp.Request.URL.Host, resp.Request.URL.Path, len(data))
	result := fetched{body: data, etag: resp.Header.Get("ETag"), lastModified: resp.Header.Get("Last-Modified")}
	if request.Version != "" {
		result.version = resp.Header.Get(request.Version)
	}
	return result, 0, nil
}

// looksLikeGenBank: a flat file that begins with its LOCUS line.
func looksLikeGenBank(data []byte) bool {
	return bytes.HasPrefix(bytes.TrimLeft(data, " \t\r\n\ufeff"), []byte("LOCUS "))
}

// looksLikeCSV: a header line with at least two comma-separated names, not a page of HTML or JSON.
func looksLikeCSV(data []byte) bool {
	text := bytes.TrimLeft(data, " \t\r\n\ufeff")
	if len(text) == 0 || text[0] == '<' || text[0] == '{' || text[0] == '[' {
		return false
	}
	line, _, _ := bytes.Cut(text, []byte("\n"))
	return bytes.Count(line, []byte(",")) >= 1
}

func unwrapURLError(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return urlErr.Err
	}
	return err
}

// retryAfter reads a Retry-After of seconds (zero when absent or a date).
func retryAfter(value string) time.Duration {
	if seconds, err := strconv.Atoi(strings.TrimSpace(value)); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	return 0
}

func tooLarge(service string, limit int64) error {
	return &fetchError{status: http.StatusBadGateway, message: fmt.Sprintf("%s sent more than MaveScape accepts for this request (%d MB).", service, limit>>20), cause: errTooLarge}
}

func upstreamFailure(service string, err error) error {
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return fetchErrorf(http.StatusGatewayTimeout, "%s did not answer in time.", service)
	}
	return fetchErrorf(http.StatusBadGateway, "Could not reach %s: %v", service, unwrapURLError(err))
}

// decompressIfGzip reads a body that is gzip-compressed once more (beyond any Content-Encoding the
// transport already undid); the limit applies to what comes out.
func decompressIfGzip(r io.Reader) (io.Reader, error) {
	buffered := bufio.NewReader(r)
	magic, err := buffered.Peek(2)
	if err != nil || magic[0] != 0x1f || magic[1] != 0x8b {
		return buffered, nil
	}
	return gzip.NewReader(buffered)
}

func readLimited(r io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errTooLarge
	}
	return data, nil
}
