package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func testApp(t *testing.T, files ...string) (*app, http.Handler) {
	t.Helper()
	dir := t.TempDir()
	a, err := newApp(config{dataDir: dir, files: files})
	if err != nil {
		t.Fatal(err)
	}
	handler, err := a.handler()
	if err != nil {
		t.Fatal(err)
	}
	return a, protect(handler, "127.0.0.1", defaultPort)
}

func request(t *testing.T, handler http.Handler, method, target string, body io.Reader, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, body)
	req.Host = "127.0.0.1:8820"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestServesTheAppWithSecurityHeaders(t *testing.T) {
	_, handler := testApp(t)
	rec := request(t, handler, http.MethodGet, "/", nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "MaveScape") {
		t.Fatal("index.html not served")
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'self'") || !strings.Contains(csp, "connect-src 'self'") {
		t.Fatalf("missing CSP: %q", csp)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
	if rec.Header().Get("Cross-Origin-Embedder-Policy") != "require-corp" || rec.Header().Get("Cross-Origin-Opener-Policy") != "same-origin" {
		t.Fatal("the page is not cross-origin isolated (shared memory for workers)")
	}
	js := request(t, handler, http.MethodGet, "/app.js", nil, nil)
	if !strings.HasPrefix(js.Header().Get("Content-Type"), "text/javascript") {
		t.Fatalf("app.js content type %q", js.Header().Get("Content-Type"))
	}
	lib := request(t, handler, http.MethodGet, "/lib/random.js", nil, nil)
	if lib.Code != http.StatusOK {
		t.Fatalf("lib/random.js status %d", lib.Code)
	}
}

// Everything the page loads must be embedded: a module missing from the go:embed list works with
// --dev and fails in the released program.
func TestEveryWebModuleIsEmbedded(t *testing.T) {
	err := filepath.WalkDir("web", func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		name := filepath.ToSlash(path)
		if strings.HasSuffix(name, ".test.mjs") || strings.HasSuffix(name, "package.json") {
			if _, err := fs.Stat(content, name); err == nil {
				t.Errorf("%s is embedded but is not part of the app", name)
			}
			return nil
		}
		if _, err := fs.Stat(content, name); err != nil {
			t.Errorf("%s is not embedded (add it to the go:embed list in main.go)", name)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestInfoDescribesTheDesktopProgram(t *testing.T) {
	_, handler := testApp(t)
	rec := request(t, handler, http.MethodGet, "/api/info", nil, nil)
	var body info
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Name != "MaveScape" || body.Version != version || !body.Library || body.Session == "" || body.Mode != "desktop" {
		t.Fatalf("unexpected info %+v", body)
	}
}

func TestTheBuildCommitComesFromTheLinkerFirst(t *testing.T) {
	saved := commit
	defer func() { commit = saved }()
	commit = "0123456789abcdef"
	if got := buildCommit(); got != "0123456789abcdef" {
		t.Fatalf("buildCommit() = %q", got)
	}
	_, handler := testApp(t)
	var body info
	json.NewDecoder(request(t, handler, http.MethodGet, "/api/info", nil, nil).Body).Decode(&body)
	if body.Commit != "0123456789abcdef" {
		t.Fatalf("info commit %q", body.Commit)
	}
}

func TestRejectsForeignHostsAndCrossOriginAPI(t *testing.T) {
	_, handler := testApp(t)
	req := httptest.NewRequest(http.MethodGet, "/api/info", nil)
	req.Host = "evil.example:8820"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("DNS-rebinding host allowed: %d", rec.Code)
	}
	cross := request(t, handler, http.MethodPut, "/api/library/workspaces/abc", strings.NewReader("{}"), map[string]string{"Origin": "https://evil.example"})
	if cross.Code != http.StatusForbidden {
		t.Fatalf("cross-origin write allowed: %d", cross.Code)
	}
	site := request(t, handler, http.MethodGet, "/api/info", nil, map[string]string{"Sec-Fetch-Site": "cross-site"})
	if site.Code != http.StatusForbidden {
		t.Fatalf("cross-site fetch allowed: %d", site.Code)
	}
	otherPort := request(t, handler, http.MethodGet, "/api/info", nil, map[string]string{"Origin": "http://127.0.0.1:8765"})
	if otherPort.Code != http.StatusForbidden {
		t.Fatalf("another local program's page (another port) allowed: %d", otherPort.Code)
	}
	same := request(t, handler, http.MethodGet, "/api/info", nil, map[string]string{"Origin": "http://127.0.0.1:8820", "Sec-Fetch-Site": "same-origin"})
	if same.Code != http.StatusOK {
		t.Fatalf("same-origin request refused: %d", same.Code)
	}
}

func TestWorkspaceLibraryRoundTrip(t *testing.T) {
	_, handler := testApp(t)
	doc := `{"format":"mavescape-workspace","version":1,"name":"GRB2 SH3","modified":"2026-10-08T12:00:00Z","sources":[{},{}]}`
	put := request(t, handler, http.MethodPut, "/api/library/workspaces/w1", strings.NewReader(doc), nil)
	if put.Code != http.StatusOK {
		t.Fatalf("put %d %s", put.Code, put.Body)
	}
	list := request(t, handler, http.MethodGet, "/api/library/workspaces", nil, nil)
	var listed struct {
		Workspaces []workspaceSummary `json:"workspaces"`
	}
	json.NewDecoder(list.Body).Decode(&listed)
	if len(listed.Workspaces) != 1 || listed.Workspaces[0].Name != "GRB2 SH3" || listed.Workspaces[0].Sources != 2 {
		t.Fatalf("unexpected list %+v", listed)
	}
	get := request(t, handler, http.MethodGet, "/api/library/workspaces/w1", nil, nil)
	if get.Body.String() != doc {
		t.Fatalf("round trip changed the document: %s", get.Body)
	}
	if bad := request(t, handler, http.MethodPut, "/api/library/workspaces/w2", strings.NewReader("{not json"), nil); bad.Code != http.StatusBadRequest {
		t.Fatalf("invalid JSON accepted: %d", bad.Code)
	}
	if traversal := request(t, handler, http.MethodGet, "/api/library/workspaces/..%2Fsecret", nil, nil); traversal.Code == http.StatusOK {
		t.Fatal("path traversal allowed")
	}
	del := request(t, handler, http.MethodDelete, "/api/library/workspaces/w1", nil, nil)
	if del.Code != http.StatusOK {
		t.Fatalf("delete %d", del.Code)
	}
	if gone := request(t, handler, http.MethodGet, "/api/library/workspaces/w1", nil, nil); gone.Code != http.StatusNotFound {
		t.Fatalf("deleted workspace still served: %d", gone.Code)
	}
}

func TestRecordsRoundTripByKind(t *testing.T) {
	_, handler := testApp(t)
	if empty := request(t, handler, http.MethodGet, "/api/library/records/import-template", nil, nil); !strings.Contains(empty.Body.String(), `"records":[]`) {
		t.Fatalf("empty list: %s", empty.Body)
	}
	doc := `{"name":"Domainome two-population","modified":"2026-10-08T08:00:00Z","columns":[]}`
	if put := request(t, handler, http.MethodPut, "/api/library/records/import-template/t1", strings.NewReader(doc), nil); put.Code != http.StatusOK {
		t.Fatalf("put %d %s", put.Code, put.Body)
	}
	list := request(t, handler, http.MethodGet, "/api/library/records/import-template", nil, nil)
	var listed struct {
		Records []recordSummary `json:"records"`
	}
	json.NewDecoder(list.Body).Decode(&listed)
	if len(listed.Records) != 1 || listed.Records[0].ID != "t1" || listed.Records[0].Name != "Domainome two-population" {
		t.Fatalf("unexpected list %+v", listed)
	}
	if get := request(t, handler, http.MethodGet, "/api/library/records/import-template/t1", nil, nil); get.Body.String() != doc {
		t.Fatalf("round trip changed the record: %s", get.Body)
	}
	if other := request(t, handler, http.MethodGet, "/api/library/records/design/t1", nil, nil); other.Code != http.StatusNotFound {
		t.Fatalf("records leak across kinds: %d", other.Code)
	}
	if bad := request(t, handler, http.MethodPut, "/api/library/records/Bad_Kind/t1", strings.NewReader("{}"), nil); bad.Code != http.StatusBadRequest {
		t.Fatalf("invalid kind accepted: %d", bad.Code)
	}
	if bad := request(t, handler, http.MethodPut, "/api/library/records/design/x", strings.NewReader("{oops"), nil); bad.Code != http.StatusBadRequest {
		t.Fatalf("invalid JSON accepted: %d", bad.Code)
	}
	if del := request(t, handler, http.MethodDelete, "/api/library/records/import-template/t1", nil, nil); del.Code != http.StatusOK {
		t.Fatalf("delete %d", del.Code)
	}
	if gone := request(t, handler, http.MethodGet, "/api/library/records/import-template/t1", nil, nil); gone.Code != http.StatusNotFound {
		t.Fatalf("deleted record still served: %d", gone.Code)
	}
}

func TestFilesAreStoredUnderTheirHash(t *testing.T) {
	a, handler := testApp(t)
	content := []byte("hgvs_pro,input_rep1,output_rep1\np.Ala2Val,120,35\n")
	sum := sha256.Sum256(content)
	sha := hex.EncodeToString(sum[:])
	wrong := strings.Repeat("0", 64)
	if rec := request(t, handler, http.MethodPut, "/api/library/files/"+wrong, bytes.NewReader(content), nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched hash accepted: %d", rec.Code)
	}
	if rec := request(t, handler, http.MethodPut, "/api/library/files/"+sha, bytes.NewReader(content), nil); rec.Code != http.StatusOK {
		t.Fatalf("put %d %s", rec.Code, rec.Body)
	}
	has := request(t, handler, http.MethodGet, "/api/library/has/"+sha, nil, nil)
	if !strings.Contains(has.Body.String(), `"exists":true`) {
		t.Fatalf("has: %s", has.Body)
	}
	missing := request(t, handler, http.MethodGet, "/api/library/has/"+wrong, nil, nil)
	if !strings.Contains(missing.Body.String(), `"exists":false`) {
		t.Fatalf("has missing: %s", missing.Body)
	}
	get := request(t, handler, http.MethodGet, "/api/library/files/"+sha, nil, nil)
	if !bytes.Equal(get.Body.Bytes(), content) {
		t.Fatal("stored file differs")
	}
	if _, err := os.Stat(filepath.Join(a.store.dir, "files", sha[:2], sha)); err != nil {
		t.Fatalf("file not at its content address: %v", err)
	}
}

func TestFilesAreAddedUnderTheHashTheProgramComputes(t *testing.T) {
	dir := t.TempDir()
	local := filepath.Join(dir, "counts.csv")
	content := []byte("hgvs_pro,input,output\np.Gly3Asp,40,2\n")
	os.WriteFile(local, content, 0o644)
	a, handler := testApp(t, local)
	sum := sha256.Sum256(content)
	sha := hex.EncodeToString(sum[:])
	same := map[string]string{"Sec-Fetch-Site": "same-origin"}
	var body struct {
		SHA256   string `json:"sha256"`
		Size     int64  `json:"size"`
		Existing bool   `json:"existing"`
	}
	rec := request(t, handler, http.MethodPost, "/api/library/local/0", nil, same)
	if rec.Code != http.StatusOK {
		t.Fatalf("local copy %d %s", rec.Code, rec.Body)
	}
	json.NewDecoder(rec.Body).Decode(&body)
	if body.SHA256 != sha || body.Size != int64(len(content)) || body.Existing {
		t.Fatalf("local copy answered %+v", body)
	}
	if _, err := os.Stat(filepath.Join(a.store.dir, "files", sha[:2], sha)); err != nil {
		t.Fatalf("local file not at its content address: %v", err)
	}
	rec = request(t, handler, http.MethodPost, "/api/library/files", bytes.NewReader(content), same)
	json.NewDecoder(rec.Body).Decode(&body)
	if rec.Code != http.StatusOK || body.SHA256 != sha || !body.Existing {
		t.Fatalf("upload of a stored file: %d %+v", rec.Code, body)
	}
	other := []byte(">target\nMSKGEELFTG\n")
	rec = request(t, handler, http.MethodPost, "/api/library/files", bytes.NewReader(other), same)
	json.NewDecoder(rec.Body).Decode(&body)
	otherSum := sha256.Sum256(other)
	if rec.Code != http.StatusOK || body.SHA256 != hex.EncodeToString(otherSum[:]) || body.Existing {
		t.Fatalf("upload: %d %+v", rec.Code, body)
	}
	// Range requests read part of a stored file (the browser streams large tables this way).
	part := request(t, handler, http.MethodGet, "/api/library/files/"+sha, nil, map[string]string{"Range": "bytes=10-14"})
	if part.Code != http.StatusPartialContent || part.Body.String() != string(content[10:15]) {
		t.Fatalf("range: %d %q", part.Code, part.Body.String())
	}
	if rec := request(t, handler, http.MethodPost, "/api/library/local/7", nil, same); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown local file: %d", rec.Code)
	}
	if rec := request(t, handler, http.MethodPost, "/api/library/files", bytes.NewReader(content), map[string]string{"Origin": "https://example.com"}); rec.Code == http.StatusOK {
		t.Fatal("cross-origin upload accepted")
	}
	entries, _ := os.ReadDir(filepath.Join(a.store.dir, "files"))
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".upload-") {
			t.Fatalf("temporary file left behind: %s", entry.Name())
		}
	}
}

