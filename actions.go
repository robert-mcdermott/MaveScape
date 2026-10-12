package main

// The remote-control actions (remote.go): what a program on this computer can ask the open
// MaveScape page to do. The page performs them (web/ui/remote.js, whose action table must name
// exactly these; TestEveryActionHasAPageHandler checks it). GET /api/remote/tools lists them with
// their arguments, and the MCP server (roadmap wave 7) will offer the same list to agents.

import "encoding/json"

type remoteAction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	// long: may run for minutes (scoring a large table, QC, an archive with its tables).
	long bool
	// output: writes a file at args.path (output.go), so it needs the token.
	output bool
	// reads: reads files at args.paths (local.go), so it needs the token. optionalPaths: the
	// paths may be left out (diff: between checkpoints, or two archives), and then nothing is read.
	reads         bool
	optionalPaths bool
}

// readsFiles: whether a call of the action reads files (and so needs the token): one that reads,
// unless its paths are optional and none are given.
func (a remoteAction) readsFiles(args json.RawMessage) bool {
	if !a.reads {
		return false
	}
	if !a.optionalPaths {
		return true
	}
	var params struct {
		Paths []string `json:"paths"`
	}
	return json.Unmarshal(args, &params) == nil && len(params.Paths) > 0
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
	{Name: "set_mode", Description: "Shows a view: start, experiment, qc, score, map, compare, structure, figures or report.", InputSchema: schema(map[string]any{
		"mode": textArg("start, experiment, qc, score, map, compare, structure, figures or report."),
	}, "mode")},
	{Name: "focus", Description: "Shows an item in the inspector: a table, target, score run, saved selection, saved structure view or variant, by name. With no name, clears the focus.", InputSchema: schema(map[string]any{
		"kind": textArg("table, target, run, selection, structure view or variant; found by name across all of them if not given."),
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
		"report":         flagArg("Keep the comparison in the workspace's report (true): its sides, scale, filters and statistics, in the history; the report says it."),
	}), long: true},
	{Name: "check_robustness", Description: "Checks a run's robustness to other reasonable analysis choices, as the Score view's Robustness pane does: the run scored again with each alternative alone (pseudocount; normalization; the model of uncertainty, DiMSum's error model or a regression's; the combination of replicates; the minimum input count, replicates and time points; each replicate left out), then seeded combinations of them. For each variant (and each difference between conditions) its class (lower than, like or higher than the wild type, q < 0.05), effect, rank, SE and inclusion in every analysis, and its verdict: robust, fragile (a choice moves its effect beyond its 95% interval and changes its class, the choice named), depends on its uncertainty, borderline, its effect's size depends on a choice, or not always scored; each alternative's effect; the least tolerant positions. Export with what robustness (the variants, CSV; or its record, a .json path) or robustness-positions.", InputSchema: schema(map[string]any{
		"run":    runArg,
		"max":    map[string]any{"type": "integer", "minimum": 2, "maximum": 256, "description": "How many analyses in all (48 by default): the declared, each alternative alone, then seeded combinations."},
		"report": flagArg("Keep the check in the workspace's report (true): the choices varied and what each target's verdicts were, in the history; the report says it."),
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
		"chain":     textArg("The chain to map the workspace's target on; the chain that holds the most of it if not given."),
	}), long: true},
	{Name: "find_structures", Description: "The PDB entries that cover the workspace's target (its UniProt accession), from PDBe's SIFTS through the program: ranked by the target positions each covers, then resolution, each with its method, chains and positions; and that its AlphaFold DB model covers it all.", InputSchema: schema(map[string]any{}), long: true},
	{Name: "map_structure", Description: "Maps the workspace's target onto the structure shown: the target aligned to each chain (BLOSUM62, free end gaps), and on the chain chosen each position on a residue (identical or another), in the structure's sequence but not observed, missing from it, or outside it; ambiguous positions; the entry's own record of the UniProt residues compared. Returns the mapping in words and by position.", InputSchema: schema(map[string]any{
		"chain": textArg("The chain to map the target on; the one that holds the most of it if not given."),
	})},
	{Name: "set_structure", Description: "Draws the structure shown another way (style, color, surface, assembly), colors its residues by their target positions' scores (the run and condition the map shows, in the map's colors: filtered and missing positions gray, never the wild type's color), and selects residues in Proteoscope's selection language, draws them in a style of their own, labels them and focuses on their neighborhood; or picks a residue as a click does (its substitutions selected on the map, its position in the inspector). Returns the structure's state: what is selected, labeled and focused on, the scores colored by, and the renderer (WebGPU, or the Canvas renderer, which draws no surfaces).", InputSchema: schema(map[string]any{
		"style":        textArg("cartoon, ball-stick, sticks, spacefill or trace."),
		"color":        textArg("By the scores: median, mean, minimum, maximum, fraction (abnormal-like, with threshold or calibration), count (substitutions scored), substitution (with substitution), uncertainty (median SE), disagreement (the comparison Compare shows) or qc. Or the structure's own: class (each position's structural class: buried, exposed, interface, disordered), chain, entity, rainbow, secondary, moltype, element, residue, hydrophobicity, nucleotide, bfactor, plddt (a predicted model) or uniform."),
		"substitution": textArg("color substitution: the amino acid each residue's substitution to is shown (A or Ala; * or Ter for a stop)."),
		"threshold":    map[string]any{"type": "number", "description": "color fraction: the score beyond which a substitution is abnormal-like (research use)."},
		"side":         textArg("color fraction: below or above the threshold is abnormal-like (the readout's loss side if not given)."),
		"calibration":  textArg("color fraction: a published calibration of the record whose scores the run is, by title or number (from 1), instead of a threshold."),
		"pick":         textArg("A residue picked as a click picks it: \"A 183\" (chain and number, with an insertion code if any); its position's substitutions selected on the map, the position in the inspector."),
		"add":          flagArg("pick: add the residue to the selection (or take it away), as a ⌘-click does."),
		"surface":      textArg("off, ses (molecular), sas (solvent-accessible), vdw or gaussian; WebGPU only."),
		"assembly":     textArg("A biological assembly by its id (\"1\"), or \"asym\" for the asymmetric unit; clears the selection."),
		"select":       textArg("Residues to select: \"resn CYS\", \"chain A and resi 40-80\", \"within 5 of ligand\", \"helix and chain B\", \"pos 30-40\" (target positions, on the chain mapped), \"uniprot 188-198\" (the reference's); empty to clear the selection."),
		"show":         textArg("How the selected residues are drawn: sticks, ball-stick, spacefill, hide or none (as the rest)."),
		"label":        flagArg("Label the selected residues (false: remove their labels)."),
		"focus":        flagArg("Focus on the selected residues and their neighbors within 5 Å, side chains drawn (false: the whole structure again)."),
		"fit":          flagArg("Fit the whole structure in the view."),
	}), long: true},
	{Name: "structure_evidence", Description: "What the structure shown says of the target's positions: each one's structural class (buried, exposed, interface with the partners chosen, or a predicted model's disordered region), from DSSP's secondary structure, the solvent accessibility (DSSP's radii), StructureMap's exposure and the partners within 4 Å; the median scores of each class against the rest (Mann–Whitney, BH-adjusted); and whether the least tolerant positions lie closer together than positions of the same burial (pairs within 8 Å against seeded draws within strata of relative accessibility). The same are tracks beside the map (list_tracks).", InputSchema: schema(map[string]any{
		"partner":  textArg("The partner the interface is read with: \"all\" (every other chain, ligand and ion but common additives, the default), or one by its id or label (\"chain:B\", \"ligand:A:1352:TLA\")."),
		"fraction": map[string]any{"type": "number", "minimum": 0.05, "maximum": 0.5, "description": "The share of positions called least tolerant for the cluster test (0.2 if not given)."},
		"seed":     map[string]any{"type": "integer", "minimum": 1, "description": "The seed of the cluster test's draws (1 if not given)."},
	}), long: true},
	{Name: "save_structure_view", Description: "Saves the view of the structure shown with the workspace, under a name (one already used is saved again): the structure's file kept in the library by its SHA-256 (and a model's aligned error), the assembly, the chain and the mapping, the camera, style, colors and the run and condition they are of, the surface, the residues selected, drawn, labeled and focused on, and the evidence's settings. It reopens as it was, goes into the workspace's archive and is described in its methods.", InputSchema: schema(map[string]any{
		"name": textArg("The view's name."),
	}, "name"), long: true},
	{Name: "open_structure_view", Description: "Opens a saved view as it was saved: its structure from the library (or fetched again by its ID, its SHA-256 checked), and everything the view records. Says whether the mapping is the one the view was saved with.", InputSchema: schema(map[string]any{
		"name": textArg("The saved view's name."),
	}, "name"), long: true},
	{Name: "remove_structure_view", Description: "Removes a saved view, and its structure when no other view shows it (undoable, in the history).", InputSchema: schema(map[string]any{
		"name": textArg("The saved view's name."),
	}, "name")},
	{Name: "figures", Description: "The workspace's figures: each one's name, page (millimeters, and the text size in points), its panels lettered in reading order with what each shows, where it is (millimeters) and anything wrong with it (text under 6 pt, a map too narrow for its positions, a run no longer there), and the figure described in words.", InputSchema: schema(map[string]any{
		"figure": textArg("A figure by name or id: only that one."),
	})},
	{Name: "create_figure", Description: "Makes a figure: an empty page at a journal's column width or a slide, shown in the Figures view. Add panels with add_figure_panel.", InputSchema: schema(map[string]any{
		"name":      textArg("Its name (\"Figure 2\"); Figure n if not given."),
		"size":      textArg("single (85 mm wide), onehalf (114 mm), double (174 mm, the default) or slide (16:9)."),
		"width_mm":  map[string]any{"type": "number", "minimum": 25, "maximum": 700, "description": "The page's width in millimeters, instead of the size's."},
		"height_mm": map[string]any{"type": "number", "minimum": 25, "maximum": 700, "description": "The page's height in millimeters, instead of the size's."},
		"text":      map[string]any{"type": "number", "minimum": 4, "maximum": 36, "description": "The text size in points at the printed size (7, or 14 on a slide)."},
	})},
	{Name: "add_figure_panel", Description: "Adds a panel to a figure (or to a new one), drawn as its view draws it: a run's variant-effect map (a condition or a difference between conditions, colored as render_map colors it, a range of positions, tracks below it, its color bar and the key to its states); a QC finding's charts (of a run, or of the counts); a run's scores by class, filter flow or a contrast's volcano; a comparison (as compare takes its sides: agreement, Bland–Altman, disagreement by position, a predictor's classes, or a map of either side or of the difference); a variant's evidence (its score and each replicate's with their intervals, its time course, or its distribution over the bins); a saved structure view (its figure panel, drawn at 4x on white and kept with the figure); or text. Placed below the panels already there unless placed; shown in the Figures view. Returns the panel's id and letter, and what it shows.", InputSchema: schema(map[string]any{
		"figure":    textArg("The figure, by name or id; a new figure if not given."),
		"kind":      textArg("map (the default), qc, scores, compare, variant, structure or text."),
		"plot":      textArg("What a scores panel shows (distribution, flow, volcano), a compare panel (agreement, bland-altman, positions, classes, map-first, map-second, map-difference) or a variant panel (evidence, time-course, bins)."),
		"subject":   textArg("qc: the run whose QC (by name), or counts; the latest run if not given."),
		"finding":   textArg("qc: the finding, by id (qc_findings lists them) or title."),
		"pair":      map[string]any{"type": "integer", "minimum": 1, "description": "qc, replicate agreement: the pair of replicates drawn, from 1."},
		"a":         textArg("compare: the first side, as compare takes it; the pair compared last if not given."),
		"b":         textArg("compare: the second side."),
		"scale":     textArg("compare: the scale, as compare takes it."),
		"variant":   textArg("variant: its MAVE-HGVS name, such as p.Trp36Ala."),
		"view":      textArg("structure: the saved view, by name; the last saved if not given."),
		"run":       runArg,
		"condition": conditionArg,
		"contrast":  textArg("With conditions compared: the difference to draw, by name (such as \"With ligand vs Without ligand\")."),
		"color_by":  textArg("score (the default), se, replicates or input."),
		"rows":      textArg("The order of the substitutions: biochemical, hydrophobicity or alphabetical."),
		"palette":   textArg("rdbu or puor."),
		"from":      map[string]any{"type": "integer", "minimum": 1, "description": "The first position shown (the target's numbering)."},
		"to":        map[string]any{"type": "integer", "minimum": 1, "description": "The last position shown."},
		"tracks":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "The tracks below the map, by id (list_tracks gives them); \"shown\" alone for those shown beside the map; none if not given."},
		"text":      textArg("text: the panel's text."),
		"x_mm":      map[string]any{"type": "number", "minimum": 0, "description": "Where the panel's left edge is, in millimeters from the page's."},
		"y_mm":      map[string]any{"type": "number", "minimum": 0, "description": "Where its top is."},
		"width_mm":  map[string]any{"type": "number", "minimum": 4, "description": "Its width (the page's, less its margins, if not given)."},
		"height_mm": map[string]any{"type": "number", "minimum": 4, "description": "Its height."},
	})},
	{Name: "set_figure", Description: "Changes a figure: its name, page size, text size and lettering, and its panels (moved, resized, their options changed, removed), each change undoable. Returns the figure as figures does.", InputSchema: schema(map[string]any{
		"figure":    textArg("The figure, by name or id."),
		"name":      textArg("A new name."),
		"size":      textArg("single, onehalf, double or slide: the page's size (panels kept on it)."),
		"width_mm":  map[string]any{"type": "number", "minimum": 25, "maximum": 700},
		"height_mm": map[string]any{"type": "number", "minimum": 25, "maximum": 700},
		"text":      map[string]any{"type": "number", "minimum": 4, "maximum": 36, "description": "The text size in points."},
		"letters":   flagArg("Letter the panels A, B, C… in reading order."),
		"panels":    map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "Changes to panels: each { panel (its id or letter), and any of x_mm, y_mm, width_mm, height_mm; a map's from, to, condition, contrast, color_by, rows, palette, tracks, medians, legend; a plot's plot and pair; any panel's title and letter; a text's text, size, bold, align; or remove: true }."},
		"delete":    flagArg("Delete the figure."),
	}, "figure")},
	{Name: "export_figure", Description: "Writes a figure: SVG (vector, its text as text and its description in <desc>), PDF (vector, one page at its printed size, text in Helvetica) or PNG at a resolution of its printed size (300 dpi if not given, its resolution recorded in the file), each carrying its manifest (what each panel shows and was drawn from: each run by its output's SHA-256, the QC thresholds, the sides of a comparison, the tracks' files, a structure view's image; a digest of each panel's drawing; MaveScape's version and commit; a fingerprint), or the manifest alone (json). The same figure is the same bytes (with a fixed time, as mavescape run fixes it). Needs the token.", InputSchema: schema(map[string]any{
		"figure":    textArg("The figure, by name or id."),
		"format":    textArg("svg, pdf, png or json (the manifest); from the path's extension if not given."),
		"dpi":       map[string]any{"type": "number", "minimum": 72, "maximum": 1200, "description": "png: dots per inch of the printed size."},
		"path":      textArg("The absolute path of the file to write."),
		"overwrite": flagArg("Replace the file if it exists."),
	}, "figure", "path"), long: true, output: true},
	{Name: "check_figure", Description: "Reads a figure MaveScape exported (SVG, PDF, PNG, or its manifest as JSON): what it shows and where it came from (the workspace, MaveScape's version, when), whether its manifest is as it was written (its fingerprint), and panel by panel what changed in the workspace open since (a run not here, a table scored again since, the QC thresholds or an acknowledgement changed, an annotation's file changed, a structure view saved again). With rebuild, adds the figure to the workspace, its panels drawn again from their inputs and each drawing compared with the one the file records. Needs the token.", InputSchema: schema(map[string]any{
		"paths":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "The figure's file: one absolute path."},
		"rebuild": flagArg("Rebuild the figure in the workspace and say, panel by panel, whether it is drawn the same."),
	}, "paths"), long: true, reads: true},
	{Name: "checkpoint", Description: "Keeps a checkpoint: the analysis as it stands (the targets, design, runs, QC thresholds and acknowledgements, selections, annotations, structure views, figures and what the report keeps), named, with the history's hash at that moment, in the workspace and its archive; or deletes one. Lists the checkpoints kept. Compare with diff.", InputSchema: schema(map[string]any{
		"name":   textArg("The checkpoint's name (\"Before the rescoring\"): keeps one of the analysis as it stands."),
		"remove": textArg("A checkpoint, by name or id, to delete."),
	})},
	{Name: "diff", Description: "What changed between two states of the analysis, in words: from a checkpoint (the latest if not given) to now or another checkpoint, or between two workspace archives (paths, the earlier first). The tables, targets, design, runs scored and removed, QC thresholds and acknowledgements, selections, annotations, structure views, figures, the report's analyses and MaveDB details; and for each table's latest run, how its analysis changed (parameters, filters, design) and what that did: for each condition, the variants whose effect moved beyond their earlier 95% interval, changed class (lower than, like or higher than the wild type, q < 0.05) or were newly filtered or scored, the most moved by name, and the QC findings whose verdict changed. Shows the changes in the Report view, with a map of the change.", InputSchema: schema(map[string]any{
		"from":  textArg("The checkpoint compared from, by name or id; the latest if not given."),
		"to":    textArg("now (the default), or another checkpoint by name or id."),
		"paths": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Two workspace archives (.msz), absolute paths, the earlier first: compared instead of checkpoints."},
		"show":  flagArg("Show the changes in the Report view (the default); false leaves the view shown."),
	}), long: true, reads: true, optionalPaths: true},
	{Name: "certify", Description: "Writes a reproducibility certificate of the workspace (.msz): the workspace archive with every number it reports computed again from its files (each run's scores, SEs and classes and its output's SHA-256; its QC findings and the SHA-256 of its whole QC; the comparisons and robustness checks kept in the report; each figure panel's drawing by its SHA-256; the report), the files by their SHA-256, the history's head, the checkpoints, what is not computed again, and a fingerprint (the SHA-256 of what was certified, to quote with the analysis). mavescape verify (or verify_certificate) computes every number again and compares them bit for bit. Needs the token.", InputSchema: schema(map[string]any{
		"path":      textArg("The absolute path of the certificate to write (.msz)."),
		"tables":    flagArg("Include the count tables (the default); false names each by its SHA-256 only, for data that cannot be shared (verifying then needs them beside it)."),
		"overwrite": flagArg("Replace the file if it exists."),
	}, "path"), long: true, output: true},
	{Name: "review_report", Description: "Writes the review report of the workspace (.html): one self-contained file a reviewer opens in any browser, without MaveScape (the experiment and design, the inputs with their SHA-256, each run's parameters, classes and maps, the QC findings with their plots, the comparisons and robustness checks kept in the report, the selections, structure views and figures, the methods and the decision log), every number traced to where it comes from with its key and exact value: the numbers of the certificate certify writes, whose fingerprint it names. It loads nothing. Needs the token.", InputSchema: schema(map[string]any{
		"path":      textArg("The absolute path of the report to write (.html)."),
		"tables":    flagArg("The report of the certificate with the count tables (the default); false, of the one naming them by their SHA-256 only."),
		"overwrite": flagArg("Replace the file if it exists."),
	}, "path"), long: true, output: true},
	{Name: "verify_certificate", Description: "Verifies a reproducibility certificate: checks its fingerprint, the workspace and every file against their SHA-256 and the history's chain, computes every number again from the files with this MaveScape's code and compares them bit for bit. Verdict verified, differs (each difference listed) or incomplete (a file it names is missing: give it in paths; the library's are found by their SHA-256). Shows the result in the Report view. Needs the token.", InputSchema: schema(map[string]any{
		"paths":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Absolute paths: the certificate (.msz), and after it the files it names but does not hold (each, or a folder of them), found by their SHA-256."},
		"library": flagArg("Look for the files it names in this MaveScape's library too (the default); false uses only the certificate's and those given, as someone without this library would."),
		"review":  flagArg("Also return the review report of the certificate verified (its HTML, as review), the same file its maker writes."),
		"show":    flagArg("Show the result in the Report view (the default); false leaves the view shown."),
	}, "paths"), long: true, reads: true},
	{Name: "report", Description: "The workspace's report, shown in the Report view: its methods written from the record (each run's data, design, scoring with a table of its parameters, and QC; the comparisons and robustness checks kept in it; selections, annotations, structures, figures; every input's SHA-256; the software; the decision log; the limitations; the research-use statement), with numbered references: each section, the Markdown and the BibTeX, and the analyses kept in it. Written again on every change: the same workspace gives the same text.", InputSchema: schema(map[string]any{
		"remove": textArg("An analysis kept in the report, by id or by its words (\"the comparison of Run 1 and Run 2\"), taken out first."),
		"show":   flagArg("Show the Report view (the default); false leaves the view shown."),
	}), long: true},
	{Name: "proteoscope_link", Description: "Hands the structure shown to a Proteoscope running on this computer (found on its ports, 8765-8814, or those --proteoscope names), in what it accepts: for a PDB entry or AlphaFold DB model and a Proteoscope MaveScape was tested with (0.10), the link that opens it there with the scores as its custom residue data, the residues drawn, hidden, selected, labeled and focused on, and the camera (open the link in a browser); for another version, a link to the structure alone; for a file of the person's, the session to open there as a file (export proteoscope-session writes it). Refused, saying why, when Proteoscope is not running.", InputSchema: schema(map[string]any{})},
	{Name: "export", Description: "Writes a file: a run's scores or counts (MaveDB columns), differential scores, QC per sample or per variant, provenance, the methods or their references, the map (SVG, with the tracks shown), the tracks shown (CSV, position by position), the selection, the whole workspace as an archive (.msz), the analysis package (.zip: counts, target, design, sample sheet, parameters and what is missing), a run's MaveDB deposit (.zip: the scores, counts, column descriptions, experiment and score set as MaveDB takes them), the comparison shown (its matched variants, CSV; its report and statistics, JSON; its positions, maps or a predictor's classes), a run's robustness to analysis choices, or the workspace's report (Markdown, its references BibTeX). Needs the token.", InputSchema: schema(map[string]any{
		"what":               textArg("scores, counts, differential, qc-samples, qc-variants, qc-findings, barcodes (a table of barcodes), provenance, methods, references, map, tracks, selection, archive, package, mavedb, comparison (the variants of the comparison shown, or its report and statistics to a .json path), comparison-positions (its disagreement by position), comparison-map (a map of it, SVG: map first, second or difference) or comparison-classes (a predictor's classes: the measured scores in each), robustness (a run's robustness to analysis choices: its variants, CSV, or its record, a .json path) or robustness-positions, structure-mapping (the target on the structure shown, position by position, CSV), structure-scores (the scores the structure is colored by, position by position, with each residue's color, CSV), structure-evidence (what the structure says of each position: secondary structure, accessibility, exposure, partner, class, with its median score, CSV) structure-image (a figure panel of the view shown: PNG, its legend below it, what it shows written into it), proteoscope-session (the view shown as a Proteoscope session, .proteoscope.json: the structure, by its ID or embedded, its scores as residue data, the residues drawn, selected and labeled, the camera; Proteoscope need not be running), report (the workspace's report: its methods from the record, Markdown) or report-references (its references, BibTeX)."),
		"path":               textArg("The absolute path of the file to write."),
		"overwrite":          flagArg("Replace the file if it exists."),
		"run":                runArg,
		"condition":          conditionArg,
		"include_tables":     flagArg("archive: include the count tables (the default), or name each by its SHA-256 only."),
		"include_structures": flagArg("archive: include the files of the structures the saved views show, or name each by its ID and SHA-256 only (false). Not given: included when the library holds every file, named by ID and SHA-256 when it does not (a workspace opened from an archive that named them so), which the message says."),
		"scale":              map[string]any{"type": "number", "minimum": 1, "maximum": 8, "description": "structure-image: the image's size against the view's (4 if not given)."},
		"legend":             flagArg("structure-image: draw the legend below the image (the default)."),
		"light":              flagArg("structure-image: on white whatever the page's theme, as a figure's structure panel draws it."),
		"selection":          textArg("selection: a saved selection by name; the current selection if not given."),
		"map":                textArg("comparison-map: first, second or difference (the default)."),
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
