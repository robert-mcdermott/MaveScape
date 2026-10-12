package main

// The requests behind the Structure view (wave 5, slices 1 and 2; requirements X1, X2): a PDB
// entry's coordinates from RCSB, a protein's AlphaFold DB entries and predicted model, and the
// structures that cover a protein, ranked by PDBe's SIFTS. Each carries a public identifier only: a
// PDB ID or a UniProt accession. A structure is kept in the cache as the
// service sent it, compressed (RCSB's .cif.gz file; AlphaFold DB's file as it stores it, gzip), and
// the page decompresses it; the program checks that it is a whole structure file first.

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

const (
	formatStructure     = "structure"
	gzipContentType     = "application/gzip"
	structureTextType   = "chemical/x-mmcif"
	alphafoldPrediction = "https://alphafold.ebi.ac.uk/api/prediction/"
	pdbeBestStructures  = "https://www.ebi.ac.uk/pdbe/graph-api/mappings/best_structures/"
	alphafoldFiles      = "https://alphafold.ebi.ac.uk/files/"
	// The largest structure accepted once decompressed: far more than a browser can draw.
	maxStructureText = 2 << 30
)

var (
	// A PDB ID: four characters (2VWF), or the extended form (pdb_00002vwf).
	pdbIDPattern = regexp.MustCompile(`^([0-9][A-Z0-9]{3}|PDB_[0-9]{4}[0-9A-Z]{4})$`)
	// An AlphaFold DB model's version (6 in AF-P62993-F1-model_v6.cif).
	modelVersionPattern = regexp.MustCompile(`^[1-9][0-9]?$`)
)

func normalizePDBID(raw string) (string, bool) {
	id := strings.ToUpper(strings.TrimSpace(raw))
	if !pdbIDPattern.MatchString(id) {
		return "", false
	}
	if strings.HasPrefix(id, "PDB_") {
		id = strings.ToLower(id)
	}
	return id, true
}

