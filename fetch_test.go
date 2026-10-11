package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// A stand-in for a public service: counts what it is asked, and answers with handler.
type fakeService struct {
	*httptest.Server
	mu       sync.Mutex
	requests []*http.Request
}

func newFakeService(t *testing.T, handler http.HandlerFunc) *fakeService {
	t.Helper()
	service := &fakeService{}
	service.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		service.mu.Lock()
		service.requests = append(service.requests, r.Clone(context.Background()))
		service.mu.Unlock()
		if want := "MaveScape/" + version + " "; !strings.HasPrefix(r.Header.Get("User-Agent"), want) {
			t.Errorf("User-Agent %q", r.Header.Get("User-Agent"))
		}
		for _, name := range []string{"Origin", "Cookie", "Referer", confirmHeader} {
			if r.Header.Get(name) != "" {
				t.Errorf("the request to the service carried %s", name)
			}
		}
		handler(w, r)
	}))
	t.Cleanup(service.Close)
	return service
}

func (s *fakeService) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.requests)
}

func (s *fakeService) last() *http.Request {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.requests[len(s.requests)-1]
}

// permitOnly allows plain HTTP to the given test servers, as permitPublic allows the listed hosts.
func permitOnly(servers ...*fakeService) func(*url.URL) error {
	return func(u *url.URL) error {
		for _, s := range servers {
			if base, _ := url.Parse(s.URL); u.Scheme == "http" && u.Host == base.Host {
				return nil
			}
		}
		return errNotAllowed
	}
}

var testNow = time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)

// A fetcher whose UniProt is service, with a cache of its own.
func testFetcher(t *testing.T, service *fakeService) (*fetcher, http.Handler) {
	t.Helper()
	upstream := newUpstream(permitOnly(service))
	upstream.retries = []time.Duration{time.Millisecond, time.Millisecond}
	f := &fetcher{mode: "on", cache: &diskCache{dir: t.TempDir(), maxAge: defaultCacheMaxAge}, remote: upstream, origins: map[string]string{"https://rest.uniprot.org": service.URL, "https://api.mavedb.org": service.URL, "https://eutils.ncbi.nlm.nih.gov": service.URL, "https://rest.ensembl.org": service.URL, "https://www.ebi.ac.uk": service.URL, "https://alphafold.ebi.ac.uk": service.URL, "https://gnomad.broadinstitute.org": service.URL}, now: func() time.Time { return testNow }}
	return f, fetcherMux(f)
}

func fetcherMux(f *fetcher) http.Handler {
	mux := http.NewServeMux()
	f.register(mux)
	return mux
}