func TestLocalFilesFromFoldersAreServed(t *testing.T) {
	dir := t.TempDir()
	experiment := filepath.Join(dir, "grb2")
	os.MkdirAll(filepath.Join(experiment, ".hidden"), 0o755)
	for _, name := range []string{"rep10.tsv", "rep2.tsv", "rep1.tsv", "target.fasta", "2vwf.cif", "notes.docx", ".hidden/x.csv"} {
		os.WriteFile(filepath.Join(experiment, name), []byte("data "+name), 0o644)
	}
	_, handler := testApp(t, experiment)
	rec := request(t, handler, http.MethodGet, "/api/info", nil, nil)
	var body info
	json.NewDecoder(rec.Body).Decode(&body)
	var names []string
	for _, f := range body.Files {
		names = append(names, f.Name+":"+f.Kind)
		if f.Folder != "grb2" {
			t.Fatalf("unexpected file %+v", f)
		}
	}
	if strings.Join(names, ",") != "2vwf.cif:structure,rep1.tsv:table,rep2.tsv:table,rep10.tsv:table,target.fasta:sequence" {
		t.Fatalf("files not in natural order, or hidden or unknown files included: %v", names)
	}
	served := request(t, handler, http.MethodGet, body.Files[3].URL, nil, nil)
	if served.Body.String() != "data rep10.tsv" {
		t.Fatalf("served %q", served.Body.String())
	}
	if rec := request(t, handler, http.MethodGet, "/api/local/99", nil, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown local file: %d", rec.Code)
	}
}