var structureRequests = []publicRequest{
	{
		Route:    "GET /api/fetch/pdb/{id}",
		Service:  "RCSB PDB",
		Upstream: "https://files.rcsb.org/download/{id}.cif.gz",
		Sends:    "a PDB ID (2VWF)",
		Why:      "the entry's coordinates (mmCIF, compressed), its chains and biological assemblies, for the Structure view (Structure: **Open a structure**; `open_structure`)",
		Format:   formatStructure,
		Kind:     "pdb", MaxAge: defaultCacheMaxAge, Limit: 512 << 20,
		resolve: func(r *http.Request) (call, error) {
			id, ok := normalizePDBID(r.PathValue("id"))
			if !ok {
				return call{}, errors.New("Not a PDB ID: give one such as 2VWF.")
			}
			return call{name: id + ".cif.gz", source: "https://files.rcsb.org/download/" + id + ".cif.gz"}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("RCSB has no PDB entry %s.", strings.ToUpper(r.PathValue("id")))
		},
	},
	{
		Route:    "GET /api/fetch/alphafold/{accession}/prediction",
		Service:  "AlphaFold DB",
		Upstream: alphafoldPrediction + "{accession}",
		Sends:    "a UniProt accession (P62993)",
		Why:      "the protein's AlphaFold DB entries: each model's version, the residues it covers and its mean confidence, to ask for the latest model",
		Format:   formatJSON,
		Kind:     "alphafold", MaxAge: defaultCacheMaxAge, Limit: 4 << 20,
		resolve: func(r *http.Request) (call, error) {
			accession, ok := normalizeAccession(r.PathValue("accession"))
			if !ok {
				return call{}, errors.New("Not a UniProt accession: give one such as P62993 or P62993-2.")
			}
			return call{name: accession + ".prediction.json", source: alphafoldPrediction + accession}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("AlphaFold DB has no prediction for %s.", strings.ToUpper(r.PathValue("accession")))
		},
	},
	{
		Route:    "GET /api/fetch/alphafold/{accession}/model/{version}",
		Service:  "AlphaFold DB",
		Upstream: alphafoldFiles + "AF-{accession}-F1-model_v{version}.cif",
		Sends:    "a UniProt accession and a model version (6)",
		Why:      "the predicted model (mmCIF, compressed as AlphaFold DB stores it), with each residue's confidence (pLDDT), for the Structure view",
		Format:   formatStructure,
		Kind:     "alphafold", MaxAge: defaultCacheMaxAge, Limit: 256 << 20,
		resolve: func(r *http.Request) (call, error) {
			accession, ok := normalizeAccession(r.PathValue("accession"))
			if !ok {
				return call{}, errors.New("Not a UniProt accession: give one such as P62993.")
			}
			version := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(r.PathValue("version"))), "v")
			if !modelVersionPattern.MatchString(version) {
				return call{}, errors.New("Not an AlphaFold DB model version: give one such as 6.")
			}
			name := "AF-" + accession + "-F1-model_v" + version + ".cif"
			return call{name: name, source: alphafoldFiles + name}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("AlphaFold DB has no model %s of %s.", r.PathValue("version"), strings.ToUpper(r.PathValue("accession")))
		},
	},
	{
		Route:    "GET /api/fetch/pdbe/best-structures/{accession}",
		Service:  "PDBe",
		Upstream: pdbeBestStructures + "{accession}",
		Sends:    "a UniProt accession (P62993)",
		Why:      "the PDB entries that cover the protein, each chain with the UniProt residues SIFTS places on it, its method and resolution, to list the structures of the target (Structure: **Structures of the target**; `find_structures`)",
		Format:   formatJSON,
		Kind:     "pdbe", MaxAge: defaultCacheMaxAge, Limit: 32 << 20,
		resolve: func(r *http.Request) (call, error) {
			accession, ok := normalizeAccession(r.PathValue("accession"))
			if !ok {
				return call{}, errors.New("Not a UniProt accession: give one such as P62993.")
			}
			return call{name: accession + ".best-structures.json", source: pdbeBestStructures + accession}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("PDBe knows no structure of %s.", strings.ToUpper(r.PathValue("accession")))
		},
	},
}

func init() {
	publicRequests = append(publicRequests, structureRequests...)
}

// isGzip: the bytes begin as a gzip stream does.
func isGzip(data []byte) bool {
	return len(data) >= 2 && data[0] == 0x1f && data[1] == 0x8b
}

// checkStructure: a whole structure file, compressed or not. A compressed one is read to its end,
// which checks its length and checksum, without being kept; it must begin as mmCIF or PDB does.
func checkStructure(data []byte) error {
	var head []byte
	if isGzip(data) {
		reader, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			return err
		}
		buffered := bufio.NewReaderSize(reader, 1<<16)
		head, _ = buffered.Peek(4096)
		head = append([]byte{}, head...)
		n, err := io.Copy(io.Discard, io.LimitReader(buffered, maxStructureText+1))
		if err != nil {
			return err
		}
		if n > maxStructureText {
			return errTooLarge
		}
	} else {
		head = data[:min(len(data), 4096)]
	}
	if !looksLikeStructure(head) {
		return errors.New("not an mmCIF or PDB file")
	}
	return nil
}

// looksLikeStructure: an mmCIF file's data block (after comments) or a PDB file's records.
func looksLikeStructure(head []byte) bool {
	text := bytes.TrimLeft(head, " \t\r\n\ufeff")
	for bytes.HasPrefix(text, []byte("#")) {
		_, rest, found := bytes.Cut(text, []byte("\n"))
		if !found {
			return false
		}
		text = bytes.TrimLeft(rest, " \t\r\n")
	}
	if bytes.HasPrefix(text, []byte("data_")) {
		return true
	}
	for _, record := range []string{"HEADER", "TITLE ", "REMARK", "CRYST1", "MODEL ", "ATOM  ", "HETATM", "COMPND", "EXPDTA"} {
		if bytes.HasPrefix(text, []byte(record)) {
			return true
		}
	}
	return false
}