func get(handler http.Handler, target string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

const entryJSON = `{"primaryAccession":"P62993","sequence":{"value":"MEAIAKYDFK","length":10}}`

func uniprotService(t *testing.T) *fakeService {
	return newFakeService(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-UniProt-Release", "2026_03")
		w.Header().Set("ETag", `"v1"`)
		if r.Header.Get("If-None-Match") == `"v1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Write([]byte(entryJSON))
	})
}

func TestPermitPublicAllowsOnlyTheListedHosts(t *testing.T) {
	allowed := []string{
		"https://rest.uniprot.org/uniprotkb/P62993.json?fields=sequence",
		"https://REST.UniProt.org/uniprotkb/P62993.json",
		"https://rest.uniprot.org./uniprotkb/P62993.json",
		"https://rest.uniprot.org:443/uniprotkb/P62993.json",
		"https://api.mavedb.org/api/v1/score-sets/urn:mavedb:00000835-a-1",
		"https://www.ebi.ac.uk/pdbe/api/pdb/entry/summary/1gri",
		"https://gnomad.broadinstitute.org/api",
		"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar",
	}
	for _, raw := range allowed {
		u, _ := url.Parse(raw)
		if err := permitPublic(u); err != nil {
			t.Errorf("%s refused: %v", raw, err)
		}
	}
	refused := []string{
		"http://rest.uniprot.org/uniprotkb/P62993.json",           // not HTTPS
		"https://rest.uniprot.org:8443/uniprotkb/P62993.json",     // another port
		"https://user@rest.uniprot.org/uniprotkb/P62993.json",     // a user name
		"https://rest.uniprot.org.example.com/uniprotkb/P62993",   // a look-alike
		"https://uniprot.org/uniprotkb/P62993.json",               // not the listed host
		"https://example.com/",                                    // unlisted
		"https://127.0.0.1/",                                      // an address
		"https://www.ebi.ac.uk/Tools/services/rest/ncbiblast/run", // outside /pdbe/
		"https://api.mavedb.org/docs",                             // outside /api/
		"https://gnomad.broadinstitute.org/apix",                  // outside /api
		"https://api.mavedb.org/api/../docs",                      // dot segments
		"https://rest.uniprot.org//uniprotkb",                     // empty parts
	}
	for _, raw := range refused {
		u, _ := url.Parse(raw)
		if err := permitPublic(u); !errors.Is(err, errNotAllowed) {
			t.Errorf("%s allowed", raw)
		}
	}
}

// The real fetcher cannot reach a host that is not listed, whatever asks: the request is refused
// before anything is sent.
func TestTheFetcherSendsNothingToAnUnlistedHost(t *testing.T) {
	service := uniprotService(t)
	_, err := newUpstream(permitPublic).get(context.Background(), service.URL+"/uniprotkb/P62993.json", publicRequests[0], nil, nil)
	if !errors.Is(err, errNotAllowed) {
		t.Fatalf("expected a refusal, got %v", err)
	}
	if service.count() != 0 {
		t.Fatal("the unlisted host was contacted")
	}
}

func TestFetchesOnceAndCachesTheRetrievalRecord(t *testing.T) {
	service := uniprotService(t)
	f, handler := testFetcher(t, service)
	first := get(handler, "/api/fetch/uniprot/p62993", nil)
	if first.Code != http.StatusOK || first.Body.String() != entryJSON || first.Header().Get("X-MaveScape-Cache") != "miss" {
		t.Fatalf("first: %d %s %v", first.Code, first.Body, first.Header())
	}
	if got := service.last().URL.String(); got != "/uniprotkb/P62993.json?fields="+uniprotEntryFields {
		t.Fatalf("asked for %s", got)
	}
	for name, want := range map[string]string{"X-MaveScape-Service": "UniProt", "X-MaveScape-Version": "2026_03", "X-MaveScape-Retrieved": "2026-10-10T12:00:00Z", "X-MaveScape-ETag": `"v1"`, "X-MaveScape-Source": "https://rest.uniprot.org/uniprotkb/P62993.json?fields=" + uniprotEntryFields} {
		if got := first.Header().Get(name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	second := get(handler, "/api/fetch/uniprot/P62993", nil)
	if second.Code != http.StatusOK || second.Header().Get("X-MaveScape-Cache") != "hit" || second.Header().Get("X-MaveScape-Retrieved") != "2026-10-10T12:00:00Z" || service.count() != 1 {
		t.Fatalf("second: %d %v, %d requests", second.Code, second.Header(), service.count())
	}
	var meta cacheMeta
	raw, err := os.ReadFile(filepath.Join(f.cache.dir, "uniprot", "P62993.json.meta.json"))
	if err != nil || json.Unmarshal(raw, &meta) != nil || meta.Retrieved != "2026-10-10T12:00:00Z" || meta.Version != "2026_03" || meta.ETag != `"v1"` || meta.Service != "UniProt" {
		t.Fatalf("record %s (%v)", raw, err)
	}
	listing := get(handler, "/api/fetch/cache", nil)
	if !strings.Contains(listing.Body.String(), `"name":"P62993.json"`) {
		t.Fatalf("cache listing %s", listing.Body)
	}
	refreshed := get(handler, "/api/fetch/uniprot/P62993?refresh=1", nil)
	if refreshed.Header().Get("X-MaveScape-Cache") != "revalidated" || service.count() != 2 || service.last().Header.Get("If-None-Match") != `"v1"` {
		t.Fatalf("refresh: %v, %d requests", refreshed.Header(), service.count())
	}
}

func TestInvalidRequestsAreRefusedBeforeAnythingIsSent(t *testing.T) {
	service := uniprotService(t)
	_, handler := testFetcher(t, service)
	for _, target := range []string{"/api/fetch/uniprot/GRB2", "/api/fetch/uniprot/P62993.json", "/api/fetch/uniparc", "/api/fetch/uniparc?sequence=MEAI-KY", "/api/fetch/uniparc?sequence=ATG*", "/api/fetch/uniparc?sequence=" + strings.Repeat("A", maxLookupResidues+1)} {
		if rec := get(handler, target, map[string]string{confirmHeader: confirmSequence}); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
	if service.count() != 0 {
		t.Fatal("an invalid request reached the service")
	}
}

func TestRedirectsStayOnTheirHost(t *testing.T) {
	elsewhere := uniprotService(t)
	var service *fakeService
	service = newFakeService(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/uniprotkb/P62993.json":
			http.Redirect(w, r, "/uniprotkb/moved.json", http.StatusFound)
		case "/uniprotkb/P62994.json":
			http.Redirect(w, r, elsewhere.URL+"/uniprotkb/P62994.json", http.StatusFound)
		default:
			w.Write([]byte(entryJSON))
		}
	})
	f, handler := testFetcher(t, service)
	if rec := get(handler, "/api/fetch/uniprot/P62993", nil); rec.Code != http.StatusOK {
		t.Fatalf("a redirect on the same host was not followed: %d %s", rec.Code, rec.Body)
	}
	// To another host: refused, even one the fetcher may reach, and never contacted.
	f.remote = newUpstream(permitOnly(service, elsewhere))
	if rec := get(handler, "/api/fetch/uniprot/P62994", nil); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "redirect refused") {
		t.Fatalf("a redirect to another host: %d %s", rec.Code, rec.Body)
	}
	f.remote = newUpstream(permitOnly(service))
	if rec := get(handler, "/api/fetch/uniprot/P62994", nil); rec.Code != http.StatusBadGateway {
		t.Fatalf("a redirect to an unlisted host: %d %s", rec.Code, rec.Body)
	}
	if elsewhere.count() != 0 {
		t.Fatal("the other host was contacted")
	}
}

func gzipped(t *testing.T, data []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	writer.Write(data)
	writer.Close()
	return buffer.Bytes()
}

// Responses larger than a request accepts are refused, however they are sent: declared, streamed,
// compressed by the transport or compressed in the body (a "gzip bomb" of a few kilobytes that
// expands to many megabytes stops at the limit).
func TestResponsesBeyondTheLimitAreRefused(t *testing.T) {
	small := publicRequests[0]
	small.Limit = 1 << 20
	big := bytes.Repeat([]byte(" "), 4<<20)
	bomb := gzipped(t, big)
	if len(bomb) > 64<<10 {
		t.Fatalf("the bomb is %d bytes", len(bomb))
	}
	cases := map[string]http.HandlerFunc{
		"declared": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Length", "2097152")
			w.Write(big[:2<<20])
		},
		"streamed": func(w http.ResponseWriter, r *http.Request) {
			w.(http.Flusher).Flush()
			w.Write(big)
		},
		"content-encoding": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Encoding", "gzip")
			w.Write(bomb)
		},
		"gzip body": func(w http.ResponseWriter, r *http.Request) {
			w.Write(bomb)
		},
		"gzip body, twice": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Encoding", "gzip")
			w.Write(gzipped(t, bomb))
		},
	}
	for name, handler := range cases {
		service := newFakeService(t, handler)
		_, err := newUpstream(permitOnly(service)).get(context.Background(), service.URL+"/x", small, nil, nil)
		if !errors.Is(err, errTooLarge) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// Within the limit, compressed data are read.
	service := newFakeService(t, func(w http.ResponseWriter, r *http.Request) { w.Write(gzipped(t, []byte(entryJSON))) })
	result, err := newUpstream(permitOnly(service)).get(context.Background(), service.URL+"/x", small, nil, nil)
	if err != nil || string(result.body) != entryJSON {
		t.Fatalf("%q %v", result.body, err)
	}
}

func TestOnlyJSONIsAccepted(t *testing.T) {
	service := newFakeService(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>maintenance</html>")) })
	_, handler := testFetcher(t, service)
	if rec := get(handler, "/api/fetch/uniprot/P62993", nil); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "not JSON") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestBriefOutagesAreRetried(t *testing.T) {
	failures := 2
	service := newFakeService(t, func(w http.ResponseWriter, r *http.Request) {
		if failures > 0 {
			failures--
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusGatewayTimeout)
			return
		}
		w.Write([]byte(entryJSON))
	})
	_, handler := testFetcher(t, service)
	if rec := get(handler, "/api/fetch/uniprot/P62993", nil); rec.Code != http.StatusOK || service.count() != 3 {
		t.Fatalf("%d after %d requests", rec.Code, service.count())
	}
	// Not retried: an answer another try would not change.
	gone := newFakeService(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusInternalServerError) })
	_, handler = testFetcher(t, gone)
	if rec := get(handler, "/api/fetch/uniprot/P62993", nil); rec.Code != http.StatusBadGateway || gone.count() != 1 {
		t.Fatalf("%d after %d requests", rec.Code, gone.count())
	}
}

// age makes a cached response older than its kind's maximum age.
func age(t *testing.T, f *fetcher, kind, name string) {
	t.Helper()
	old := time.Now().Add(-2 * defaultCacheMaxAge)
	if err := os.Chtimes(filepath.Join(f.cache.dir, kind, name), old, old); err != nil {
		t.Fatal(err)
	}
}

func TestAnOldCopyIsConfirmedOrServedStale(t *testing.T) {
	answer := http.StatusOK
	service := newFakeService(t, func(w http.ResponseWriter, r *http.Request) {
		if answer == http.StatusNotModified && r.Header.Get("If-None-Match") == `"v1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		if answer != http.StatusOK {
			w.WriteHeader(answer)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		w.Write([]byte(entryJSON))
	})
	f, handler := testFetcher(t, service)
	get(handler, "/api/fetch/uniprot/P62993", nil)
	// Unchanged: confirmed by its ETag, not sent again; its record says when it was checked.
	age(t, f, "uniprot", "P62993.json")
	answer = http.StatusNotModified
	f.now = func() time.Time { return testNow.Add(40 * 24 * time.Hour) }
	rec := get(handler, "/api/fetch/uniprot/P62993", nil)
	if rec.Code != http.StatusOK || rec.Header().Get("X-MaveScape-Cache") != "revalidated" || rec.Body.String() != entryJSON || rec.Header().Get("X-MaveScape-Retrieved") != "2026-10-10T12:00:00Z" || rec.Header().Get("X-MaveScape-Checked") != "2026-11-19T12:00:00Z" {
		t.Fatalf("revalidated: %d %v", rec.Code, rec.Header())
	}
	if rec := get(handler, "/api/fetch/uniprot/P62993", nil); rec.Header().Get("X-MaveScape-Cache") != "hit" {
		t.Fatal("a confirmed copy should be fresh again")
	}
	// The service down: the old copy, marked stale.
	age(t, f, "uniprot", "P62993.json")
	answer = http.StatusServiceUnavailable
	if rec := get(handler, "/api/fetch/uniprot/P62993", nil); rec.Code != http.StatusOK || rec.Header().Get("X-MaveScape-Cache") != "stale" {
		t.Fatalf("stale: %d %v", rec.Code, rec.Header())
	}
	// Gone from the service: said so, not served from the cache.
	answer = http.StatusNotFound
	if rec := get(handler, "/api/fetch/uniprot/P62993", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "UniProt has no entry P62993") {
		t.Fatalf("gone: %d %s", rec.Code, rec.Body)
	}
}

