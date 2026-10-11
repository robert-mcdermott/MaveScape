package main

// The requests behind the sequence tracks (wave 3, slice 5; requirements V5, I3, I4): UniProt's
// features of an entry, PDBe-KB's conservation profile, AlphaMissense's predictions as AlphaFold
// DB publishes them, ClinVar's records of a gene (NCBI E-utilities), gnomAD's variants of a gene's
// MANE Select transcript, and MaveDB's own annotations of a score set's variants. Each carries a
// public identifier only: an accession, a gene symbol, a URN, or ClinVar's record numbers.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	// UniProt's features that become tracks: domains and regions, sites and motifs, secondary
	// structure (web/lib/providers/uniprot-features.js).
	uniprotFeatureFields = "accession,sequence,ft_domain,ft_region,ft_repeat,ft_zn_fing,ft_dna_bind,ft_compbias,ft_coiled,ft_motif,ft_topo_dom,ft_transmem,ft_intramem,ft_signal,ft_transit,ft_propep,ft_act_site,ft_binding,ft_site,ft_mod_res,ft_lipid,ft_carbohyd,ft_disulfid,ft_crosslnk,ft_helix,ft_strand,ft_turn"
	pdbeConservation     = "https://www.ebi.ac.uk/pdbe/graph-api/uniprot/sequence_conservation/"
	ncbiEsearch          = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
	ncbiEsummary         = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
	gnomadAPI            = "https://gnomad.broadinstitute.org/api"
	// ClinVar's records whose change is to a protein's residue: missense, nonsense, synonymous.
	clinvarConsequences = `("missense variant"[molecular consequence] OR "nonsense"[molecular consequence] OR "synonymous variant"[molecular consequence])`
	// esearch answers up to 10,000 identifiers a page; esummary is asked for up to 500 at a time.
	clinvarSearchPage  = 10000
	clinvarSummaryMax  = 500
	clinvarSearchPages = 20
	// The gnomAD release whose variants are asked for (gnomAD v4).
	gnomadDataset = "gnomad_r4"
)

const (
	gnomadGeneQuery       = `query MaveScapeGene($gene: String!) { gene(gene_symbol: $gene, reference_genome: GRCh38) { gene_id symbol name canonical_transcript_id mane_select_transcript { ensembl_id ensembl_version refseq_id refseq_version } } }`
	gnomadTranscriptQuery = `query MaveScapeTranscript($id: String!) { transcript(transcript_id: $id, reference_genome: GRCh38) { transcript_id transcript_version gene { symbol } variants(dataset: ` + gnomadDataset + `) { variant_id hgvsc hgvsp consequence flags joint { ac an filters } } } }`
)