func TestOpenRequiresThisComputer(t *testing.T) {
	_, handler := testApp(t)
	req := httptest.NewRequest(http.MethodPost, "/api/open", strings.NewReader(`{"paths":["/tmp"]}`))
	req.Host = "127.0.0.1:8820"
	req.RemoteAddr = "10.0.0.5:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("remote peer allowed to open files: %d", rec.Code)
	}
}

func TestUnknownAPIAndStaticPaths(t *testing.T) {
	_, handler := testApp(t)
	if rec := request(t, handler, http.MethodGet, "/api/nothing", nil, nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "Unknown API endpoint") {
		t.Fatalf("unknown API: %d %s", rec.Code, rec.Body)
	}
	// A path without an extension is a view of the app (index.html); a missing file is not.
	if rec := request(t, handler, http.MethodGet, "/map", nil, nil); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "MaveScape") {
		t.Fatalf("app path: %d", rec.Code)
	}
	if rec := request(t, handler, http.MethodGet, "/lib/missing.js", nil, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("missing file: %d", rec.Code)
	}
}

func TestNaturalOrder(t *testing.T) {
	names := []string{"rep10", "rep2", "Rep1", "tile B3", "tile A11", "tile A3"}
	sort.Slice(names, func(i, j int) bool { return naturalLess(names[i], names[j]) })
	want := "Rep1,rep2,rep10,tile A3,tile A11,tile B3"
	if got := strings.Join(names, ","); got != want {
		t.Fatalf("got %s", got)
	}
}