func TestOfflineServesOnlyCachedCopiesAndSendsNothing(t *testing.T) {
	dir := t.TempDir()
	service := uniprotService(t)
	online, handler := testFetcher(t, service)
	online.cache.dir = dir
	get(handler, "/api/fetch/uniprot/P62993", nil)
	contacted := service.count()

	offline := newFetcher(config{offline: true, cacheDir: dir})
	if offline.mode != "offline" || offline.remote != nil {
		t.Fatal("an offline fetcher must have no way to send a request")
	}
	handler = fetcherMux(offline)
	if rec := get(handler, "/api/fetch/uniprot/P62993", nil); rec.Code != http.StatusOK || rec.Header().Get("X-MaveScape-Cache") != "hit" || rec.Body.String() != entryJSON {
		t.Fatalf("cached: %d %v", rec.Code, rec.Header())
	}
	age(t, offline, "uniprot", "P62993.json")
	if rec := get(handler, "/api/fetch/uniprot/P62993?refresh=1", nil); rec.Code != http.StatusOK || rec.Header().Get("X-MaveScape-Cache") != "stale" {
		t.Fatalf("an old copy offline: %d %v", rec.Code, rec.Header())
	}
	if rec := get(handler, "/api/fetch/uniprot/P00740", nil); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "--offline") {
		t.Fatalf("not cached: %d %s", rec.Code, rec.Body)
	}
	if rec := get(handler, "/api/fetch/uniparc?sequence=MEAIAKYDFK", map[string]string{confirmHeader: confirmSequence}); rec.Code != http.StatusForbidden {
		t.Fatalf("a lookup offline: %d %s", rec.Code, rec.Body)
	}
	if service.count() != contacted {
		t.Fatal("offline, the service was contacted")
	}
}