var (
	// A gene's symbol (HGNC's letters, digits, hyphens and dots; GRB2, BRCA1, HLA-A).
	geneSymbolPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]{0,29}$`)
	// A ClinVar release among MaveDB's namespaces (clinvar.2026_01).
	clinvarReleasePattern = regexp.MustCompile(`^[0-9]{4}_[0-9]{2}$`)
	// A canonical UniProtKB accession: AlphaMissense covers each entry's canonical sequence only.
	canonicalAccession = regexp.MustCompile(`^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$`)
)

func normalizeGene(raw string) (string, bool) {
	gene := strings.ToUpper(strings.TrimSpace(raw))
	return gene, geneSymbolPattern.MatchString(gene)
}

// A GraphQL request's body, as gnomAD's API takes it.
type graphQLRequest struct {
	Query     string            `json:"query"`
	Variables map[string]string `json:"variables"`
}

// gnomadAnswer reads a GraphQL answer: a gene or transcript gnomAD does not hold is "not found"
// (it answers HTTP 200 with an error); any other error is refused rather than cached.
func gnomadAnswer(body []byte) error {
	var answer struct {
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &answer); err != nil {
		return err
	}
	if len(answer.Errors) == 0 {
		return nil
	}
	message := answer.Errors[0].Message
	if strings.Contains(strings.ToLower(message), "not found") {
		return errUpstreamNotFound
	}
	return fetchErrorf(http.StatusBadGateway, "gnomAD could not answer: %s", message)
}

func gnomadCall(name, query, variable, value string) (call, error) {
	body, err := json.Marshal(graphQLRequest{Query: query, Variables: map[string]string{variable: value}})
	if err != nil {
		return call{}, err
	}
	return call{name: name, source: gnomadAPI, body: body}, nil
}

var annotationRequests = []publicRequest{
	{
		Route:    "GET /api/fetch/uniprot/{accession}/features",
		Service:  "UniProt",
		Upstream: "https://rest.uniprot.org/uniprotkb/{accession}.json?fields=" + uniprotFeatureFields,
		Sends:    "a UniProt accession (P62993)",
		Why:      "the entry's features: domains, regions, motifs, sites, modified residues and secondary structure, as tracks beside the map",
		Format:   formatJSON,
		Kind:     "uniprot", MaxAge: defaultCacheMaxAge, Limit: 16 << 20, Version: "X-UniProt-Release",
		resolve: func(r *http.Request) (call, error) {
			accession, ok := normalizeAccession(r.PathValue("accession"))
			if !ok {
				return call{}, errors.New("Not a UniProt accession: give one such as P62993 or P62993-2.")
			}
			return call{name: accession + ".features.json", source: "https://rest.uniprot.org/uniprotkb/" + accession + ".json?fields=" + uniprotFeatureFields}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("UniProt has no entry %s.", strings.ToUpper(r.PathValue("accession")))
		},
	},
	{
		Route:    "GET /api/fetch/pdbe/conservation/{accession}",
		Service:  "PDBe-KB",
		Upstream: pdbeConservation + "{accession}",
		Sends:    "a UniProt accession",
		Why:      "the entry's residue conservation: each position's amino-acid probabilities from a profile of its homologues (3DPatch, HMMER), as a track",
		Format:   formatJSON,
		Kind:     "pdbe", MaxAge: defaultCacheMaxAge, Limit: 16 << 20,
		resolve: func(r *http.Request) (call, error) {
			accession, ok := normalizeAccession(r.PathValue("accession"))
			if !ok {
				return call{}, errors.New("Not a UniProt accession: give one such as P62993.")
			}
			return call{name: accession + ".conservation.json", source: pdbeConservation + accession}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("PDBe-KB has no conservation profile for %s.", strings.ToUpper(r.PathValue("accession")))
		},
	},
	{
		Route:    "GET /api/fetch/alphafold/{accession}/missense",
		Service:  "AlphaFold DB",
		Upstream: "https://alphafold.ebi.ac.uk/files/AF-{accession}-F1-aa-substitutions.csv",
		Sends:    "a UniProt accession (canonical, without an isoform)",
		Why:      "AlphaMissense's pathogenicity of every substitution of a human protein (CSV), as a track and beside each variant",
		Format:   formatCSV,
		Kind:     "alphafold", MaxAge: defaultCacheMaxAge, Limit: 64 << 20,
		resolve: func(r *http.Request) (call, error) {
			accession := strings.ToUpper(strings.TrimSpace(r.PathValue("accession")))
			if !canonicalAccession.MatchString(accession) {
				return call{}, errors.New("Not a canonical UniProt accession: give one such as P62993 (AlphaMissense covers each entry's canonical sequence).")
			}
			return call{name: accession + ".aa-substitutions.csv", source: "https://alphafold.ebi.ac.uk/files/AF-" + accession + "-F1-aa-substitutions.csv"}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("AlphaFold DB has no AlphaMissense predictions for %s (they cover human proteins).", strings.ToUpper(r.PathValue("accession")))
		},
	},
	{
		Route:    "GET /api/fetch/clinvar/search",
		Service:  "NCBI E-utilities",
		Upstream: ncbiEsearch + "?db=clinvar&term={term}&retmax=10000&retstart={start}&retmode=json&tool=mavescape",
		Sends:    "a gene's symbol and the page of results, in the term `GRB2[gene] AND (\"missense variant\"[molecular consequence] OR \"nonsense\"[molecular consequence] OR \"synonymous variant\"[molecular consequence])`",
		Why:      "the ClinVar records of the gene's missense, nonsense and synonymous variants (their numbers)",
		Format:   formatJSON,
		Kind:     "clinvar", MaxAge: 7 * 24 * time.Hour, Limit: 16 << 20,
		resolve: func(r *http.Request) (call, error) {
			gene, ok := normalizeGene(r.URL.Query().Get("gene"))
			if !ok {
				return call{}, errors.New("Give a gene's symbol to search ClinVar for (?gene=GRB2).")
			}
			page := 1
			if raw := r.URL.Query().Get("page"); raw != "" {
				n, err := strconv.Atoi(raw)
				if err != nil || n < 1 || n > clinvarSearchPages {
					return call{}, fmt.Errorf("The page of results is a whole number from 1 to %d.", clinvarSearchPages)
				}
				page = n
			}
			term := gene + "[gene] AND " + clinvarConsequences
			query := "?db=clinvar&term=" + url.QueryEscape(term) + "&retmax=" + strconv.Itoa(clinvarSearchPage) + "&retstart=" + strconv.Itoa((page-1)*clinvarSearchPage) + "&retmode=json&tool=mavescape"
			return call{name: fmt.Sprintf("%s.search.%d.json", gene, page), source: ncbiEsearch + query}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("ClinVar's search for %s did not answer.", r.URL.Query().Get("gene"))
		},
	},
	{
		Route:    "GET /api/fetch/clinvar/summary",
		Service:  "NCBI E-utilities",
		Upstream: ncbiEsummary + "?db=clinvar&id={ids}&retmode=json&tool=mavescape",
		Sends:    "up to 500 ClinVar record numbers (from the search above)",
		Why:      "each record's variant, classification, review status and date",
		Format:   formatJSON,
		Kind:     "clinvar", MaxAge: 7 * 24 * time.Hour, Limit: 32 << 20,
		resolve: func(r *http.Request) (call, error) {
			raw := strings.Split(r.URL.Query().Get("ids"), ",")
			ids := make([]string, 0, len(raw))
			for _, id := range raw {
				id = strings.TrimSpace(id)
				if id == "" {
					continue
				}
				if n, err := strconv.ParseUint(id, 10, 32); err != nil || n == 0 || strconv.FormatUint(n, 10) != id {
					return call{}, fmt.Errorf("%q is not a ClinVar record number.", id)
				}
				ids = append(ids, id)
			}
			switch {
			case len(ids) == 0:
				return call{}, errors.New("Give the ClinVar record numbers to summarize (?ids=4673731,…).")
			case len(ids) > clinvarSummaryMax:
				return call{}, fmt.Errorf("Up to %d ClinVar records are summarized at a time; this asks for %d.", clinvarSummaryMax, len(ids))
			}
			list := strings.Join(ids, ",")
			return call{name: sha256Hex(list) + ".summary.json", source: ncbiEsummary + "?db=clinvar&id=" + list + "&retmode=json&tool=mavescape"}, nil
		},
		notFound: func(*http.Request) string { return "ClinVar has none of these records." },
	},
	{
		Route:    "GET /api/fetch/gnomad/gene/{symbol}",
		Service:  "gnomAD",
		Method:   http.MethodPost,
		Upstream: gnomadAPI,
		Sends:    "a gene's symbol (GRB2), in a GraphQL query for the gene",
		Why:      "the gene's identifiers and its MANE Select transcript, whose variants are asked for next",
		Format:   formatJSON,
		Kind:     "gnomad", MaxAge: defaultCacheMaxAge, Limit: 1 << 20,
		resolve: func(r *http.Request) (call, error) {
			gene, ok := normalizeGene(r.PathValue("symbol"))
			if !ok {
				return call{}, errors.New("Not a gene's symbol: give one such as GRB2.")
			}
			return gnomadCall(gene+".gene.json", gnomadGeneQuery, "gene", gene)
		},
		answer: gnomadAnswer,
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("gnomAD has no gene %s (on GRCh38).", strings.ToUpper(r.PathValue("symbol")))
		},
	},
	{
		Route:    "GET /api/fetch/gnomad/transcript/{id}",
		Service:  "gnomAD",
		Method:   http.MethodPost,
		Upstream: gnomadAPI,
		Sends:    "an Ensembl transcript identifier (ENST00000316804), in a GraphQL query for its variants",
		Why:      "the transcript's variants in gnomAD v4: each one's change to the protein and its allele count and number, exomes and genomes joined",
		Format:   formatJSON,
		Kind:     "gnomad", MaxAge: defaultCacheMaxAge, Limit: 128 << 20,
		resolve: func(r *http.Request) (call, error) {
			id, ok := normalizeEnsemblTranscript(r.PathValue("id"))
			if !ok || !strings.HasPrefix(id, "ENST") {
				return call{}, errors.New("Not a human Ensembl transcript: give one such as ENST00000316804.")
			}
			return gnomadCall(id+".variants.json", gnomadTranscriptQuery, "id", id)
		},
		answer: gnomadAnswer,
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("gnomAD has no transcript %s.", strings.ToUpper(r.PathValue("id")))
		},
	},
	{
		Route:    "GET /api/fetch/mavedb/score-sets/{urn}/namespaces",
		Service:  "MaveDB",
		Upstream: mavedbAPI + "/score-sets/{urn}/csv-namespaces",
		Sends:    "a MaveDB URN",
		Why:      "which annotations MaveDB keeps for the score set's variants (gnomAD, ClinVar's releases)",
		Format:   formatJSON,
		Kind:     "mavedb", MaxAge: 7 * 24 * time.Hour, Limit: 4 << 20,
		resolve: mavedbCall("/csv-namespaces", ".namespaces.json"),
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("MaveDB has no published score set %s.", r.PathValue("urn"))
		},
	},
	{
		Route:    "GET /api/fetch/mavedb/score-sets/{urn}/annotations",
		Service:  "MaveDB",
		Upstream: mavedbAPI + "/score-sets/{urn}/variants/data?namespaces=gnomad&namespaces=clinvar.{release}",
		Sends:    "a MaveDB URN and a ClinVar release (2026_01)",
		Why:      "MaveDB's annotations of the score set's variants: gnomAD's frequencies and ClinVar's classifications, by variant (CSV)",
		Format:   formatCSV,
		Kind:     "mavedb", MaxAge: defaultCacheMaxAge, Limit: maxDownloadBytes,
		resolve: func(r *http.Request) (call, error) {
			base, err := mavedbCall("/variants/data?namespaces=gnomad", ".annotations")(r)
			if err != nil {
				return call{}, err
			}
			release := r.URL.Query().Get("clinvar")
			if release == "" {
				return call{name: base.name + ".csv", source: base.source}, nil
			}
			if !clinvarReleasePattern.MatchString(release) {
				return call{}, errors.New("A ClinVar release is written as MaveDB names it: 2026_01.")
			}
			return call{name: base.name + ".clinvar_" + release + ".csv", source: base.source + "&namespaces=clinvar." + release}, nil
		},
		notFound: func(r *http.Request) string {
			return fmt.Sprintf("MaveDB has no annotations for %s.", r.PathValue("urn"))
		},
	},
}

func init() {
	publicRequests = append(publicRequests, annotationRequests...)
}
