package main

// The remote-control actions (remote.go): what a program on this computer can ask the open
// MaveScape page to do. The page performs them (web/ui/remote.js, whose action table must name
// exactly these; TestEveryActionHasAPageHandler checks it). GET /api/remote/tools lists them with
// their arguments, and the MCP server (roadmap wave 7) will offer the same list to agents.

type remoteAction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	// long: may run for minutes (scoring a large table, QC, an archive with its tables).
	long bool
	// output: writes a file at args.path (output.go), so it needs the token.
	output bool
	// reads: reads files at args.paths (local.go), so it needs the token.
	reads bool
}

func schema(properties map[string]any, required ...string) map[string]any {
	out := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		out["required"] = required
	}
	return out
}

func textArg(description string) map[string]any {
	return map[string]any{"type": "string", "description": description}
}

func flagArg(description string) map[string]any {
	return map[string]any{"type": "boolean", "description": description}
}

var (
	runArg       = textArg("A score run by name (\"Run 2\") or id; the latest run of the current design if not given.")
	conditionArg = textArg("A condition by name or number (from 1), when the design has more than one; the first if not given.")
)

var remoteActions = []remoteAction{
	{Name: "get_state", Description: "The open workspace: its tables, targets, design, score runs, saved selections, the view shown, the focused item and the selection, and the analysis steps (counts, target, design, score, QC, map, record) with the next one to take.", InputSchema: schema(map[string]any{})},
	{Name: "new_workspace", Description: "Starts a new, empty workspace (the open one is saved in the library first).", InputSchema: schema(map[string]any{
		"name": textArg("A name for it."),
	})},
	{Name: "open_example", Description: "Opens a bundled example as a new workspace, scored with MaveScape's defaults, in the view it opens in. Without an id, the error lists the examples.", InputSchema: schema(map[string]any{
		"id": textArg("The example's id or part of its title: \"grb2-sh3\" (GRB2 SH3, MaveDB counts), \"simulated\" (a simulated experiment with known effects) \"simulated-time-series\" (a simulated time series) or \"simulated-sort-seq\" (simulated sorted bins)."),
	}, "id"), long: true},
	{Name: "open_files", Description: "Opens files on this computer, as dropping them on the window does: count or score tables (.csv, .tsv), the target's sequence (.fasta), designs (.design.json), workspace archives (.msz) and structures (.pdb, .cif, .bcif, gzipped or not: shown in the Structure view), or folders of them. Needs the token.", InputSchema: schema(map[string]any{
		"paths":         map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Absolute paths of files or folders."},
		"new_workspace": flagArg("Open them in a new workspace rather than the open one."),
	}, "paths"), long: true, reads: true},
	{Name: "set_mode", Description: "Shows a view: start, experiment, qc, score, map, compare or structure.", InputSchema: schema(map[string]any{
		"mode": textArg("start, experiment, qc, score, map, compare or structure."),
	}, "mode")},
	{Name: "focus", Description: "Shows an item in the inspector: a table, target, score run, saved selection or variant, by name. With no name, clears the focus.", InputSchema: schema(map[string]any{
		"kind": textArg("table, target, run, selection or variant; found by name across all of them if not given."),
		"name": textArg("Its name (a variant by its MAVE-HGVS name, such as p.Trp36Ala)."),
		"run":  runArg,
	})},
	{Name: "draft_design", Description: "Drafts the design from the table's column names (which column is which sample, replicate and time point), as the workflow's \"Draft the design\" does, and reports its problems. Replaces the current design.", InputSchema: schema(map[string]any{
		"table": textArg("The table by name; the one the design describes, or the first, if not given."),
	})},
	{Name: "set_design", Description: "Sets the design (a mavescape-design document, as docs/FORMATS.md describes) for a table, after checking it against the table's columns. Refused, with every problem listed, when it is not valid.", InputSchema: schema(map[string]any{
		"design": map[string]any{"type": "object", "description": "The design document."},
		"table":  textArg("The table by name; the one the design describes, or the first, if not given."),
	}, "design")},
	{Name: "search_mavedb", Description: "Searches MaveDB's published score sets (through MaveScape's list of public services; cached for a day, and from the cache only with --offline): each match's URN, title, targets, organism, license, variants and publication, 100 a page. Only the words searched for are sent.", InputSchema: schema(map[string]any{
		"text": textArg("The words to search for: a gene, a protein, an assay, an author."),
		"page": map[string]any{"type": "integer", "minimum": 1, "description": "The page of 100 results (the first if not given)."},
	}, "text")},
	{Name: "open_mavedb", Description: "Opens a published MaveDB score set as a new workspace: its record (license and terms, citation, target, the assay's keywords, calibrations), its published scores read as published as the run \"Published scores\" on the map, and its counts, when deposited, with a design drafted from their column names to check and score. A target named by a transcript (NM_007294.3, ENST00000460680.5) is fetched from NCBI or Ensembl; nucleotide variants are read at the protein level too. Several score sets of one target (urn holding several URNs) open together: each one's published scores a run, and their counts joined into one table with a design drafted as a condition each, the first the reference, to compare. Cached for offline use.", InputSchema: schema(map[string]any{
		"urn":    textArg("The score set's URN (urn:mavedb:00000835-a-1), or a MaveDB address that holds it; several URNs, separated by spaces or commas, open together."),
		"counts": flagArg("Also open its counts, when it has them (the default)."),
		"target": textArg("Of a score set of several targets, the one to open (its label, as the variants name it)."),
		"mapped": flagArg("Also keep MaveDB's mapping of the variants to the human reference (VRS identifiers), when it has one."),
	}, "urn"), long: true},
	{Name: "check_target", Description: "Checks the target against its UniProt entry, fetched through MaveScape's list of public services (docs/NETWORK.md; cached, and from the cache only with --offline): where the target sits, the differences, and the fields the entry would change (offset, identifiers, organism). With apply, uses them and records the check with the workspace, for its history and methods. Only the accession is sent, never a sequence.", InputSchema: schema(map[string]any{
		"accession": textArg("A UniProt accession (P62993); the target's own if not given."),
		"target":    textArg("A target by name; the design's if not given."),
		"apply":     flagArg("Use what the entry gives and record the check."),
	})},
	{Name: "mavedb_deposit", Description: "What a MaveDB deposit of a run would hold, as MaveDB takes a score set: the variants (and those left out, with why), the target (its sequence, or the transcript that names it), the columns of scores and counts, the experiment's keywords from the design's readout, and what MaveDB requires that the workspace lacks (an abstract, a license, an organism's taxonomy id). Writes nothing: export with what mavedb writes the package.", InputSchema: schema(map[string]any{
		"run":       runArg,
		"condition": conditionArg,
	}), long: true},
	{Name: "set_mavedb_details", Description: "Sets what a MaveDB deposit says that the workspace does not hold (title, shortDescription, abstract, method, experiment, license, publications, dois, rawReads, contributors, experimentUrn, supersedes, taxonomyId, category, keywords): the fields given replace the workspace's, an empty one removes it. Undoable, and in the history.", InputSchema: schema(map[string]any{
		"details": map[string]any{"type": "object", "description": "The details to set: license one of CC0, CC BY 4.0, CC BY-SA 4.0; publications as \"PubMed 29785012\" or a DOI (the first the primary one); rawReads and contributors (ORCID iDs) as lists; keywords as [{key, label, description}] in MaveDB's vocabulary."},
	}, "details")},
	{Name: "check", Description: "Checks a table as scoring would, without scoring: its variant names against the design's target, its problems, the design against its columns, and the parameters against the design. Returns valid (nothing blocks scoring), what blocks it, and the warnings. mavescape validate and mavescape run use it.", InputSchema: schema(map[string]any{
		"table":      textArg("The table by name; the one the design describes, or the first, if not given."),
		"design":     map[string]any{"type": "object", "description": "A design to check against the table (a mavescape-design document); the workspace's own if not given."},
		"preset":     textArg("The preset whose parameters are checked: mavescape (the default), enrich2, dimsum or vampseq."),
		"parameters": map[string]any{"type": "object", "description": "Parameters to change from the preset, checked against the design (as for score)."},
	}), long: true},
	{Name: "reproduce_run", Description: "Recomputes a saved run's scores from its recorded inputs (its table, design and parameters) and checks them against its recorded output hash: refused, saying why, when they differ. mavescape run --from-workspace uses it.", InputSchema: schema(map[string]any{
		"run": runArg,
	}), long: true},
	{Name: "score", Description: "Scores the counts with the current design: functional scores with standard errors, a new immutable run (or the existing one, when a run already has the same table, design and parameters). Shows it in the Score view.", InputSchema: schema(map[string]any{
		"preset":     textArg("mavescape (the default), enrich2 (Enrich2 2.0.2's ratios, for comparison) or dimsum (DiMSum's fitness and error model, for an input and an output; the run's fitted terms are returned)."),
		"parameters": map[string]any{"type": "object", "description": "Parameters to change from the preset: model (ratio, wls, ols: a time series starts from wls; dimsum), regressionSE (counting-floor, residual), normalization (wt, complete, full, synonymous), combination (reml, fixed, enrich2), rescale, pseudocount, dimsumNormalise, dimsumErrorModel, dimsumDropout, differential (with two or more conditions: limma, paired, independent or null), filters {minInputCount, minTimePoints, …}."},
	}), long: true},
	{Name: "qc_findings", Description: "Quality control of a score run (or of the counts alone, before scoring): each finding's status (pass, review, fail or not assessed), what was found, its threshold and why it matters, and the overall status. Shows them in the QC view.", InputSchema: schema(map[string]any{
		"run":     textArg("A score run by name or id, or \"counts\" for the counts with the current design; the latest run of the current design if not given."),
		"finding": textArg("A finding to show in full in the QC view, by id or title."),
	}), long: true},
	{Name: "acknowledge_finding", Description: "Acknowledges a quality-control finding that is to review or failing, with the reason it is expected (\"the library was made by error-prone PCR\"); an empty reason withdraws it. The finding keeps its status; the reason goes into the history, the methods and the QC exports, and holds while the finding is no worse. A blocking finding cannot be acknowledged.", InputSchema: schema(map[string]any{
		"finding": textArg("The finding, by id (coverage, separation…) or title."),
		"reason":  textArg("Why the finding is expected here; empty to withdraw the acknowledgement."),
		"run":     textArg("A score run by name or id, or \"counts\"; the latest run of the current design if not given."),
	}, "finding"), long: true},
	{Name: "select_variants", Description: "Selects variants on the map: by a query (such as \"missense at 40-80 with se < 0.2\", \"lower and not robust\", \"from C in feature disulfide\", \"in Core and not in Surface\"), by name or by position; replaces the selection or adds to, intersects or subtracts from it; optionally saves it by name (with its query). A query that needs the run's robustness checks it first. Shows the Map view with the selection.", InputSchema: schema(map[string]any{
		"query":     textArg("A query of MaveScape's selection language: kinds (missense, nonsense, synonymous), states (scored, low, filtered, missing), at/pos/refpos with positions, from/to with residues or groups, score/se/q/replicates/input compared with a number, lower/higher/neutral, robustness verdicts (robust, fragile, uncertain, borderline, size-dependent, sometimes-scored, \"class depends on the pseudocount\"), feature with a name, in with a saved selection's name, selected, and, or, not, parentheses."),
		"variants":  map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "MAVE-HGVS names, such as p.Trp36Ala."},
		"positions": map[string]any{"type": "array", "items": map[string]any{"type": "integer"}, "description": "Positions on the target (numbered from 1): every substitution there."},
		"filter":    textArg("Only these of them: scored, low (low confidence), filtered or missing."),
		"operation": textArg("What to do with the selection there is: replace (the default), add, intersect or subtract."),
		"save_as":   textArg("Save the selection under this name."),
		"run":       runArg,
		"condition": conditionArg,
		"contrast":  textArg("A contrast between conditions (its name, or its number from 1): select on its differential map."),
	})},
	{Name: "inspect_variant", Description: "A variant's evidence: its score with SE and 95% interval (or why it has none), flags, each replicate's counts and score, every sample's counts, and with conditions compared each difference with its SE, interval and adjusted p. Shows it in the inspector.", InputSchema: schema(map[string]any{
		"variant":   textArg("Its MAVE-HGVS name, such as p.Trp36Ala."),
		"run":       runArg,
		"condition": conditionArg,
	}, "variant")},
	{Name: "render_map", Description: "Shows a run's variant-effect map with the given settings and returns the map described in words, with the number of cells in each state.", InputSchema: schema(map[string]any{
		"run":       runArg,
		"condition": conditionArg,
		"color_by":  textArg("score, se, replicates or input; differential for a run that compares conditions."),
		"contrast":  textArg("With conditions compared: the contrast to color by, by name (such as \"With ligand vs Without ligand\"); implies color_by differential."),
		"rows":      textArg("The order of the substitutions: biochemical, hydrophobicity or alphabetical."),
		"palette":   textArg("rdbu (blue loss, red gain) or puor (purple loss, orange gain)."),
		"zoom":      map[string]any{"type": "number", "description": "Zoom factor from the fitted map (above 1 zooms in)."},
	})},
	{Name: "compare", Description: "Compares two sets of scores, as the Compare view does: each side a run's condition (its combined scores) or one of its replicates, of one run or two (a rescoring, or a MaveDB record's published scores against its counts scored again), or a MaveDB score set or a predictor kept beside the workspace (a score set named by its URN is fetched and kept first, without opening it; a predictor is AlphaMissense or a predictor's file added with add_track). Returns the compatibility report first (targets and coordinates, the level, the variants matched and those on one side only, the directions and scales, whether the two are independent; each item ok, qualified or blocked), then the agreement of the variants compared: Pearson's r and Spearman's rho, Lin's concordance and Bland–Altman's bias and limits of agreement (the last two only on one scale), each with its 95% interval; for two independent sides on one scale, the variants that differ beyond their uncertainty (each difference's z from both SEs, q by Benjamini–Hochberg) and the disagreement by position; a predictor by rank (Spearman's rho) and by its classes (the measured scores in each class, and the AUC of telling its benign from its pathogenic substitutions, with DeLong's interval). The scale: as scored, stated to be one, or each side rescaled by its own anchors (nonsense median 0 and wild type 1, or synonymous median 0 and nonsense median -1). Filters leave out variants of low confidence, large SE or few reads. Shows the Compare view; export with what comparison writes the variants compared or (a .json path) the report and statistics, comparison-positions the disagreement by position, comparison-map a map (SVG), comparison-classes a predictor by class.", InputSchema: schema(map[string]any{
		"a":              textArg("The first side, by name: \"Run 1\", \"Run 1: Replicate 2\", \"Run 1: +Lon\", \"Published scores\", a score set or predictor kept beside the workspace (\"AlphaMissense: P62993\"), or a MaveDB score set's URN (fetched and kept when it is not yet). The pair shown, or a default (a run against the published scores, two replicates, two conditions, the last two runs), if not given."),
		"b":              textArg("The second side, by name or URN."),
		"scale":          textArg("The scale they are compared on: scored (as scored, the default), stated (stated to be one scale), nonsense-wt (each rescaled so its nonsense median is 0 and its wild type 1) or synonymous-nonsense (its synonymous median 0 and nonsense median -1). Kept for the comparisons that follow."),
		"direction":      textArg("What a higher score of the MaveDB score set compared means (MaveDB records none): higher-more, higher-less, unsigned, or not stated."),
		"low_confidence": flagArg("Leave out the variants of low confidence on either side (true); those given replace the comparison's filters, none given keeps them."),
		"max_se":         map[string]any{"type": "number", "minimum": 0, "description": "Leave out the variants whose SE on either side is above this."},
		"min_reads":      map[string]any{"type": "number", "minimum": 0, "description": "Leave out the variants with fewer input reads than this on either side."},
		"show":           textArg("The tab shown: agreement (the scatter plot and statistics), maps (the two maps and their difference), disagreement (the discordant variants and the positions) or classes (a predictor's classes)."),
	}), long: true},
	{Name: "check_robustness", Description: "Checks a run's robustness to other reasonable analysis choices, as the Score view's Robustness pane does: the run scored again with each alternative alone (pseudocount; normalization; the model of uncertainty, DiMSum's error model or a regression's; the combination of replicates; the minimum input count, replicates and time points; each replicate left out), then seeded combinations of them. For each variant (and each difference between conditions) its class (lower than, like or higher than the wild type, q < 0.05), effect, rank, SE and inclusion in every analysis, and its verdict: robust, fragile (a choice moves its effect beyond its 95% interval and changes its class, the choice named), depends on its uncertainty, borderline, its effect's size depends on a choice, or not always scored; each alternative's effect; the least tolerant positions. Export with what robustness (the variants, CSV; or its record, a .json path) or robustness-positions.", InputSchema: schema(map[string]any{
		"run": runArg,
		"max": map[string]any{"type": "integer", "minimum": 2, "maximum": 256, "description": "How many analyses in all (48 by default): the declared, each alternative alone, then seeded combinations."},
	}), long: true},
	{Name: "list_tracks", Description: "The sequence tracks beside a run's map, in order: the run's own (reference, coverage, position effect, uncertainty) and the workspace's annotations' (UniProt features, conservation, AlphaMissense, ClinVar, gnomAD, MaveDB's annotations, an alignment, a predictor, a custom track), each with its source (service, release, retrieval date), whether it is shown, its filter and the filters it offers, and what it holds; the annotations that could not be read; and what can be added.", InputSchema: schema(map[string]any{
		"run":       runArg,
		"condition": conditionArg,
	}), long: true},
	{Name: "add_track", Description: "Adds an annotation's tracks beside the map. From public data, through MaveScape's list of services (docs/NETWORK.md; from the cache only with --offline; only an accession, gene symbol or URN is sent): provider uniprot-features, pdbe-conservation, alphamissense, clinvar, gnomad or mavedb-annotations, for the run's target; or mavedb-scores with a urn, a MaveDB score set kept beside the workspace without opening it (its record and published scores; compared in Compare, its scores a track). Or from a file, given as name and text: an alignment (A3M, FASTA, Stockholm, Clustal), a predictor's table (AlphaMissense, EVE, ESM1b, or variants with scores) or a custom track (GFF3, or a table with position, or start and end). The annotation is kept with the workspace (and its archive); in the history.", InputSchema: schema(map[string]any{
		"provider":  textArg("The public source: uniprot-features, pdbe-conservation, alphamissense, clinvar, gnomad, mavedb-annotations or mavedb-scores (with urn)."),
		"urn":       textArg("mavedb-scores: the score set's URN (urn:mavedb:00000054-a-1)."),
		"direction": textArg("mavedb-scores: what a higher score means (MaveDB records none): higher-more, higher-less or unsigned."),
		"name":      textArg("A file's name (grb2-sh3.sto), with its text."),
		"text":      textArg("A file's text: an alignment, a predictor's table or a custom track."),
		"run":       runArg,
	}), long: true},
	{Name: "set_track", Description: "Shows or hides a track, moves it, or filters it: features by kind (types), variants by class (classes) or ClinVar's review status (stars, 0-4), gnomAD's frequency (min). The arrangement is kept with the workspace; it is a view, not in the history.", InputSchema: schema(map[string]any{
		"track":    textArg("The track by id or label (list_tracks)."),
		"shown":    flagArg("Show it (true) or hide it (false)."),
		"position": map[string]any{"type": "integer", "minimum": 1, "description": "Its place among the tracks, from 1 (the top)."},
		"filter":   map[string]any{"type": "object", "description": "{types: [...]}, {classes: [...], stars: n} or {min: x}, as the track offers (list_tracks); {} removes its filter."},
		"run":      runArg,
	}, "track")},
	{Name: "remove_track", Description: "Removes an annotation and its tracks (undoable, in the history).", InputSchema: schema(map[string]any{
		"annotation": textArg("The annotation by id or name (list_tracks)."),
	}, "annotation")},
	{Name: "open_structure", Description: "Opens a structure in the Structure view: a PDB entry by its ID, or the AlphaFold DB model of a UniProt accession (\"target\": the target's), fetched through the program (cached, then available offline). A file of your own opens with open_files. Returns the structure in words: its chains, the residues observed, its assemblies and what else it holds.", InputSchema: schema(map[string]any{
		"pdb":       textArg("A PDB ID, such as 2VWF."),
		"alphafold": textArg("A UniProt accession, such as P62993, for its AlphaFold DB model; \"target\" for the target's."),
		"assembly":  textArg("A biological assembly by its id (\"1\"), or \"asym\" for the asymmetric unit; the coordinates as deposited if not given."),
	}), long: true},
	{Name: "set_structure", Description: "Draws the structure shown another way (style, color, surface, assembly) and selects residues in Proteoscope's selection language, draws them in a style of their own, labels them and focuses on their neighborhood. Returns the structure's state: what is selected, labeled and focused on, and the renderer (WebGPU, or the Canvas renderer, which draws no surfaces).", InputSchema: schema(map[string]any{
		"style":    textArg("cartoon, ball-stick, sticks, spacefill or trace."),
		"color":    textArg("chain, entity, rainbow, secondary, moltype, element, residue, hydrophobicity, nucleotide, bfactor, plddt (a predicted model) or uniform."),
		"surface":  textArg("off, ses (molecular), sas (solvent-accessible), vdw or gaussian; WebGPU only."),
		"assembly": textArg("A biological assembly by its id (\"1\"), or \"asym\" for the asymmetric unit; clears the selection."),
		"select":   textArg("Residues to select: \"resn CYS\", \"chain A and resi 40-80\", \"within 5 of ligand\", \"helix and chain B\"; empty to clear the selection."),
		"show":     textArg("How the selected residues are drawn: sticks, ball-stick, spacefill, hide or none (as the rest)."),
		"label":    flagArg("Label the selected residues (false: remove their labels)."),
		"focus":    flagArg("Focus on the selected residues and their neighbors within 5 Å, side chains drawn (false: the whole structure again)."),
		"fit":      flagArg("Fit the whole structure in the view."),
	}), long: true},
	{Name: "export", Description: "Writes a file: a run's scores or counts (MaveDB columns), differential scores, QC per sample or per variant, provenance, the methods or their references, the map (SVG, with the tracks shown), the tracks shown (CSV, position by position), the selection, the whole workspace as an archive (.msz), the analysis package (.zip: counts, target, design, sample sheet, parameters and what is missing), a run's MaveDB deposit (.zip: the scores, counts, column descriptions, experiment and score set as MaveDB takes them), the comparison shown (its matched variants, CSV; its report and statistics, JSON; its positions, maps or a predictor's classes), or a run's robustness to analysis choices. Needs the token.", InputSchema: schema(map[string]any{
		"what":           textArg("scores, counts, differential, qc-samples, qc-variants, qc-findings, barcodes (a table of barcodes), provenance, methods, references, map, tracks, selection, archive, package, mavedb comparison (the variants of the comparison shown, or its report and statistics to a .json path), comparison-positions (its disagreement by position), comparison-map (a map of it, SVG: map first, second or difference) or comparison-classes (a predictor's classes: the measured scores in each), robustness (a run's robustness to analysis choices: its variants, CSV, or its record, a .json path) or robustness-positions."),
		"path":           textArg("The absolute path of the file to write."),
		"overwrite":      flagArg("Replace the file if it exists."),
		"run":            runArg,
		"condition":      conditionArg,
		"include_tables": flagArg("archive: include the count tables (the default), or name each by its SHA-256 only."),
		"selection":      textArg("selection: a saved selection by name; the current selection if not given."),
		"map":            textArg("comparison-map: first, second or difference (the default)."),
	}, "what", "path"), long: true, output: true},
}

func findAction(name string) (remoteAction, bool) {
	for _, action := range remoteActions {
		if action.Name == name {
			return action, true
		}
	}
	return remoteAction{}, false
}

// actionNames lists the actions, for error messages.
func actionNames() []string {
	names := make([]string, len(remoteActions))
	for i, action := range remoteActions {
		names[i] = action.Name
	}
	return names
}