func TestNoFetchSwitchesPublicDataOff(t *testing.T) {
	f := newFetcher(config{noFetch: true, cacheDir: t.TempDir()})
	if f.mode != "off" || f.remote != nil || f.cache != nil {
		t.Fatalf("%+v", f)
	}
	handler := fetcherMux(f)
	for _, target := range []string{"/api/fetch/uniprot/P62993", "/api/fetch/uniparc?sequence=MEAI", "/api/fetch/cache"} {
		if rec := get(handler, target, nil); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "--no-fetch") {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
	var status struct {
		Mode string `json:"mode"`
	}
	if rec := get(handler, "/api/fetch", nil); json.Unmarshal(rec.Body.Bytes(), &status) != nil || status.Mode != "off" {
		t.Fatalf("status %s", rec.Body)
	}
}

// A request that sends a sequence is made only with the page's confirmation; without it, the host
// says exactly what it would send, and sends nothing. A lookup already made is answered from the
// cache, sending nothing, and is listed without its sequence.
func TestASequenceIsSentOnlyOnceConfirmed(t *testing.T) {
	sequence := "MEAIAKYDFKATADDELSFKRGDILKV"
	service := newFakeService(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/uniparc/sequence" || r.URL.Query().Get("sequence") != sequence {
			t.Errorf("asked %s", r.URL)
		}
		w.Write([]byte(`{"uniParcId":"UPI000004EF93","uniParcCrossReferences":[]}`))
	})
	f, handler := testFetcher(t, service)
	rec := get(handler, "/api/fetch/uniparc?sequence="+strings.ToLower(sequence), nil)
	var refusal struct {
		Error   string            `json:"error"`
		Confirm map[string]string `json:"confirm"`
	}
	if rec.Code != http.StatusPreconditionRequired || json.Unmarshal(rec.Body.Bytes(), &refusal) != nil {
		t.Fatalf("unconfirmed: %d %s", rec.Code, rec.Body)
	}
	if refusal.Confirm["host"] != "rest.uniprot.org" || refusal.Confirm["url"] != "https://rest.uniprot.org/uniparc/sequence?sequence="+sequence+uniparcQuery || refusal.Confirm["sends"] == "" {
		t.Fatalf("what would be sent: %+v", refusal.Confirm)
	}
	if service.count() != 0 {
		t.Fatal("the sequence was sent without confirmation")
	}
	if rec := get(handler, "/api/fetch/uniparc?sequence="+sequence, map[string]string{confirmHeader: confirmSequence}); rec.Code != http.StatusOK || service.count() != 1 {
		t.Fatalf("confirmed: %d %s", rec.Code, rec.Body)
	}
	if rec := get(handler, "/api/fetch/uniparc?sequence="+sequence, nil); rec.Code != http.StatusOK || rec.Header().Get("X-MaveScape-Cache") != "hit" || service.count() != 1 {
		t.Fatalf("again: %d %v", rec.Code, rec.Header())
	}
	if listing := get(handler, "/api/fetch/cache", nil).Body.String(); strings.Contains(listing, sequence) || !strings.Contains(listing, "the sequence's lookup") {
		t.Fatalf("the cache listing shows the sequence: %s", listing)
	}
	// Nothing in the cache holds the sequence: its record names the request without it.
	err := filepath.WalkDir(f.cache.dir, func(file string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		raw, err := os.ReadFile(file)
		if err == nil && strings.Contains(string(raw), sequence) {
			t.Errorf("%s holds the sequence", file)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Every request MaveScape can make, and every host it may contact, is in docs/NETWORK.md; each
// request's upstream is on the list.
func TestNetworkDocumentListsEveryRequest(t *testing.T) {
	raw, err := os.ReadFile("docs/NETWORK.md")
	if err != nil {
		t.Fatal(err)
	}
	doc := string(raw)
	for _, host := range publicHosts {
		if !strings.Contains(doc, "`"+host.Host+"`") {
			t.Errorf("docs/NETWORK.md does not list the host %s", host.Host)
		}
	}
	placeholder := regexp.MustCompile(`\{[a-z]+\}`)
	for _, request := range publicRequests {
		route := strings.TrimPrefix(request.Route, "GET ")
		if !strings.Contains(doc, "`"+route+"`") {
			t.Errorf("docs/NETWORK.md does not list %s", route)
		}
		if !strings.Contains(doc, "`"+request.Upstream+"`") {
			t.Errorf("docs/NETWORK.md does not give the upstream of %s: %s", route, request.Upstream)
		}
		u, err := url.Parse(placeholder.ReplaceAllString(request.Upstream, "X"))
		if err != nil || permitPublic(u) != nil {
			t.Errorf("%s asks %s, not on the list", route, request.Upstream)
		}
		if request.Sends == "" || request.Why == "" || request.notFound == nil || request.Limit <= 0 || request.Kind == "" {
			t.Errorf("%s is not fully described", route)
		}
	}
}

// The page makes no request but to its own origin: no script in web/ names another in a request
// (the Content-Security-Policy's connect-src 'self' enforces it in the browser;
// validation/remote-session.mjs records every request of a whole session).
func TestThePageAsksOnlyItsOwnOrigin(t *testing.T) {
	request := regexp.MustCompile(`(?:fetch|EventSource|WebSocket|Worker|SharedWorker|importScripts|sendBeacon|import)\(\s*['"` + "`" + `](?:[a-z][a-z0-9+.-]*:|//)`)
	xhr := regexp.MustCompile(`XMLHttpRequest`)
	err := filepath.WalkDir("web", func(file string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !(strings.HasSuffix(file, ".js") || strings.HasSuffix(file, ".html")) || strings.HasSuffix(file, ".test.mjs") {
			return err
		}
		raw, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		if match := request.Find(raw); match != nil {
			t.Errorf("%s asks another origin: %s", file, match)
		}
		if xhr.Match(raw) {
			t.Errorf("%s uses XMLHttpRequest", file)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(contentSecurityPolicy, "connect-src 'self';") || !strings.Contains(contentSecurityPolicy, "default-src 'self';") {
		t.Fatal("the page's connections must be limited to its origin")
	}
}

// MaveDB (wave 3, slice 2): a score set's record (JSON) and its tables (CSV), by a published
// score set's URN only, cached under names without colons.
func TestMaveDBScoreSetsAndTheirTables(t *testing.T) {
	const scores = "accession,hgvs_nt,hgvs_splice,hgvs_pro,score\r\nurn:mavedb:00000835-a-1#1,NA,NA,p.=,0.0\r\n"
	service := newFakeService(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/score-sets/urn:mavedb:00000835-a-1":
			w.Write([]byte(`{"urn":"urn:mavedb:00000835-a-1"}`))
		case "/api/v1/score-sets/urn:mavedb:00000835-a-1/scores":
			if r.Header.Get("Accept") != "text/csv" {
				t.Errorf("Accept %q", r.Header.Get("Accept"))
			}
			w.Header().Set("Content-Type", "text/csv; charset=utf-8")
			w.Write([]byte(scores))
		case "/api/v1/score-sets/urn:mavedb:00000835-a-1/counts":
			w.Write([]byte("<html>Bad gateway</html>"))
		default:
			http.NotFound(w, r)
		}
	})
	f, handler := testFetcher(t, service)
	if rec := get(handler, "/api/fetch/mavedb/score-sets/URN:MAVEDB:00000835-a-1", nil); rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != jsonContentType {
		t.Fatalf("record: %d %v", rec.Code, rec.Header())
	}
	rec := get(handler, "/api/fetch/mavedb/score-sets/urn:mavedb:00000835-a-1/scores", nil)
	if rec.Code != http.StatusOK || rec.Body.String() != scores || rec.Header().Get("Content-Type") != csvContentType || rec.Header().Get("X-MaveScape-Source") != "https://api.mavedb.org/api/v1/score-sets/urn:mavedb:00000835-a-1/scores" {
		t.Fatalf("scores: %d %q %v", rec.Code, rec.Body, rec.Header())
	}
	for _, name := range []string{"urn_mavedb_00000835-a-1.json", "urn_mavedb_00000835-a-1.scores.csv"} {
		if _, err := os.Stat(filepath.Join(f.cache.dir, "mavedb", name)); err != nil {
			t.Errorf("not cached as %s: %v", name, err)
		}
	}
	if rec := get(handler, "/api/fetch/mavedb/score-sets/urn:mavedb:00000835-a-1/counts", nil); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "not a CSV table") {
		t.Fatalf("a page instead of a table: %d %s", rec.Code, rec.Body)
	}
	if rec := get(handler, "/api/fetch/mavedb/score-sets/urn:mavedb:00009999-a-1", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "no published score set urn:mavedb:00009999-a-1") {
		t.Fatalf("unknown: %d %s", rec.Code, rec.Body)
	}
	before := service.count()
	for _, urn := range []string{"tmp:6d1c4e0e-5e1b-4d0b-9f3e-1e3c3c1b1b1b", "urn:mavedb:00000835", "urn:mavedb:00000835-a", "00000835-a-1", "urn:mavedb:00000835-a-1%2F..%2Fx"} {
		if rec := get(handler, "/api/fetch/mavedb/score-sets/"+urn, nil); rec.Code != http.StatusBadRequest && rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d", urn, rec.Code)
		}
	}
	if service.count() != before {
		t.Fatal("an invalid URN reached the service")
	}
}

// Targets named by an accession (wave 3, slice 3): a nucleotide record from NCBI as GenBank, an
// Ensembl transcript by its identifier without the version (Ensembl serves its current release),
// and MaveDB's mapped variants; NCBI's and Ensembl's HTTP 400 for an unknown accession is "not
// found", and an answer of the wrong kind is refused.
func TestAccessionTargetsAndMappedVariants(t *testing.T) {
	const record = "LOCUS       NM_007294               7088 bp    mRNA    linear   PRI 10-SEP-2026\nORIGIN\n        1 gcttagcggt\n//\n"
	var asked []string
	service := newFakeService(t, func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.Path+"?"+r.URL.RawQuery)
		switch {
		case r.URL.Path == "/entrez/eutils/efetch.fcgi" && r.URL.Query().Get("id") == "NM_007294.3":
			if r.Header.Get("Accept") != "text/plain" || r.URL.Query().Get("rettype") != "gb" || r.URL.Query().Get("db") != "nuccore" {
				t.Errorf("Accept %q, query %s", r.Header.Get("Accept"), r.URL.RawQuery)
			}
			w.Write([]byte(record))
		case r.URL.Path == "/entrez/eutils/efetch.fcgi" && r.URL.Query().Get("id") == "L09137":
			w.Write([]byte("<html>Error</html>"))
		case r.URL.Path == "/entrez/eutils/efetch.fcgi":
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte("Error: Failed to retrieve sequence"))
		case r.URL.Path == "/sequence/id/ENST00000460680":
			if r.URL.Query().Get("type") != "cdna" || r.URL.Query().Get("mask_feature") != "1" {
				t.Errorf("query %s", r.URL.RawQuery)
			}
			w.Write([]byte(`{"id":"ENST00000460680","version":6,"molecule":"dna","seq":"gggATGTAAccc"}`))
		case strings.HasPrefix(r.URL.Path, "/sequence/id/"):
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"ID not found"}`))
		case r.URL.Path == "/api/v1/score-sets/urn:mavedb:00000835-a-1/mapped-variants":
			w.Write([]byte(`[{"variantUrn":"urn:mavedb:00000835-a-1#1","current":true}]`))
		default:
			http.NotFound(w, r)
		}
	})
	f, handler := testFetcher(t, service)
	rec := get(handler, "/api/fetch/ncbi/nuccore/nm_007294.3", nil)
	if rec.Code != http.StatusOK || rec.Body.String() != record || rec.Header().Get("Content-Type") != genbankContentType {
		t.Fatalf("GenBank: %d %v %q", rec.Code, rec.Header(), rec.Body)
	}
	if rec := get(handler, "/api/fetch/ncbi/nuccore/NM_999999999.1", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "NCBI has no nucleotide record NM_999999999.1") {
		t.Fatalf("unknown accession: %d %s", rec.Code, rec.Body)
	}
	if rec := get(handler, "/api/fetch/ncbi/nuccore/L09137", nil); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "not a GenBank record") {
		t.Fatalf("a page instead of a record: %d %s", rec.Code, rec.Body)
	}
	rec = get(handler, "/api/fetch/ensembl/transcript/ENST00000460680.5", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"version":6`) || rec.Header().Get("X-MaveScape-Source") != "https://rest.ensembl.org/sequence/id/ENST00000460680?type=cdna&mask_feature=1" {
		t.Fatalf("Ensembl: %d %v %s", rec.Code, rec.Header(), rec.Body)
	}
	if rec := get(handler, "/api/fetch/ensembl/transcript/ENST00000999999", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "Ensembl has no transcript ENST00000999999") {
		t.Fatalf("unknown transcript: %d %s", rec.Code, rec.Body)
	}
	if rec := get(handler, "/api/fetch/mavedb/score-sets/urn:mavedb:00000835-a-1/mapped-variants", nil); rec.Code != http.StatusOK {
		t.Fatalf("mapped variants: %d %s", rec.Code, rec.Body)
	}
	for _, name := range []string{"ncbi/NM_007294.3.gb", "ensembl/ENST00000460680.json", "mavedb/urn_mavedb_00000835-a-1.mapped.json"} {
		if _, err := os.Stat(filepath.Join(f.cache.dir, filepath.FromSlash(name))); err != nil {
			t.Errorf("not cached as %s: %v", name, err)
		}
	}
	if rec := get(handler, "/api/fetch/ncbi/nuccore/NM_007294.3", nil); rec.Header().Get("X-MaveScape-Cache") != "hit" {
		t.Fatalf("the record again: %v", rec.Header())
	}
	before := len(asked)
	for _, path := range []string{"/api/fetch/ncbi/nuccore/Q9Y6K9", "/api/fetch/ncbi/nuccore/NM_007294.3%3Bx", "/api/fetch/ncbi/nuccore/chr17", "/api/fetch/ensembl/transcript/ENSG00000163930", "/api/fetch/ensembl/transcript/ENSP00000269305"} {
		if rec := get(handler, path, nil); rec.Code != http.StatusBadRequest && rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d", path, rec.Code)
		}
	}
	if len(asked) != before {
		t.Fatalf("an invalid accession reached the service: %v", asked[before:])
	}
}

