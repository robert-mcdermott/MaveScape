package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// A fake Proteoscope: its startup answer, as Proteoscope 0.10.0's local.go writes it.
func fakeProteoscope(t *testing.T, version string, remote bool) (*httptest.Server, int) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/startup" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(map[string]any{"version": version, "offline": false, "remoteControl": remote, "files": nil})
	}))
	t.Cleanup(server.Close)
	return server, portOf(t, server.URL)
}

func portOf(t *testing.T, url string) int {
	t.Helper()
	_, port, err := net.SplitHostPort(strings.TrimPrefix(url, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	n, _ := strconv.Atoi(port)
	return n
}

// A port nothing listens on: one the system gave, then closed.
func closedPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	return port
}

func finderOn(ports ...int) *proteoscopeFinder {
	f, _ := newProteoscopeFinder("")
	f.ports = ports
	f.timeout = 300 * time.Millisecond
	return f
}

// Found where it runs, by its startup answer: the version tested, one not tested, and without
// remote control (which the handoff does not need); the first Proteoscope in the order looked.
func TestProteoscopeIsFoundByItsStartupAnswer(t *testing.T) {
	_, tested := fakeProteoscope(t, "0.10.0", false)
	_, newer := fakeProteoscope(t, "0.11.2", true)
	empty := closedPort(t)

	got := finderOn(empty, tested, newer).find(context.Background())
	if !got.Found || got.Version != "0.10.0" || !got.Tested || got.RemoteControl || got.URL != "http://127.0.0.1:"+strconv.Itoa(tested)+"/" {
		t.Fatalf("a tested Proteoscope without remote control: %+v", got)
	}
	got = finderOn(empty, newer, tested).find(context.Background())
	if !got.Found || got.Version != "0.11.2" || got.Tested || !got.RemoteControl {
		t.Fatalf("a version not tested, first in the order: %+v", got)
	}
	for version, want := range map[string]bool{"0.10.3": true, "v0.10.0": true, "0.9.4": false, "1.10.0": false, "dev": false} {
		if proteoscopeVersionTested(version) != want {
			t.Errorf("tested(%q) is not %v", version, want)
		}
	}
}

// Nothing is found where Proteoscope is absent, where another program answers (MaveScape itself
// among them), or where a program never answers; and quickly.
func TestNoProteoscopeWhereItIsNot(t *testing.T) {
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/startup":
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte("<!doctype html><title>Something else</title>"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer other.Close()
	jsonElse := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"version": "1.0.0", "status": "ok"}`))
	}))
	defer jsonElse.Close()
	maveScape, err := newApp(config{noStore: true})
	if err != nil {
		t.Fatal(err)
	}
	handler, err := maveScape.handler()
	if err != nil {
		t.Fatal(err)
	}
	self := httptest.NewServer(handler)
	defer self.Close()
	hanging := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-hanging:
		case <-r.Context().Done():
		}
	}))
	defer slow.Close()
	defer close(hanging)

	start := time.Now()
	got := finderOn(closedPort(t), portOf(t, other.URL), portOf(t, jsonElse.URL), portOf(t, self.URL), portOf(t, slow.URL)).find(context.Background())
	if got.Found {
		t.Fatalf("found where Proteoscope is not: %+v", got)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("looking took %v", elapsed)
	}
	if !strings.HasPrefix(got.Looked, "127.0.0.1:") {
		t.Fatalf("where it looked: %q", got.Looked)
	}
}

// --proteoscope: Proteoscope's own ports by default, off, a port, a range; anything else refused.
func TestProteoscopePortsFlag(t *testing.T) {
	ports, off, err := parseProteoscopePorts("")
	if err != nil || off || len(ports) != 50 || ports[0] != 8765 || ports[49] != 8814 {
		t.Fatalf("the default: %v %v %v", ports[:1], off, err)
	}
	if _, off, err := parseProteoscopePorts("off"); err != nil || !off {
		t.Fatalf("off: %v %v", off, err)
	}
	if ports, _, err := parseProteoscopePorts("9000-9002"); err != nil || len(ports) != 3 || ports[2] != 9002 {
		t.Fatalf("a range: %v %v", ports, err)
	}
	if ports, _, err := parseProteoscopePorts("9100"); err != nil || len(ports) != 1 {
		t.Fatalf("a port: %v %v", ports, err)
	}
	for _, bad := range []string{"proteoscope", "9002-9000", "1-400", "70000", "0"} {
		if _, _, err := parseProteoscopePorts(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if _, err := parseConfig([]string{"--proteoscope", "nine"}); err == nil {
		t.Fatal("parseConfig accepted --proteoscope nine")
	}
	f, _ := newProteoscopeFinder("off")
	if got := f.find(context.Background()); got.Found || !got.Off {
		t.Fatalf("off: %+v", got)
	}
}

// GET /api/proteoscope answers a page on this computer, and a page elsewhere is told why not.
func TestProteoscopeEndpoint(t *testing.T) {
	_, port := fakeProteoscope(t, "0.10.0", false)
	f := finderOn(port)
	local := httptest.NewRequest(http.MethodGet, "/api/proteoscope", nil)
	local.RemoteAddr = "127.0.0.1:50000"
	local.Host = "127.0.0.1:8820"
	recorder := httptest.NewRecorder()
	f.serve(recorder, local)
	var got proteoscopeFound
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil || !got.Found || !got.Tested {
		t.Fatalf("from this computer: %s %v", recorder.Body.String(), err)
	}
	away := httptest.NewRequest(http.MethodGet, "/api/proteoscope", nil)
	away.RemoteAddr = "192.0.2.7:50000"
	away.Host = "192.0.2.1:8820"
	recorder = httptest.NewRecorder()
	f.serve(recorder, away)
	got = proteoscopeFound{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil || got.Found || got.Reason == "" {
		t.Fatalf("from another computer: %s %v", recorder.Body.String(), err)
	}
}
