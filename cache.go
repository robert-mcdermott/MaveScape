package main

// The cache of public data (fetch.go): each response the services sent, on disk under
// <cache dir>/<kind>/<name>, beside <name>.meta.json, its record: the service, the URL it came
// from, when it was retrieved and last checked, and the ETag, Last-Modified and release the
// service gave (docs/FORMATS.md, "The cache of public data"). A copy older than its kind's maximum
// age is fetched again, or confirmed unchanged by its ETag, and is served stale only when the
// service cannot be reached or MaveScape is offline. Adapted from Proteoscope 0.10.0 cache.go:
// the retrieval record is new.

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type diskCache struct {
	dir      string
	maxAge   time.Duration
	warnOnce sync.Once
}

// The record beside each cached response.
type cacheMeta struct {
	ContentType string `json:"contentType"`
	Service     string `json:"service"`
	Source      string `json:"source"`
	// A POST's method and body (a search: the words searched for).
	Method       string `json:"method,omitempty"`
	Request      string `json:"request,omitempty"`
	Retrieved    string `json:"retrieved"`
	Checked      string `json:"checked,omitempty"`
	ETag         string `json:"etag,omitempty"`
	LastModified string `json:"lastModified,omitempty"`
	Version      string `json:"version,omitempty"`
}

type cached struct {
	body []byte
	meta cacheMeta
}

const defaultCacheMaxAge = 30 * 24 * time.Hour

// openCache opens the cache in dir, or in <user cache dir>/MaveScape; nil when there is none.
func openCache(dir string) *diskCache {
	if dir == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			log.Printf("the cache of public data is off: %v", err)
			return nil
		}
		dir = filepath.Join(base, "MaveScape")
	}
	if abs, err := filepath.Abs(dir); err == nil {
		dir = abs
	}
	return &diskCache{dir: dir, maxAge: defaultCacheMaxAge}
}

// load returns a cached response and whether it is older than maxAge (zero: never). Its age is
// that of its file, which a confirmation (touch) renews.
func (c *diskCache) load(kind, name string, maxAge time.Duration) (cached, bool, bool) {
	if c == nil {
		return cached{}, false, false
	}
	file := filepath.Join(c.dir, kind, name)
	raw, err := os.ReadFile(file + ".meta.json")
	if err != nil {
		return cached{}, false, false
	}
	var meta cacheMeta
	if err := json.Unmarshal(raw, &meta); err != nil || meta.ContentType == "" {
		return cached{}, false, false
	}
	info, err := os.Stat(file)
	if err != nil {
		return cached{}, false, false
	}
	body, err := os.ReadFile(file)
	if err != nil {
		return cached{}, false, false
	}
	if maxAge == 0 {
		maxAge = c.maxAge
	}
	stale := maxAge > 0 && time.Since(info.ModTime()) > maxAge
	return cached{body: body, meta: meta}, true, stale
}

func (c *diskCache) store(kind, name string, entry cached) {
	if c == nil {
		return
	}
	if err := c.write(kind, name, entry); err != nil {
		c.warn(err)
	}
}

func (c *diskCache) warn(err error) {
	c.warnOnce.Do(func() {
		log.Printf("the cache of public data could not be written (further cache errors are not logged): %v", err)
	})
}

func (c *diskCache) write(kind, name string, entry cached) error {
	dir := filepath.Join(c.dir, kind)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	meta, err := json.MarshalIndent(entry.meta, "", "  ")
	if err != nil {
		return err
	}
	file := filepath.Join(dir, name)
	if err := writeFileAtomic(file, entry.body); err != nil {
		return err
	}
	return writeFileAtomic(file+".meta.json", append(meta, '\n'))
}

// touch records that the service confirmed a cached response unchanged (HTTP 304) at checked:
// its record says so, and its age starts again.
func (c *diskCache) touch(kind, name string, entry cached, checked time.Time) cached {
	entry.meta.Checked = checked.UTC().Format(time.RFC3339)
	if c == nil {
		return entry
	}
	if err := c.write(kind, name, entry); err != nil {
		c.warn(err)
	}
	return entry
}

func writeFileAtomic(file string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(file), "."+filepath.Base(file)+".*.tmp")
	if err != nil {
		return err
	}
	_, err = tmp.Write(data)
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), file)
	}
	if err != nil {
		os.Remove(tmp.Name())
	}
	return err
}

// A cached response as GET /api/fetch/cache lists it.
type cacheListing struct {
	Kind  string    `json:"kind"`
	Name  string    `json:"name"`
	Bytes int64     `json:"bytes"`
	Meta  cacheMeta `json:"record"`
}

// list returns every cached response, newest retrieval first; a sequence's lookup is named by the
// sequence's SHA-256.
func (c *diskCache) list() []cacheListing {
	out := []cacheListing{}
	if c == nil {
		return out
	}
	kinds, err := os.ReadDir(c.dir)
	if err != nil {
		return out
	}
	for _, kind := range kinds {
		if !kind.IsDir() || strings.HasPrefix(kind.Name(), ".") {
			continue
		}
		entries, err := os.ReadDir(filepath.Join(c.dir, kind.Name()))
		if err != nil {
			continue
		}
		for _, entry := range entries {
			name := entry.Name()
			if entry.IsDir() || strings.HasPrefix(name, ".") || strings.HasSuffix(name, ".meta.json") {
				continue
			}
			found, ok, _ := c.load(kind.Name(), name, -1)
			if !ok {
				continue
			}
			if request, known := requestOfKind(kind.Name()); known && request.Sequence {
				found.meta.Source = fmt.Sprintf("%s (the sequence's lookup; SHA-256 %s)", request.Service, strings.TrimSuffix(name, ".json"))
			}
			out = append(out, cacheListing{Kind: kind.Name(), Name: name, Bytes: int64(len(found.body)), Meta: found.meta})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Meta.Retrieved > out[j].Meta.Retrieved })
	return out
}