// MaveDB's search is a POST of the words searched for, 100 results a page, cached for a day by
// the words (whatever their case) and the page.
func TestMaveDBSearchPostsTheWords(t *testing.T) {
	var bodies []string
	service := newFakeService(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/score-sets/search" || r.Header.Get("Content-Type") != jsonContentType {
			t.Errorf("%s %s %q", r.Method, r.URL.Path, r.Header.Get("Content-Type"))
		}
		raw, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(raw))
		w.Write([]byte(`{"scoreSets":[],"numScoreSets":0}`))
	})
	f, handler := testFetcher(t, service)
	if rec := get(handler, "/api/fetch/mavedb/search?text=GRB2%20%20SH3&page=2", nil); rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if len(bodies) != 1 || bodies[0] != `{"text":"GRB2 SH3","published":true,"limit":100,"offset":100}` {
		t.Fatalf("posted %q", bodies)
	}
	if rec := get(handler, "/api/fetch/mavedb/search?text=grb2+sh3&page=2", nil); rec.Header().Get("X-MaveScape-Cache") != "hit" || len(bodies) != 1 {
		t.Fatalf("the same search again: %v, %d posts", rec.Header(), len(bodies))
	}
	var meta cacheMeta
	entries := f.cache.list()
	if len(entries) != 1 || entries[0].Kind != "mavedb-search" {
		t.Fatalf("cache %+v", entries)
	}
	meta = entries[0].Meta
	if meta.Method != http.MethodPost || meta.Request != bodies[0] {
		t.Fatalf("record %+v", meta)
	}
	for _, query := range []string{"", "?text=", "?text=GRB2&page=0", "?text=GRB2&page=x", "?text=" + strings.Repeat("a", maxSearchText+1), "?text=a%00b"} {
		if rec := get(handler, "/api/fetch/mavedb/search"+query, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("%q: %d", query, rec.Code)
		}
	}
	if len(bodies) != 1 {
		t.Fatal("an invalid search reached the service")
	}
}

