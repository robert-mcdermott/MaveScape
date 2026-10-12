package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Proteoscope, when it is running on this computer (wave 5, slice 6; requirement X6). The page
// asks GET /api/proteoscope; the server looks for a Proteoscope on the loopback ports it takes
// (8765, or one of the 49 above it when that one is busy; --proteoscope names others, or "off"),
// by its startup answer, and says which version it is and whether MaveScape was tested with it.
// Nothing leaves the computer. The page then hands the structure shown to it in what it already
// accepts (web/ui/proteoscope.js): a link to a session, or a session file to open. Nothing else
// in MaveScape depends on it: when it is not running, the page offers nothing.

const (
	proteoscopeHost      = "127.0.0.1"
	proteoscopeFirstPort = 8765
	proteoscopePortCount = 50
	// A port that answers at all answers this quickly on the loopback interface; one that does not
	// listen refuses at once.
	proteoscopeProbeTimeout = 600 * time.Millisecond
	// One look serves the page's questions for this long.
	proteoscopeRemember = 2 * time.Second
)

// The Proteoscope versions MaveScape's sessions were tested with (major.minor): their session
// format (version 1), its residue data, and the #session= link that carries it.
var proteoscopeTested = []string{"0.10"}

// What the page is told: found or not, where, which version, and whether it was tested.
type proteoscopeFound struct {
	Found         bool   `json:"found"`
	URL           string `json:"url,omitempty"`
	Version       string `json:"version,omitempty"`
	Tested        bool   `json:"tested"`
	RemoteControl bool   `json:"remoteControl"`
	Offline       bool   `json:"offline"`
	// Looked: where it was looked for, "127.0.0.1:8765–8814"; Off: --proteoscope off.
	Looked string `json:"looked"`
	Off    bool   `json:"off,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type proteoscopeFinder struct {
	host  string
	ports []int
	off   bool
	// timeout for each port; client for the requests.
	timeout time.Duration
	client  *http.Client

	mu     sync.Mutex
	last   proteoscopeFound
	lastAt time.Time
}

func newProteoscopeFinder(spec string) (*proteoscopeFinder, error) {
	ports, off, err := parseProteoscopePorts(spec)
	if err != nil {
		return nil, err
	}
	return &proteoscopeFinder{
		host:    proteoscopeHost,
		ports:   ports,
		off:     off,
		timeout: proteoscopeProbeTimeout,
		// No proxy: the requests are to this computer.
		client: &http.Client{Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}},
	}, nil
}

// parseProteoscopePorts reads --proteoscope: "" (Proteoscope's own ports), "off", a port, or a
// range of ports ("9000-9010").
func parseProteoscopePorts(spec string) ([]int, bool, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		ports := make([]int, proteoscopePortCount)
		for i := range ports {
			ports[i] = proteoscopeFirstPort + i
		}
		return ports, false, nil
	}
	if strings.EqualFold(spec, "off") {
		return nil, true, nil
	}
	first, last, isRange := strings.Cut(spec, "-")
	low, err := strconv.Atoi(strings.TrimSpace(first))
	if err != nil || low < 1 || low > 65535 {
		return nil, false, fmt.Errorf("--proteoscope must be off, a port or a range of ports (9000-9010), not %q", spec)
	}
	high := low
	if isRange {
		high, err = strconv.Atoi(strings.TrimSpace(last))
		if err != nil || high < low || high > 65535 || high-low >= 200 {
			return nil, false, fmt.Errorf("--proteoscope must be off, a port or a range of at most 200 ports (9000-9010), not %q", spec)
		}
	}
	ports := make([]int, 0, high-low+1)
	for p := low; p <= high; p++ {
		ports = append(ports, p)
	}
	return ports, false, nil
}

func (f *proteoscopeFinder) looked() string {
	if f.off {
		return "nowhere (--proteoscope off)"
	}
	if len(f.ports) == 1 {
		return net.JoinHostPort(f.host, strconv.Itoa(f.ports[0]))
	}
	return fmt.Sprintf("%s:%d–%d", f.host, f.ports[0], f.ports[len(f.ports)-1])
}

// find looks at every port at once and takes the first, in the order given, that is Proteoscope.
func (f *proteoscopeFinder) find(ctx context.Context) proteoscopeFound {
	result := proteoscopeFound{Looked: f.looked(), Off: f.off}
	if f.off {
		return result
	}
	found := make([]*proteoscopeFound, len(f.ports))
	var wg sync.WaitGroup
	for i, port := range f.ports {
		wg.Add(1)
		go func(i, port int) {
			defer wg.Done()
			if got, ok := f.probe(ctx, port); ok {
				found[i] = &got
			}
		}(i, port)
	}
	wg.Wait()
	for _, got := range found {
		if got != nil {
			got.Looked = result.Looked
			return *got
		}
	}
	return result
}

// probe asks one port for Proteoscope's startup answer: {"version", "offline", "remoteControl",
// "files"}. Anything else there (another program, MaveScape itself) is not Proteoscope.
func (f *proteoscopeFinder) probe(ctx context.Context, port int) (proteoscopeFound, bool) {
	ctx, cancel := context.WithTimeout(ctx, f.timeout)
	defer cancel()
	base := "http://" + net.JoinHostPort(f.host, strconv.Itoa(port))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/startup", nil)
	if err != nil {
		return proteoscopeFound{}, false
	}
	response, err := f.client.Do(request)
	if err != nil {
		return proteoscopeFound{}, false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") {
		return proteoscopeFound{}, false
	}
	var body map[string]json.RawMessage
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&body) != nil {
		return proteoscopeFound{}, false
	}
	var version string
	var offline, remote bool
	_, hasFiles := body["files"]
	if !hasFiles || json.Unmarshal(body["version"], &version) != nil || version == "" || json.Unmarshal(body["offline"], &offline) != nil || json.Unmarshal(body["remoteControl"], &remote) != nil {
		return proteoscopeFound{}, false
	}
	return proteoscopeFound{Found: true, URL: base + "/", Version: version, Tested: proteoscopeVersionTested(version), RemoteControl: remote, Offline: offline}, true
}

// proteoscopeVersionTested: the version's major.minor is one MaveScape was tested with.
func proteoscopeVersionTested(version string) bool {
	parts := strings.SplitN(strings.TrimPrefix(version, "v"), ".", 3)
	if len(parts) < 2 {
		return false
	}
	for _, tested := range proteoscopeTested {
		if parts[0]+"."+parts[1] == tested {
			return true
		}
	}
	return false
}

// serve answers GET /api/proteoscope. Only for a page on this computer: a link to 127.0.0.1 means
// nothing to a browser elsewhere.
func (f *proteoscopeFinder) serve(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		writeJSON(w, proteoscopeFound{Looked: f.looked(), Reason: "MaveScape is open on another computer: Proteoscope is looked for only on the computer MaveScape runs on, for a page there."})
		return
	}
	f.mu.Lock()
	if !f.lastAt.IsZero() && time.Since(f.lastAt) < proteoscopeRemember && r.URL.Query().Get("again") == "" {
		last := f.last
		f.mu.Unlock()
		writeJSON(w, last)
		return
	}
	f.mu.Unlock()
	found := f.find(r.Context())
	if errors.Is(r.Context().Err(), context.Canceled) {
		return
	}
	f.mu.Lock()
	f.last, f.lastAt = found, time.Now()
	f.mu.Unlock()
	writeJSON(w, found)
}
