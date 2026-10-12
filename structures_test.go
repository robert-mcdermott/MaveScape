package main

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The requests behind the Structure view (wave 5, slices 1, 2 and 4): each asks its service what
// NETWORK.md says, with a PDB ID or an accession only; a structure is kept as it came, compressed, once it is
// known to be a whole structure file; and anything else is refused before a byte is sent.
func TestStructureRequestsKeepWhatTheServiceSent(t *testing.T) {
	entry := gzipped(t, []byte("data_2VWF\n#\n_entry.id 2VWF\n#\nloop_\n_atom_site.group_PDB\nATOM\n"))
	model := gzipped(t, []byte("# AlphaFold DB\ndata_AF-P62993-F1\n#\n_entry.id AF-P62993-F1\n"))
	truncated := entry[:len(entry)-6]
	var encodings []string
	service := newFakeService(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/download/2VWF.cif.gz":
			w.Header().Set("Content-Type", "application/gzip")
			w.Write(entry)
		case "/download/1ABC.cif.gz":
			w.Write(truncated)
		case "/download/2ABC.cif.gz":
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte("<!doctype html><title>Maintenance</title>"))
		case "/pdbe/graph-api/mappings/best_structures/P62993":
			w.Write([]byte(`{"P62993":[{"pdb_id":"2vwf","chain_id":"A","unp_start":159,"unp_end":214,"start":3,"end":58,"coverage":0.258}]}`))
		case "/pdbe/graph-api/mappings/best_structures/Q00000":
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"message":"Requested endpoint does not contain any data"}`))
		case "/api/prediction/P62993":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`[{"entryId":"AF-P62993-F1","latestVersion":6,"uniprotAccession":"P62993"}]`))
		case "/files/AF-P62993-F1-predicted_aligned_error_v6.json":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`[{"predicted_aligned_error":[[0,1.5],[1.25,0]],"max_predicted_aligned_error":31.75}]`))
		case "/files/AF-P62993-F1-model_v6.cif":
			// As AlphaFold DB's storage answers: compressed when the client takes it so.
			encodings = append(encodings, r.Header.Get("Accept-Encoding"))
			w.Header().Set("Content-Type", "application/octet-stream")
			if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
				w.Header().Set("Content-Encoding", "gzip")
				w.Write(model)
				return
			}
			w.Write([]byte("data_AF-P62993-F1\n"))
		default:
			http.NotFound(w, r)
		}
	})
	f, handler := testFetcher(t, service)
	for _, c := range []struct {
		path, cached, content string
		body                  []byte
	}{
		{"/api/fetch/pdb/2vwf", "pdb/2VWF.cif.gz", gzipContentType, entry},
		{"/api/fetch/alphafold/p62993/prediction", "alphafold/P62993.prediction.json", jsonContentType, nil},
		{"/api/fetch/pdbe/best-structures/P62993", "pdbe/P62993.best-structures.json", jsonContentType, nil},
		{"/api/fetch/alphafold/P62993/model/v6", "alphafold/AF-P62993-F1-model_v6.cif", gzipContentType, model},
		{"/api/fetch/alphafold/P62993/pae/6", "alphafold/AF-P62993-F1-predicted_aligned_error_v6.json", jsonContentType, nil},
	} {
		rec := get(handler, c.path, nil)
		if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != c.content {
			t.Errorf("%s: %d %q %s", c.path, rec.Code, rec.Header().Get("Content-Type"), rec.Body)
			continue
		}
		if c.body != nil && !bytes.Equal(rec.Body.Bytes(), c.body) {
			t.Errorf("%s: served %d bytes, not the %d the service sent", c.path, rec.Body.Len(), len(c.body))
		}
		kept, err := os.ReadFile(filepath.Join(f.cache.dir, filepath.FromSlash(c.cached)))
		if err != nil {
			t.Errorf("%s: not cached as %s", c.path, c.cached)
		} else if c.body != nil && !bytes.Equal(kept, c.body) {
			t.Errorf("%s: kept other bytes than were sent", c.path)
		}
	}
	if len(encodings) != 1 || encodings[0] != "gzip" {
		t.Errorf("the model was asked for with Accept-Encoding %q", encodings)
	}
	if rec := get(handler, "/api/fetch/pdb/2VWF", nil); rec.Header().Get("X-MaveScape-Cache") != "hit" || rec.Header().Get("X-MaveScape-Source") != "https://files.rcsb.org/download/2VWF.cif.gz" {
		t.Errorf("2VWF again: %v", rec.Header())
	}
	// A cut-off file or a page that is not a structure is refused, and not kept.
	for _, c := range []struct{ path, cached, says string }{
		{"/api/fetch/pdb/1ABC", "pdb/1ABC.cif.gz", "not a whole structure file"},
		{"/api/fetch/pdb/2ABC", "pdb/2ABC.cif.gz", "not a whole structure file"},
		{"/api/fetch/pdb/9ZZZ", "pdb/9ZZZ.cif.gz", "RCSB has no PDB entry 9ZZZ"},
		{"/api/fetch/alphafold/P62993/model/5", "alphafold/AF-P62993-F1-model_v5.cif", "AlphaFold DB has no model 5 of P62993"},
		{"/api/fetch/alphafold/P62993/pae/5", "alphafold/AF-P62993-F1-predicted_aligned_error_v5.json", "AlphaFold DB has no aligned error for model 5 of P62993"},
		{"/api/fetch/pdbe/best-structures/Q00000", "pdbe/Q00000.best-structures.json", "PDBe knows no structure of Q00000"},
	} {
		rec := get(handler, c.path, nil)
		if rec.Code == http.StatusOK || !strings.Contains(rec.Body.String(), c.says) {
			t.Errorf("%s: %d %s", c.path, rec.Code, rec.Body)
		}
		if _, err := os.Stat(filepath.Join(f.cache.dir, filepath.FromSlash(c.cached))); err == nil {
			t.Errorf("%s was cached", c.cached)
		}
	}
	// Nothing but identifiers.
	before := service.count()
	for _, path := range []string{
		"/api/fetch/pdb/GRB2",
		"/api/fetch/pdb/2VWF.cif",
		"/api/fetch/pdb/12345",
		"/api/fetch/alphafold/GRB2/prediction",
		"/api/fetch/alphafold/P62993/model/latest",
		"/api/fetch/alphafold/P62993/model/0",
		"/api/fetch/alphafold/MEAIAKYDFK/model/6",
		"/api/fetch/alphafold/GRB2/pae/6",
		"/api/fetch/alphafold/P62993/pae/latest",
		"/api/fetch/pdbe/best-structures/GRB2",
	} {
		if rec := get(handler, path, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", path, rec.Code, rec.Body)
		}
	}
	if service.count() != before {
		t.Errorf("refused requests reached the service")
	}
}

func TestStructureFilesAreRecognized(t *testing.T) {
	for _, c := range []struct {
		text string
		ok   bool
	}{
		{"data_1TUP\n#\n", true},
		{"# generated by AlphaFold\n# another comment\ndata_AF\n", true},
		{"HEADER    TRANSCRIPTION/DNA                       11-JUL-95   1TUP\n", true},
		{"ATOM      1  N   SER A  94      -2.234  78.396  33.420  1.00 80.62           N\n", true},
		{"\ufeffdata_x\n", true},
		{"<!doctype html>", false},
		{`{"error":"not found"}`, false},
		{"", false},
	} {
		if got := checkStructure([]byte(c.text)) == nil; got != c.ok {
			t.Errorf("%q: %v", c.text, got)
		}
		if got := checkStructure(gzipped(t, []byte(c.text))) == nil; got != c.ok {
			t.Errorf("%q, compressed: %v", c.text, got)
		}
	}
}