// A MaveDB deposit stays on this computer (wave 3, slice 4): MaveScape writes it from what the
// workspace holds and checks it itself, and none of the requests it can make sends variants to
// MaveDB's validators (/hgvs/validate and the like) or writes to MaveDB: of MaveDB's requests only
// the search is POSTed; MaveDB's annotations of a published score set's variants (wave 3, slice
// 5) are read with a GET. The only other POSTs are gnomAD's GraphQL queries, which read.
func TestNoRequestSendsADepositToMaveDB(t *testing.T) {
	for _, request := range publicRequests {
		upstream := strings.ToLower(request.Upstream)
		if request.Service == "MaveDB" && (strings.Contains(upstream, "/hgvs/") || strings.Contains(upstream, "validate") || strings.HasSuffix(strings.TrimSuffix(upstream, "/"), "/score-sets") || strings.HasSuffix(strings.TrimSuffix(upstream, "/"), "/experiments")) {
			t.Errorf("%s asks MaveDB %s", request.Route, request.Upstream)
		}
		if request.Method != "" && request.Method != "GET" && !(request.Service == "MaveDB" && strings.HasSuffix(upstream, "/score-sets/search")) && request.Upstream != gnomadAPI {
			t.Errorf("%s sends a %s to %s", request.Route, request.Method, request.Upstream)
		}
	}
}