func TestParseConfig(t *testing.T) {
	cfg, err := parseConfig([]string{"experiment/", "--port", "9000", "--window", "none", "counts.csv"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.port != 9000 || cfg.window != "none" || len(cfg.files) != 2 || cfg.dataDir == "" {
		t.Fatalf("unexpected config %+v", cfg)
	}
	defaults, _ := parseConfig(nil)
	if defaults.port != 8820 || defaults.host != "127.0.0.1" || defaults.window != "app" {
		t.Fatalf("unexpected defaults %+v", defaults)
	}
	if _, err := parseConfig([]string{"--window", "fullscreen"}); err == nil {
		t.Fatal("invalid --window accepted")
	}
	noOpen, _ := parseConfig([]string{"--no-open"})
	if noOpen.window != "none" {
		t.Fatal("--no-open should mean --window none")
	}
}

func TestFileKinds(t *testing.T) {
	cases := map[string]string{
		"counts.CSV": "table", "scores.tsv": "table", "sheet.xlsx": "table", "big.tsv.gz": "table",
		"exp.msz": "workspace", "grb2.design.json": "design", "domainome.import.json": "template",
		"target.fasta": "sequence", "p.fa": "sequence", "construct.gb": "genbank", "x.gbk": "genbank",
		"msa.a3m": "alignment", "features.gff3": "annotation",
		"2vwf.cif": "structure", "1jm7.pdb": "structure", "AF-P62993.bcif": "structure",
		"package.zip": "archive", "other.json": "", "notes.docx": "", "reads.fastq": "",
	}
	for name, want := range cases {
		if got := fileKind(name); got != want {
			t.Errorf("%s: %q, want %q", name, got, want)
		}
	}
}
