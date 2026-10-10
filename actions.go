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
	{Name: "open_files", Description: "Opens files on this computer, as dropping them on the window does: count or score tables (.csv, .tsv), the target's sequence (.fasta), designs (.design.json) and workspace archives (.msz), or folders of them. Needs the token.", InputSchema: schema(map[string]any{
		"paths":         map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Absolute paths of files or folders."},
		"new_workspace": flagArg("Open them in a new workspace rather than the open one."),
	}, "paths"), long: true, reads: true},
	{Name: "set_mode", Description: "Shows a view: start, experiment, qc, score or map.", InputSchema: schema(map[string]any{
		"mode": textArg("start, experiment, qc, score or map."),
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
	{Name: "score", Description: "Scores the counts with the current design: functional scores with standard errors, a new immutable run (or the existing one, when a run already has the same table, design and parameters). Shows it in the Score view.", InputSchema: schema(map[string]any{
		"preset":     textArg("mavescape (the default), enrich2 (Enrich2 2.0.2's ratios, for comparison) or dimsum (DiMSum's fitness and error model, for an input and an output; the run's fitted terms are returned)."),
		"parameters": map[string]any{"type": "object", "description": "Parameters to change from the preset: model (ratio, wls, ols: a time series starts from wls; dimsum), regressionSE (counting-floor, residual), normalization (wt, complete, full, synonymous), combination (reml, fixed, enrich2), rescale, pseudocount, dimsumNormalise, dimsumErrorModel, dimsumDropout, differential (with two or more conditions: limma, paired, independent or null), filters {minInputCount, minTimePoints, …}."},
	}), long: true},
	{Name: "qc_findings", Description: "Quality control of a score run (or of the counts alone, before scoring): each finding's status (pass, review, fail or not assessed), what was found, its threshold and why it matters, and the overall status. Shows them in the QC view.", InputSchema: schema(map[string]any{
		"run":     textArg("A score run by name or id, or \"counts\" for the counts with the current design; the latest run of the current design if not given."),
		"finding": textArg("A finding to show in full in the QC view, by id or title."),
	}), long: true},
	{Name: "select_variants", Description: "Selects variants on the map, by name or by position, and optionally saves the selection by name. Shows the Map view with the selection.", InputSchema: schema(map[string]any{
		"variants":  map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "MAVE-HGVS names, such as p.Trp36Ala."},
		"positions": map[string]any{"type": "array", "items": map[string]any{"type": "integer"}, "description": "Positions on the target (numbered from 1): every substitution there."},
		"filter":    textArg("Only these of them: scored, low (low confidence), filtered or missing."),
		"save_as":   textArg("Save the selection under this name."),
		"run":       runArg,
		"condition": conditionArg,
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
	{Name: "export", Description: "Writes a file: a run's scores or counts (MaveDB columns), QC per sample or per variant, provenance, the methods or their references, the map (SVG), the selection, or the whole workspace as an archive (.msz). Needs the token.", InputSchema: schema(map[string]any{
		"what":           textArg("scores, counts, qc-samples, qc-variants, barcodes (a table of barcodes), provenance, methods, references, map, selection or archive."),
		"path":           textArg("The absolute path of the file to write."),
		"overwrite":      flagArg("Replace the file if it exists."),
		"run":            runArg,
		"condition":      conditionArg,
		"include_tables": flagArg("archive: include the count tables (the default), or name each by its SHA-256 only."),
		"selection":      textArg("selection: a saved selection by name; the current selection if not given."),
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
