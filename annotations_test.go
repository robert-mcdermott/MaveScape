package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The requests behind the tracks (wave 3, slice 5): each asks its service what NETWORK.md says,
// with a public identifier only, is cached under its own name, and refuses anything else before a
// byte is sent.
func TestTrackRequestsAskWhatTheySay(t *testing.T) {
	var asked []string
	var posted []string
	service := newFakeService(t, func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery)
		switch {
		case r.URL.Path == "/uniprotkb/P62993.json":
			if !strings.HasPrefix(r.URL.Query().Get("fields"), "accession,sequence,ft_domain") {
				t.Errorf("UniProt's fields %q", r.URL.Query().Get("fields"))
			}
			w.Header().Set("X-UniProt-Release", "2026_03")
			w.Write([]byte(`{"primaryAccession":"P62993","features":[]}`))
		case r.URL.Path == "/pdbe/graph-api/uniprot/sequence_conservation/P62993":
			w.Write([]byte(`{"identifier":"P62993","data":{"index":[1]}}`))
		case r.URL.Path == "/pdbe/graph-api/uniprot/sequence_conservation/Q00000":
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"message":"Requested endpoint does not contain any data"}`))
		case r.URL.Path == "/files/AF-P62993-F1-aa-substitutions.csv":
			if r.Header.Get("Accept") != "text/csv" {
				t.Errorf("Accept %q", r.Header.Get("Accept"))
			}
			w.Write([]byte("protein_variant,am_pathogenicity,am_class\nM1A,0.9576,LPath\n"))
		case strings.HasPrefix(r.URL.Path, "/files/"):
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte("<?xml version='1.0'?><Error><Code>NoSuchKey</Code></Error>"))
		case r.URL.Path == "/entrez/eutils/esearch.fcgi":
			q := r.URL.Query()
			if q.Get("db") != "clinvar" || q.Get("term") != `GRB2[gene] AND ("missense variant"[molecular consequence] OR "nonsense"[molecular consequence] OR "synonymous variant"[molecular consequence])` || q.Get("retmax") != "10000" || q.Get("retstart") != "10000" || q.Get("retmode") != "json" {
				t.Errorf("ClinVar's search %s", r.URL.RawQuery)
			}
			w.Write([]byte(`{"esearchresult":{"count":"10","idlist":["4673731"]}}`))
		case r.URL.Path == "/entrez/eutils/esummary.fcgi":
			if r.URL.Query().Get("id") != "4673731,4426949" || r.URL.Query().Get("db") != "clinvar" {
				t.Errorf("ClinVar's summaries %s", r.URL.RawQuery)
			}
			w.Write([]byte(`{"result":{"uids":["4673731","4426949"]}}`))
		case r.URL.Path == "/api" && r.Method == http.MethodPost:
			raw, _ := io.ReadAll(r.Body)
			posted = append(posted, string(raw))
			var body graphQLRequest
			if err := json.Unmarshal(raw, &body); err != nil {
				t.Fatalf("gnomAD's body: %v", err)
			}
			switch {
			case body.Variables["gene"] == "GRB2":
				w.Write([]byte(`{"data":{"gene":{"gene_id":"ENSG00000177885","mane_select_transcript":{"ensembl_id":"ENST00000316804"}}}}`))
			case body.Variables["gene"] == "NOTAGENE":
				w.Write([]byte(`{"errors":[{"message":"Gene not found"}],"data":{"gene":null}}`))
			case body.Variables["gene"] == "BUSY":
				w.Write([]byte(`{"errors":[{"message":"Rate limit exceeded"}],"data":null}`))
			case body.Variables["id"] == "ENST00000316804":
				if !strings.Contains(body.Query, "variants(dataset: gnomad_r4)") || !strings.Contains(body.Query, "joint { ac an filters }") {
					t.Errorf("gnomAD's query %q", body.Query)
				}
				w.Write([]byte(`{"data":{"transcript":{"transcript_id":"ENST00000316804","variants":[]}}}`))
			default:
				t.Errorf("gnomAD asked %s", raw)
			}
		case r.URL.Path == "/api/v1/score-sets/urn:mavedb:00000097-0-2/csv-namespaces":
			w.Write([]byte(`[{"namespace":"clinvar.2026_01"}]`))
		case r.URL.Path == "/api/v1/score-sets/urn:mavedb:00000097-0-2/variants/data":
			if got := r.URL.Query()["namespaces"]; strings.Join(got, ",") != "gnomad,clinvar.2026_01" {
				t.Errorf("MaveDB's namespaces %v", got)
			}
			w.Write([]byte("accession,hgvs_nt,hgvs_splice,hgvs_pro,gnomad.gnomad_af\nurn:mavedb:00000097-0-2#1,NM_007294.3:c.5565A>T,NA,NA,NA\n"))
		default:
			http.NotFound(w, r)
		}
	})
	f, handler := testFetcher(t, service)
	for _, c := range []struct {
		path, cached, content string
	}{
		{"/api/fetch/uniprot/p62993/features", "uniprot/P62993.features.json", jsonContentType},
		{"/api/fetch/pdbe/conservation/P62993", "pdbe/P62993.conservation.json", jsonContentType},
		{"/api/fetch/alphafold/P62993/missense", "alphafold/P62993.aa-substitutions.csv", csvContentType},
		{"/api/fetch/clinvar/search?gene=grb2&page=2", "clinvar/GRB2.search.2.json", jsonContentType},
		{"/api/fetch/clinvar/summary?ids=4673731,4426949", "clinvar/" + sha256Hex("4673731,4426949") + ".summary.json", jsonContentType},
		{"/api/fetch/gnomad/gene/GRB2", "gnomad/GRB2.gene.json", jsonContentType},
		{"/api/fetch/gnomad/transcript/ENST00000316804.10", "gnomad/ENST00000316804.variants.json", jsonContentType},
		{"/api/fetch/mavedb/score-sets/urn:mavedb:00000097-0-2/namespaces", "mavedb/urn_mavedb_00000097-0-2.namespaces.json", jsonContentType},
		{"/api/fetch/mavedb/score-sets/urn:mavedb:00000097-0-2/annotations?clinvar=2026_01", "mavedb/urn_mavedb_00000097-0-2.annotations.clinvar_2026_01.csv", csvContentType},
	} {
		rec := get(handler, c.path, nil)
		if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != c.content {
			t.Errorf("%s: %d %q %s", c.path, rec.Code, rec.Header().Get("Content-Type"), rec.Body)
			continue
		}
		if _, err := os.Stat(filepath.Join(f.cache.dir, filepath.FromSlash(c.cached))); err != nil {
			t.Errorf("%s: not cached as %s", c.path, c.cached)
		}
	}
	if rec := get(handler, "/api/fetch/uniprot/P62993/features", nil); rec.Header().Get("X-MaveScape-Version") != "2026_03" || rec.Header().Get("X-MaveScape-Cache") != "hit" {
		t.Errorf("UniProt's features again: %v", rec.Header())
	}
	// gnomAD's GraphQL: the variables posted, an unknown gene "not found" (and not cached), any other
	// error refused (and not cached).
	if len(posted) != 2 || !strings.Contains(posted[0], `"variables":{"gene":"GRB2"}`) || !strings.Contains(posted[1], `"variables":{"id":"ENST00000316804"}`) {
		t.Errorf("gnomAD was posted %q", posted)
	}
	if rec := get(handler, "/api/fetch/gnomad/gene/NOTAGENE", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "gnomAD has no gene NOTAGENE") {
		t.Errorf("an unknown gene: %d %s", rec.Code, rec.Body)
	}
	if rec := get(handler, "/api/fetch/gnomad/gene/BUSY", nil); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "Rate limit exceeded") {
		t.Errorf("an error: %d %s", rec.Code, rec.Body)
	}
	for _, name := range []string{"gnomad/NOTAGENE.gene.json", "gnomad/BUSY.gene.json"} {
		if _, err := os.Stat(filepath.Join(f.cache.dir, filepath.FromSlash(name))); err == nil {
			t.Errorf("%s was cached", name)
		}
	}
	if rec := get(handler, "/api/fetch/pdbe/conservation/Q00000", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "PDBe-KB has no conservation profile for Q00000") {
		t.Errorf("no profile: %d %s", rec.Code, rec.Body)
	}
	if rec := get(handler, "/api/fetch/alphafold/P02829/missense", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "no AlphaMissense predictions for P02829") {
		t.Errorf("no predictions: %d %s", rec.Code, rec.Body)
	}
	// Nothing but identifiers: everything else refused before it is sent.
	before := len(asked)
	for _, path := range []string{
		"/api/fetch/uniprot/GRB2/features",
		"/api/fetch/pdbe/conservation/1gri",
		"/api/fetch/alphafold/P62993-2/missense",
		"/api/fetch/alphafold/MEAIAKYDFK/missense",
		"/api/fetch/clinvar/search",
		"/api/fetch/clinvar/search?gene=GRB2%5Bgene%5D%20OR%20all",
		"/api/fetch/clinvar/search?gene=GRB2&page=0",
		"/api/fetch/clinvar/search?gene=GRB2&page=21",
		"/api/fetch/clinvar/summary",
		"/api/fetch/clinvar/summary?ids=1,x",
		"/api/fetch/clinvar/summary?ids=01",
		"/api/fetch/clinvar/summary?ids=" + strings.Repeat("1,", 501) + "1",
		"/api/fetch/gnomad/gene/GRB2%20SH3",
		"/api/fetch/gnomad/transcript/ENSMUST00000000001",
		"/api/fetch/gnomad/transcript/ENSG00000177885",
		"/api/fetch/mavedb/score-sets/tmp:abc/namespaces",
		"/api/fetch/mavedb/score-sets/urn:mavedb:00000097-0-2/annotations?clinvar=latest",
	} {
		if rec := get(handler, path, nil); rec.Code != http.StatusBadRequest && rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d", path, rec.Code)
		}
	}
	if len(asked) != before {
		t.Fatalf("an invalid request reached a service: %v", asked[before:])
	}
}
