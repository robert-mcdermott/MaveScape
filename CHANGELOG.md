# Changelog

## 0.6.0 (unreleased)

Wave 6 of the [roadmap](mavescape-spec/roadmap.md): figures and a provable record.

### Added

- **Figures** (wave 6, slice 1). The Figures view holds the workspace's figures: a page at a
  journal's column width (one column, 85 mm; one and a half, 114 mm; two columns, 174 mm), a 16:9
  slide or any size, its text set in points at the printed size (7 pt), its panels lettered A, B,
  C… in reading order. A panel is a run's variant-effect map (a condition, or a difference between
  conditions; its coloring, row order and palette; a range of positions; the tracks below it, the
  color bar and the key to its states) or text. Panels are dragged and resized, snapping to the
  page's margins and to each other's edges, nudged with the arrow keys, placed exactly in
  millimeters, and every change can be undone; making or deleting a figure and adding or removing a
  panel are in the workspace's history. A panel says what it shows, so the figure is drawn again
  from the workspace whenever it is shown and follows a rescoring until it is exported; figures are
  kept in the workspace and its archive. **Add to figure** in the Map view takes the map as it is
  shown (the positions in view, the tracks shown). Text under 6 pt at the printed size, positions
  narrower than 0.6 pt and text that does not fit are said under the page.
- Figures exported as SVG (vectors, text as text, each map cell named by its variant, the figure
  in words as its `<desc>`), PDF (one vector page at the printed size, text in Helvetica), PNG at
  300 or 600 dpi of the printed size (its resolution in the file), or to the clipboard. The same
  figure is the same bytes when written again. One drawing (`web/lib/draw.js`: marks painted on a
  canvas, written as SVG, written as PDF) makes the view and every export, in Node as in the page;
  the PDF writer is CytoWeave's (`web/lib/pdf.js`, `web/lib/png.js`).
- Remote control: `figures`, `create_figure`, `add_figure_panel`, `set_figure` and
  `export_figure`. FORMATS.md describes a figure's document and files; the guide's *Figures* page,
  with a screenshot.
- **Every view's plots as figure panels** (wave 6, slice 2). **Add to figure** beside each plot:
  a QC finding's charts (in its detail pane), a run's scores by class, its filter flow and a
  contrast's volcano (Score), the comparison shown (one against the other, Bland–Altman, the
  disagreement by position, a predictor's classes, either side's map or the map of the
  difference), a variant's evidence (the inspector: its score and 95% interval with each
  replicate's ± 1.96 SE; its time course or bins chosen in the Figures view), and a saved
  structure view (its figure panel, drawn at 4× on white and kept with the figure, in the library
  and the archive; drawn again on request when the view is saved again). A plot panel lays out its
  charts at the figure's text size, each with its heading and legend, the room shared by what each
  needs, and its properties choose what it shows and its title; a bar label shrunk under 6 pt, too
  little room and an image under 300 dpi are said. `add_figure_panel` takes every kind, and
  `export` with `what: "structure-image"` takes `light`.
- The views draw their plots with the same module as figures (`web/lib/plots.js`; the QC
  findings' charts in `web/lib/qc-plots.js`, the Score, Compare and inspector plots in
  `web/lib/view-plots.js`), so a panel is the view's plot at the figure's size.
- **Figures that carry their analysis** (wave 6, slice 3). Every exported figure carries its
  manifest (`web/lib/figure-manifest.js`): the figure's document and, panel by panel, what it
  shows, what it was drawn from (each run by its output's SHA-256 and its table's, the QC
  thresholds and the finding's acknowledgement, a comparison's sides, a track's file, a structure
  view's image) and a digest of its drawing; the workspace, MaveScape's version and commit; and a
  fingerprint that catches an edit. It is in the SVG's `<metadata>`, a PNG `iTXt` chunk and a file
  attached to the PDF; `export_figure`'s `json` format writes it alone.
- A figure dropped on the window says what it shows, where it came from, whether its manifest is as
  written, and panel by panel whether what it was drawn from is as then, changed since (saying
  what) or not in this workspace; it opens the workspace it came from when the library holds it.
  **Rebuild here** adds it to the workspace, draws each panel again from its inputs and compares
  each drawing with the one recorded. Remote control: `check_figure` (with `rebuild`).
- `mavescape export --format figures` writes every figure of a workspace archive as SVG, PDF and
  PNG at 300 dpi, each with its manifest, and `figures.json`.
- **The Report** (wave 6, slice 4). The Report view holds the methods of the whole workspace,
  written again on every change from its record (`web/lib/report.js`): each run's data, design,
  scoring and QC as its own methods say them (runs that read the same named together), a table of
  every run's parameters as `parameters.json` names them, the QC thresholds changed and the
  findings acknowledged; the comparisons and robustness checks added to it; the saved selections
  with their queries, the annotations, structures and figures (each panel by its letter); every
  input's SHA-256; the software and each run's output hash; the decision log (the history, entry
  by entry); the limitations (what the counts did not record, each model's assumptions, findings
  not acknowledged, a predicted structure); the research-use statement. References are numbered
  as the text first cites them, only those it cites, with their BibTeX. Copied as Markdown or
  downloaded; the workspace archive carries it (`report.md`, `report.bib`).
- **Add to report**, under a comparison's compatibility report and in a run's robustness pane:
  the workspace keeps what the analysis found (`analyses`, in its history), and the report says it
  with its methods cited (Lin's concordance, Bland and Altman's limits of agreement, Bonett and
  Wright's interval, DeLong's, a multiverse analysis). Removing a run takes out the analyses that
  read it.
- Remote control: `report` (each section, the Markdown and BibTeX; `remove` an analysis kept),
  `report: true` on `compare` and `check_robustness`, `export` of `report` and
  `report-references`, and `set_mode` of `figures` and `report`. `mavescape export --format report`
  writes `report.md` and `report.bib` without a window.

- **Checkpoints and what changed** (wave 6, slice 5). A checkpoint keeps the analysis as it
  stands, named (the workspace's state without its history, by its SHA-256, and the history's hash
  then), with the workspace and in its archive; kept from the Report view, the drawer's history or
  remote control's `checkpoint`. The diff (`web/lib/diff.js`) says what changed from a checkpoint to
  now or another, or between two archives, in words: the tables, targets, design, runs scored and
  removed, QC thresholds and acknowledgements, selections, annotations, structure views, figures,
  the report's analyses and MaveDB details. For each table's latest run it says how its parameters,
  filters and design changed and what that did: the variants whose effect moved beyond the earlier
  95% interval, changed class, or were newly filtered or scored, the most moved by name, the QC
  findings whose verdict changed, and a map of the change. Shown above the report; remote `diff`.
  The report names the checkpoints.
- **Reproducibility certificates** (wave 6, slice 6). A certificate (`web/lib/certificate.js`) is
  the workspace archive with every number the workspace reports, computed again from its files:
  each run's scores, SEs and classes (and each difference between conditions'), its QC findings
  and a digest of every number its QC computed, the comparisons and robustness checks kept in the
  report, each figure panel's drawing (as the figure's manifest records it) and the report. It
  names the workspace and every file it reads by their SHA-256, the history's head and the
  checkpoints; it says what it does not compute again and what making it found; and its
  fingerprint, the SHA-256 of what it records, names exactly what was certified. The tables can be
  left out (named by their SHA-256) for data that cannot be shared. Made from the Report view's
  Certificate pane (in a worker) or remote control's `certify`; the same workspace gives the same
  bytes in the window and in Node.
- `mavescape verify` checks a certificate without a window: its fingerprint, its files, the
  history's chain, each checkpoint's state and each run's id, then every number computed again and
  compared bit for bit; exit 0 verified, 1 differs (each difference listed by the number it is), 2
  not checkable (a file missing: `--data` gives it); `--report` writes the verification as JSON.
  The Report view's **Verify…** and remote control's `verify_certificate` do the same (the
  library's files found by their SHA-256); a certificate opened as a workspace offers to verify
  itself. README.txt in the certificate, FORMATS.md and the guide's *Certificates* page say what it
  proves (the recorded inputs give the recorded numbers) and what it does not (that the scores are
  right).
- The window's figures, comparisons, QC subjects and annotation tracks are resolved by shared
  library code (`web/lib/figure-data.js`, `compare-pair.js`, `qc-subjects.js`, `run-tracks.js`,
  `source-table.js`, `score-input.js`), so the certificate draws and computes exactly as the views do.

### Changed

- The README is the project's front page, as CytoWeave's and Proteoscope's are: what MaveScape
  is and covers, highlights, install, the examples, opening data, the views, options, scripting,
  validation, privacy, limitations, development and credits.
- CI does not run for a change of documentation alone (Markdown files, the spec, the license or
  the citation); the site's pages and screenshots still run it, and it can be run by hand.

### Fixed

- The website's address is `https://robert-mcdermott.github.io/MaveScape/`, as GitHub Pages
  serves it (the path keeps the repository's capitals): the site's canonical links, link
  previews, sitemap and robots.txt, and FORMATS.md's links, named it in lower case, which Pages
  answers with 404.
- A run of sorted bins' methods listed Peterman and Levine's reference without citing it, the
  references after it numbered one too far (the weighted average cites VAMP-seq's alone, the
  maximum likelihood Peterman and Levine's alone). Its MaveDB deposit's methods change with it;
  MaveDB's validators checked the two such deposits again (`reference/mavedb-export.json`).
- The methods' BibTeX gave MaveScape and Proteoscope the same key (`mcdermott2026`) when a run's
  methods cited both; a program's key is now its name and year (`mavescape2026`).

### Validation

- The `figures` suite (7 checks): nine examples' maps as figure panels with their tracks, every
  cell the color the map's own SVG gives it; the PDF's content streams read back drawing the SVG's
  rectangles and text, mark for mark; the same bytes written again; no text under 6 pt; a range of
  positions exactly its cells; a difference between conditions; a figure through the archive. The
  remote session (171 checks) drives the figure actions in a window, its SVG the same bytes as Node
  draws the same figure, its PDF the same marks, its PNG the pixels and resolution asked for.
- The `figures` suite grows to 13 checks (wave 6, slice 2): every QC finding with a plot of eight
  examples as a panel (96), each bar the QC results' value and every point drawn; the scores by
  class each class's count from the run; a contrast's volcano a point per difference; a variant's
  evidence each replicate's score and the combined interval as exported; a comparison a point per
  variant where its scores put it; a figure of every kind, its PDF the SVG's marks and its
  structure image kept byte for byte. The remote session: the window's SVG of a QC finding, the
  scores by class, a comparison and a variant's evidence the same bytes as Node's; a saved
  structure view's panel the same pixels as the view's own figure panel, and in the archive.
- The `figures` suite grows to 18 checks (wave 6, slice 3): a figure's manifest read back intact
  from SVG, PDF, PNG and JSON; an edit caught by its fingerprint; a rescoring flagging exactly the
  panels drawn from the rescored table; changed QC thresholds drawing only the panel that draws them
  otherwise; a figure rebuilt from its manifest in a copy of the workspace the same bytes.
  `headless-run` checks `mavescape export --format figures` (twice the same bytes, the window's
  drawing); the remote session (180 checks) the window's manifest against Node's, `check_figure`
  and a figure opened in the window.
- The `report` suite (8 checks; wave 6, slice 4): GRB2's workspace built one operation at a time,
  every operation said and the decision log the history; the example opened and scored alone says
  nothing more; each of the 14 examples' runs, the report's paragraphs its methods word for word;
  every reference with a DOI (43) against Crossref's record of it (`validation/fixtures/
  crossref.json`, recorded by `fixtures/make-crossref.mjs`), a field Crossref records otherwise
  (for three references) left out and said; references in the order cited, BibTeX keys unique; the same report
  again and from the archive; a run removed takes out the comparison that read it. The remote
  session (184 checks): the archive's report and the Report view's, after a comparison and a
  robustness check are added, Node's text; what was kept what Node computes. `headless-run` (33):
  `mavescape export --format report` the archive's report, the same bytes twice.
- The `diff` suite (6 checks; wave 6, slice 5): five planted changes from a checkpoint of GRB2's
  run (the pseudocount, the minimum input count, a replicate left out, a QC threshold, the
  readout), each described exactly and nothing else; the variants each rescoring moved, crossed,
  filtered and scored, computed apart from the scores and SEs; an analysis against itself and a
  checkpoint against the workspace it was kept from unchanged; a checkpoint through the archive;
  the map of the change; the report naming the checkpoint. The remote session: the window's diff
  Node's, from the workspace's archive and between two archives.
- The `certificate` suite (7 checks; wave 6, slice 6): GRB2's workspace of every operation
  certified, each kind of number what is computed apart from the certificate, verified bit for bit,
  the same bytes again; six kinds of tampering caught and said; without its tables not checkable,
  then verified with them; the 14 examples (172,383 numbers) and each earlier release's archive
  certified and verified. The remote session (191 checks): the window's certificate verified in
  Node and the same bytes as Node's, every figure panel the drawing its manifest records; Node's
  verified in the window, a tampered one's difference Node's. `headless-run` (34): `mavescape
  verify` exits 0, 1 and 2 as it should.
- `headless-run.mjs` reads a command's output to its end before checking it: a reason on stderr
  was lost on CI's runner when the command's exit was seen before its output.

## 0.5.0 (2026-10-12)

Wave 5 of the [roadmap](mavescape-spec/roadmap.md): variants in 3D. MaveScape draws a protein's
structure itself, a PDB entry, an AlphaFold DB model or a file of your own, with the viewer it
shares with Proteoscope, and needs no other program. The target is mapped onto every chain that
holds it, position by position, checked against SIFTS. Residues take their positions' scores in the
map's colors, and a selection is shared between the map and the structure. What the structure says
of each position (secondary structure by DSSP, accessibility, exposure and disorder, contacts with
partners) becomes tracks beside the map, the scores by structural class are tested, and a test asks
whether the least tolerant positions cluster beyond what burial explains. Views of a structure are
saved with the workspace, its archive and methods, the structure's file kept by its SHA-256, and
figure panels carry their legend and what they show. A Proteoscope running on the same computer
opens the view as its own session. Workspaces saved by 0.1.0 to 0.4.0 open and reproduce their runs;
two saved by 0.5.0 are kept for later versions to do the same, their saved views drawn again.

### Added

- **The Structure view (wave 5, slice 1; X1).** A protein's structure in MaveScape, needing no
  other program; the Structure view follows Compare.
  - **Opening:** a PDB entry by its ID, an AlphaFold DB model by a UniProt accession (the target's
    by default), or a file of your own: PDB, mmCIF or BinaryCIF, gzipped or not, opened from the
    view or dropped on the window. One structure is shown at a time, for the session; it is not
    yet saved with the workspace.
  - **The program's new requests** (`structures.go`; docs/NETWORK.md): an entry's coordinates
    from RCSB PDB (`/api/fetch/pdb/{id}`), and a protein's AlphaFold DB entries and model
    (`/api/fetch/alphafold/{accession}/prediction`, `…/model/{version}`). Each sends a PDB ID or an
    accession only; a structure is cached compressed, as the service sent it, once it is read to
    its end and found whole, and opens offline after that.
  - **Drawing:** Proteoscope's renderers, copied with their tests (`web/lib/structure/`): WebGPU
    (impostor spheres and cylinders, the cartoon, surfaces, ambient occlusion, picking), or the
    Canvas renderer where the browser offers no WebGPU or `?renderer=canvas` asks for it, the badge
    above the view saying which and why.
    - Styles: cartoon, ball and stick, sticks, spacefill, trace.
    - Colors: chain, entity, rainbow, secondary structure, molecule type, element, residue class,
      hydropathy, nucleotide, B-factor, a predicted model's pLDDT; a legend.
    - Surfaces (molecular, solvent-accessible, van der Waals, Gaussian), computed in a worker.
    - Biological assemblies, built by the entry's own operators.
    - An image of the view (PNG).
  - **Residues** selected by click or in Proteoscope's selection language (`resn CYS`, `chain A and
    resi 40-80`, `byres (protein and within 4 of nucleic)`, `plddt < 70`), drawn as sticks, ball
    and stick or spacefill, hidden, labeled, and focused on (the camera on them, their neighbors
    within 5 Å with their side chains).
  - **In words:** the entry's title, method and resolution (or that it is a prediction), its
    chains with the residues observed and the UniProt residues each covers, and what else it holds.
  - **Remote control:** `open_structure` (a PDB ID, or an AlphaFold DB model; `"target"` for the
    target's) and `set_structure` (style, color, surface, assembly; select, show, label, focus);
    `open_files` opens structure files; `get_state` gives the structure shown.
  - **The factor IX example's sixth step** opens PDB 1RFN and draws its cysteines as sticks: seven
    disulfide bonds, one joining its two chains. The guide page *Structures*.

- **The target mapped onto structures (wave 5, slice 2; X2).** The workspace's target is placed on
  the structure shown, position by position, whatever the entry's numbering.
  - **The mapping** (`lib/mapping.js`): the target's protein aligned to each chain's sequence (the
    entry's SEQRES, its residues observed marked) by Proteoscope's overlap alignment
    (`structure/align.js`, copied with its tests: BLOSUM62, affine gaps, free end gaps). Each
    position is on a residue (identical, or another with the entry's reason: an engineered
    mutation, a conflict), not observed, missing from the structure's sequence, or outside it; a
    position is ambiguous where an alignment that scores the same places it otherwise. The entry's
    own record of the UniProt residues each chain covers is compared, residue by residue, and a
    shift said. Every chain that holds the target is mapped; the one that holds the most is
    chosen, and another can be.
  - **Structures of the target:** the PDB entries that cover it, from PDBe's SIFTS
    (`/api/fetch/pdbe/best-structures/{accession}`, the accession only), ranked by the target
    positions each covers, then resolution, with its AlphaFold DB model first; each opens with the
    target mapped on its chain.
  - **Positions on the structure:** `pos 30-40` (the target's) and `uniprot 188-198` (the
    reference's) in the selection language; a selection is kept, position by position, when
    another structure is opened, an experimental one or the AlphaFold DB model; a residue pointed
    at says its target position.
  - **The mapping** in words beside the view, its residues selected by state, and written out
    (`<entry>_chain-<chain>_mapping.csv`; FORMATS.md).
  - **Remote control:** `find_structures`, `map_structure`; `open_structure` takes a `chain`;
    `export` writes `structure-mapping`; `get_state` and `open_structure` give the mapping.
  - **Factor IX's sixth step** opens 1RFN from the structures of the target and reads its
    mapping: chain A at 227–461 though numbered as chymotrypsin is, chain B at 132–188, which the
    entry's own record numbers five earlier.

- **Scores on the structure (wave 5, slice 3; X3).** Each residue of the target takes its
  position's scores, in the map's colors (`lib/structure-scores.js`, `ui/structure-coloring.js`).
  - **Colorings:** the median, mean, lowest or highest score of a position's missense
    substitutions; the fraction abnormal-like (below or above a threshold set by hand, or by a MaveDB
    record's published calibration, for its scores as published); how many are scored; one
    substitution; the uncertainty (median SE); the disagreement of the two sides Compare shows;
    the QC state. On every chain that holds the target.
  - **The map's grammar:** its palette and scale, centered on the wild type; filtered and missing
    positions drawn in grays the palettes do not hold, never in the wild type's color; a value
    from scores of low confidence only drawn paler; a legend, with how many positions are in each.
  - **The run and condition the map shows** (or its contrast) are those colored by, chosen here or
    on the map.
  - **A strip of the target's positions** below the view: their colors, which are on the
    structure, and an AlphaFold DB model's confidence beside them; a click or a drag selects.
  - **One selection for the map and the structure:** a residue picked selects its position's
    variants on the map (as `at` selects them) and puts the position in the inspector, a new
    section with its substitutions' scores and its residue on each chain; a selection made on the
    map is drawn on the structure; residues selected in words are selected on the map too. With
    residues colored by scores, a selection is shown by its side chains, not by a tint.
  - **The coloring written out** (`<entry>_chain-<chain>_<coloring>.csv`; FORMATS.md).
  - **Remote control:** `set_structure`'s `color` takes the scores' colorings (with
    `substitution`, `threshold`, `side`, `calibration`), `pick` picks a residue as a click does;
    `export` writes `structure-scores`; `get_state` gives the scores colored by.
  - **The GRB2 example's sixth step** colors 2VWF by the median score: the core is the least
    tolerant, and the residues that touch the Gab2 peptide score near the wild type, an abundance
    assay not seeing binding. Its fourth step now points to what the analysis can do.

- **Structure as evidence (wave 5, slice 4; X4).** What the structure shown says of each target
  position (`lib/structure-evidence.js`, `ui/structure-evidence.js`), on the chain mapped:
  - **Measures:** DSSP's secondary structure; the accessible area by Shrake–Rupley with DSSP's
    radii, in the chain alone and in the structure, relative to Tien et al.'s maxima;
    StructureMap's exposure (pPSE) and disorder, with an AlphaFold DB model's aligned error;
    pLDDT; the nearest partner (another chain, a ligand, an ion; common crystallization additives
    only when chosen), within 4 Å an interface, its contacts typed by PLIP's rules. Proteoscope's
    `exposure.js` and `interactions.js` copied with their tests.
  - **Structural classes:** disordered, interface, buried or exposed; a coloring of the structure,
    a row of the strip, words when a residue is pointed at or picked (the inspector).
  - **Tracks beside the map:** the classes and secondary structure, shown; the accessibility,
    exposure, distance and pLDDT, to show. The query language reads them as features (`in feature
    buried`).
  - **The scores by class:** each class's positions and median score, against the rest by
    Mann–Whitney's test, BH-adjusted; a class's residues selected.
  - **Clusters:** whether the least tolerant positions (10–30%) make more pairs within 8 Å than
    positions of the same burial (seeded draws within strata of relative accessibility), with the
    same burial ignored beside it; compact groups of them selected.
  - **The program's new request:** a predicted model's aligned error
    (`/api/fetch/alphafold/{accession}/pae/{version}`; the accession and version only).
  - The evidence written out (`<entry>_chain-<chain>_evidence.csv`; FORMATS.md). Remote control's
    `structure_evidence`, `set_structure`'s `color: "class"`, `export` of `structure-evidence`;
    the tracks in `list_tracks`.
  - **The PTEN example's sixth step** reads 1D5R as evidence: buried positions less tolerant, the
    least tolerant clustered beyond burial, one group joining the two domains. Its second step now
    points to what the analysis can do.

- **Structures in the record (wave 5, slice 5; X5).** A view of a structure is kept with the
  workspace, its structure with it (`lib/structure-record.js`, `ui/structure-views.js`).
  - **Saved views** (Structure view, *Saved views*; the sidebar's *Structure views*): the
    structure, assembly, chain, camera and view size, style, coloring (with the run, condition or
    contrast and palette), surface, selection, labels, residue styles, focus and the evidence's
    choices, under a name; saved again under a name, a view is replaced. Opened, from the list,
    the sidebar or the inspector, a view is drawn again as it was, its target mapped again and any
    difference from the mapping it was saved with said. Saving and removing are in the history.
  - **The structure kept** (`structures`; FORMATS.md): the file as it came (RCSB's gzipped mmCIF,
    AlphaFold DB's model with its aligned error, a file of the person's), stored in the library by
    its SHA-256 and in the archive under `sources/`, with where and when it was retrieved. An
    archive may name the structures by checksum only: a PDB entry or AlphaFold DB model is then
    fetched again by its ID when its view opens, and its SHA-256 compared with the one saved.
  - **Figure panels** (*Image*, *Figure panel*): the view at 4× its size in CSS pixels (a saved
    view: the size it was saved at, so the same view gives the same image anywhere), the legend of
    its colors below it, and what it shows as JSON in the PNG (`iTXt`, `mavescape-figure-panel`:
    the structure and its file's SHA-256, the view, the coloring with its run's output, the legend)
    for wave 6's figure builder.
  - **The methods** describe each structure a view shows (its source, retrieval and SHA-256, the
    readers and viewer), the target's alignment and its chain (positions on residues, identity,
    residues that differ), the saved views, and, when evidence is read, DSSP, the accessible area,
    StructureMap's exposure, PLIP's contacts and the tests with their settings; with their
    references.
  - **Remote control:** `save_structure_view`, `open_structure_view` (it says what differs in the
    mapping, and how the structure was found), `remove_structure_view`; `export` writes
    `structure-image` (`scale`, `legend`), an archive with or without the structures
    (`include_structures`); `focus` takes a structure view; `get_state` gives the structures and
    views kept.
  - **The GRB2 example's sixth step** saves its view of 2VWF as "Core".

- **Open in Proteoscope (wave 5, slice 6; X6).** For what Proteoscope does beyond MaveScape
  (validation reports, density maps, superposition, ligands), the view shown is handed to a
  Proteoscope running on this computer, in what it already accepts (`handoff.go`,
  `lib/proteoscope.js`, `ui/proteoscope.js`). Nothing else depends on it.
  - **Finding it:** the program asks Proteoscope's ports (8765–8814) for its startup answer, which
    tells it from any other program and gives its version; only a page on this computer is
    answered. `--proteoscope off` stops the looking, `--proteoscope 9000-9010` looks elsewhere.
    Nothing leaves the computer (NETWORK.md).
  - **The Structure view's Proteoscope button**, only while one runs: the view as Proteoscope's own
    session, in a link opened in a new tab. The PDB entry or AlphaFold DB model by its ID; the
    scores as its custom residue data, titled as the legend, on its blue–white–red (viridis for
    counts and the like) over the map's range centered on the wild type; categories (QC state,
    structural class) as residue colors; the style, residues drawn, hidden, selected, labeled and
    focused on; the camera, once it comes to rest.
  - **Proteoscope 0.10** (the version tested) gets all of it; another version the structure alone
    (`#fetch=`), the rest as a session file; a file of the person's the session file, the file
    embedded (FORMATS.md).
  - **Remote control:** `proteoscope_link` (the link, or the session; refused, saying where it
    looked, when Proteoscope is not running); `export` of `proteoscope-session` writes the session
    file whether Proteoscope runs or not.
  - The guide page *Structures*, its section *Open in Proteoscope*, with GRB2's three steps; a
    screenshot scene of Proteoscope's window (`structure-proteoscope`).

### Changed

- The Structure view's words give a chain's UniProt residues as the entry gives them ("the entry
  gives UniProt P00740 128–183"): the mapping may place them otherwise.
- The target mapped onto a structure is the target of the run the map shows (the workspace's, as
  before, when it has one target), so the mapping follows the run.
- The Structure view's **Image** is a menu: the image (2×, as before) or a figure panel.
- A saved view keeps the residues hidden too (`hidden`), which it did not.
- The archive's dialog asks whether to include the structures' files when the workspace keeps any;
  its manifest says which (`structures`: `included` or `checksums`). MaveScape 0.4 reads such
  archives, the structures' files among its sources.

- Headless Chrome is started with WebGPU allowed (`docs/capture/cdp.mjs`), for the screenshots and
  the validation's sessions.
- Unit tests are run as `node --test "web/lib/**/*.test.mjs"`, the structure viewer's included;
  `MAVESCAPE_TIME_SCALE` gives its performance tests more time on shared runners (CI sets 5).
- The screenshots (`docs/capture/capture.mjs`): a Chrome that does not start is started again once,
  and a scene that still cannot start fails alone; one failed start ended the whole recapture. The
  screenshots look for Proteoscope on ports of their own, so a Proteoscope running on the computer
  does not appear in them.

### Fixed

- A file the library already holds is read to its end before the program answers that it has it.
  Answered first, a large upload's connection was closed under the browser: opening the factor IX
  example (a 2 MB table) a second time in one library failed with "Failed to fetch".
- WebGPU lost under the Structure view (the browser's graphics process crashed or was reset) left
  the view unable to draw, and an image of it failed. The view now goes on with the Canvas renderer
  on a fresh canvas, its badge saying why, everything drawn again; an image whose drawing loses WebGPU
  is drawn again by the Canvas renderer. CI's runners, which draw WebGPU in software, lose it at the
  first image.
- After WebGPU was lost, the Canvas renderer's 2D surface, which the browser loses too when its
  graphics process crashes, could give a blank image: an image waits for the surface to come back
  (at most 3 s), is taken again if the surface is lost under it, and the view is drawn again when
  it returns.
- Files a script opened with remote control's `open_files` were listed as files for the window to
  open, so the window opened them again later (on focus, or within 30 s), over whatever workspace
  was open by then. They are served to the page but no longer listed.
- The message for a file MaveScape does not open listed `.xlsx` among the tables it opens.
- An image of the Structure view taken just after a change, before a frame had drawn it, could
  show the scene as it was: the scene is brought up to date first.
- The Structure view's legend, wrapped onto two lines in a narrower window, was drawn over the strip
  of positions below it: the 3D view gives way instead.
- The README and the guide (*Opening your data*) said count tables could be Excel workbooks:
  MaveScape reads CSV and TSV, gzipped or not, as FORMATS.md says.
- A workspace opened from an archive that named its structures by checksum could not be archived
  again until each view was opened: its structures' files are not in the library, and the archive
  asked for them. `mavescape run --from-workspace` on such an archive reproduced its run, then
  failed writing `workspace.msz`. Not asked otherwise, an archive now includes the structures'
  files when the library holds them all and names them by ID and SHA-256 when it does not, saying
  so; the export dialog says which files are missing, and that opening a view fetches them again.

### Validation

- `structures` validation suite (6 checks):
  - **The examples' proteins:** each PDB entry, read as the page reads it from the fetcher's cache,
    holds its target in the chain its guide names, on the UniProt residues the entry gives; the
    cartoon draws at least 95% of the chain's residues observed, ball and stick every atom but
    water and hydrogens. Each AlphaFold DB model: a predicted model with every residue's pLDDT,
    its mean within 0.05 of AlphaFold DB's own and its share in each confidence band within 0.01.
  - **One structure in three formats:** 2VWF as gzipped mmCIF, RCSB's PDB-format file and
    BinaryCIF gives the same atoms (to 0.001 Å), residues and secondary structure; GRB2's model as
    mmCIF and BinaryCIF the same atoms and pLDDT.
  - **Assemblies:** each built with the atoms it was estimated at; 3OG7's two each one chain;
    hemoglobin's tetramer (1HHO) the dimer moved whole by symmetry.
  - **What the guide shows:** on 1RFN, `resn CYS` selects every cysteine, and the bonds drawn
    between their sulfur atoms are the entry's own disulfide records, one joining the two chains;
    on 1TUP, the residues within 4 Å of the DNA selected in words are those every distance between
    atoms finds, R248 and R273 among them.
- `structures`, slice 2 (4 more checks, 10 in all):
  - **Against SIFTS:** each example's target aligned to its PDB entry places every residue where
    SIFTS does (PDBe's residue-level mapping, read from its updated mmCIF with gemmi, an mmCIF
    reader independent of MaveScape's: `reference/sifts.json`, by `generate_sifts.py`), and calls
    not observed the residues SIFTS does; where they part (PTEN's join in 1D5R), two alignments
    score the same, which the mapping calls ambiguous.
  - **On the AlphaFold DB models:** every position on the residue numbered as its reference
    position; another residue exactly where the target differs from the model's sequence (BRCA1
    RING's R175K, TP53's R72P).
  - **What the entries record:** 2VWF's engineered mutation (the same from its PDB-format file),
    1RFN's light chain and its own record five off, PTEN's removed loop and its ambiguous join.
  - **The structures of each target**, ranked from PDBe's answers in the cache, the example's entry
    among them with its chain.
- The remote-control session: every example protein's PDB entry and AlphaFold DB model
  opened and drawn, with WebGPU and then with the Canvas renderer, each with the atoms Node reads
  and an image that is not empty; `set_structure`'s selections, styles, labels, focus, surface and
  assembly; refusals, saying why; a structure file opened with `open_files`. Slice 2:
  `find_structures`, `open_structure`'s and `map_structure`'s mappings and the mapping's file as
  Node makes them; a selection by target position kept from 2VWF to GRB2's model.
- `structures`, slice 3 (4 more checks, 14 in all):
  - **Each example's run on its entry, by every coloring:** every residue of every chain that
    holds the target has the value its position's missense substitutions have in the run's
    results (read without the map's model) and the map's color for it; every position with nothing
    scored is gray, at least 100 (RGB) from the wild type's color.
  - **Selections both ways:** each example's ten least tolerant positions, selected on the map (as
    `at` selects them), are drawn on the residues SIFTS places them on, and picked there select the
    same positions.
  - **The GRB2 example's account,** from the atoms: the least tolerant residues packed (more Cα
    atoms within 10 Å), those that touch the Gab2 peptide, selected in the guide's words as every
    distance finds them, nearer the wild type; the guide gives these numbers.
  - **Fraction abnormal-like** by PTEN's published calibrations: the share in the abnormal ranges
    as the record's own JSON gives them (ExCALIBR's five, the Gaussian mixture's one).
- The remote-control session (144 checks), slice 3: 2VWF colored by the median score in the page,
  every residue as Node colors it; a residue picked, its position's variants selected on the map
  and the position in the inspector; a map query's selection drawn on the structure; the
  coloring's file as Node makes it; the other colorings, refusals included; the strip with an
  AlphaFold DB model's pLDDT.
- `structures`, slice 4 (7 more checks, 21 in all):
  - **Against DSSP:** each entry's secondary structure and accessibility as DSSP 4.6.1 gives them
    (the DSSP databank's output, read with gemmi: `reference/dssp.json`, `generate_dssp.py`):
    every code but five residues of 1D5R where DSSP 4 calls a π-helix; the area within 1 Å² on
    average (0.64–0.89), with no bias.
  - **Partners** as every pair of atoms gives them; **Mann–Whitney and BH** as SciPy's
    (`reference/mannwhitney.json`, `generate_mannwhitney.py`); **disorder** on the models read with
    their aligned error; the **tracks** beside GRB2's map, queried by class.
  - **The cluster test calibrated** on simulated maps of 1D5R and 1TUP: with scores that depend on
    burial alone, p ≤ 0.05 in 3–6% of maps (every map with burial ignored); a planted patch found
    in 62–71%.
  - **The PTEN guide's account**, its domains UniProt's.
- The remote-control session (150 checks), slice 4: `structure_evidence` in the page as Node reads
  it, its choices and refusals, the structure's tracks, the evidence's file, the class coloring,
  a model's aligned error.
- `structures`, slice 5 (2 more checks, 23 in all): a saved view of each example protein's PDB
  entry and AlphaFold DB model (14) through the workspace archive, every file the same bytes and
  every view the same, the mapping made again from each file the one saved; named by checksum
  only, each fetched again by its ID the file recorded; the methods of GRB2's run with a view of
  2VWF (the entry, its SHA-256, the mapping, the view, each method cited).
- The remote-control session (155 checks), slice 5: a view of 2VWF saved, changed and opened again
  gives the same figure panel pixel for pixel, as do the view opened from the workspace's archive
  in a copy and from an archive naming the structure by checksum (fetched again); the panel's
  metadata; a view removed with its structure.
- `structures`, slice 6 (1 more check, 24 in all): the Proteoscope session of each example's run on
  its PDB entry and its AlphaFold DB model (16): each position's median, as the run's results give
  it, on the residue Proteoscope's reader keys it on, every scored position on a residue given one;
  the range centered on the wild type; the link read back with zlib as sent (at most 4,818
  characters).
- The remote-control session (162 checks), slice 6, against a fake Proteoscope where
  `--proteoscope` says: refused and no button while none runs; with 0.10.0, the link's session
  (decoded with zlib) the one returned, GRB2's medians on the residues Node places them on, the
  residues drawn, hidden, focused on, selected and labeled, the camera where it comes to rest
  (handed over during a focus); the program asks Proteoscope only for its startup answer; the
  button's click opens the link in a new tab; 0.11.0 gets the structure alone; a file of the
  person's goes embedded in a session file; Proteoscope stopped, the button goes and the session
  file is still written.
- `proteoscope-handoff.mjs` (4 checks; not in CI, run where Proteoscope is installed): Proteoscope
  0.10.0 itself opens the link of 2VWF colored by GRB2's medians and of GRB2's AlphaFold DB model
  (each fetched by its ID), and the session file of RCSB's PDB-format 2VWF given as a file,
  offline: every value on a residue its own reader reads, the legend's title, the residues drawn,
  hidden, focused on, selected and labeled, and the camera as MaveScape had them.
- Unit tests: Proteoscope's tests of the copied modules (100: parsers, structure, chemistry, DSSP,
  surfaces, selection language, formats, alignment, exposure, interactions; the two chemistry
  tests that waited for `interactions.js` among them), `structures.test.mjs` (6),
  `mapping.test.mjs` (8), `structure-scores.test.mjs` (7), `structure-evidence.test.mjs` (9),
  `structure-record.test.mjs` (6) and `proteoscope.test.mjs` (4).
- Go tests: a file stored again is read to its end before the answer
  (`TestAFileStoredAgainIsReadToItsEnd`).
- Go tests: Proteoscope found by its startup answer (the version tested, another, without remote
  control; the first in order), and nowhere another program, MaveScape itself, a closed port or one
  that never answers is, within the timeout; `--proteoscope`; `/api/proteoscope` refusing a page
  on another computer (`handoff_test.go`).
- Go tests: the structure requests (and PDBe's best structures, and a model's aligned error) ask what NETWORK.md says, keep what
  the service sent, refuse a cut-off file or a page that is not a structure, and refuse anything
  but a PDB ID or an accession before it is sent.
- The remote-control session (163 checks): Chrome's GPU process crashed under the Structure view
  (`Browser.crashGpuProcess`): the view goes on with the Canvas renderer, saying why, and draws;
  where the browser loses WebGPU by itself (CI's runners, drawing in software), the session finds
  the view on the Canvas renderer after its first image and checks it so.
- `remote-session.mjs --like-ci [rate]`: the session as GitHub's runners run it, WebGPU drawn in
  software (Chrome's SwiftShader adapter) and the page's processor slowed (4 times by default). It
  reproduced CI's failures of the release here, and passes.
- CI runs on every push to a wave's branch, not only on pull requests and main.
- Go tests: files remote control registers are served but not listed for the window; a file a later
  launch names is (`TestFilesRemoteControlOpensAreNotListedForTheWindow`).
- `headless-run.mjs` (30 checks): `mavescape run --from-workspace` on 0.5.0's PTEN archive, its
  structure named by checksum: the run reproduced, the archive written again naming it the same
  way, its views kept.
- Two workspace archives saved by 0.5.0 itself (`validation/archives/release-0.5.0-*.msz`, by
  `make-0.5.0.mjs`): GRB2 with three saved views of 2VWF and its AlphaFold DB model, their files in
  the archive; PTEN's published scores with two views of 1D5R, the structure named by its ID and
  SHA-256 only. The `roundtrip` suite's replay of each release's archive now draws its saved views
  again: each structure read from the archive or fetched again by its ID, the file recorded, and the
  target mapped again as the view was saved; a workspace without a selection is replayed too.
- The fixtures (`validation/fixtures/public-data/pdb/`, `…/alphafold/`, `…/pdbe/*.best-structures.json`)
  are the program's cached answers for the examples' proteins and the structures Proteoscope's
  tests read, retrieved 2026-10-12 (slice 4: 2HYY, 6OIM, 4ZQK, five models' aligned error, PTEN's
  UniProt features); `validation/fixtures/structures/` holds 2VWF's PDB-format file and BinaryCIF and GRB2's
  model's BinaryCIF.

## 0.4.0 (2026-10-11)

Wave 4 of the [roadmap](mavescape-spec/roadmap.md): compare. Two replicates, conditions or runs of
a workspace, or a run and a MaveDB score set or a predictor kept beside it, are compared after a
report that says what their agreement can mean, by statistics checked against R, with their maps,
their difference and the variants and positions that differ beyond their uncertainty. Two assays go
on one scale by their anchors, the anchors' uncertainty carried into the tests. A run is scored
again across other reasonable analysis choices, and each variant's conclusion is said to hold or to
depend on a choice, which is named. Variants are selected on the map by click, rectangle, freeform
shape or a query in words, saved with their queries, combined, and carried across the views. There
are fourteen examples. Workspaces saved by 0.1.0, 0.2.0 and 0.3.0 open and reproduce their runs; two
saved by 0.4.0 are kept for later versions to do the same.

### Added

- **Comparisons within a workspace (wave 4, slice 1; C1–C3).** The Compare view (after Map) puts
  two sets of scores side by side: two replicates of a run, two conditions, or two runs (a
  rescoring, or a MaveDB record's published scores against its counts scored again). It starts
  with the pair a workspace most likely asks for, and Swap exchanges them.
  - **A compatibility report comes first**, each item ok, qualified or blocked:
    - the targets: the same sequence, or two stretches of one UniProt entry (each with its
      accession and offset), matched on the entry's coordinates; no common reference blocks;
    - the level: a nucleotide run read at the protein level against a protein-level side;
    - the variants scored on both sides, and those on one side only (fewer than 10 in common
      block);
    - the directions: opposite ones compare the second side negated;
    - the assays;
    - the scales: on different or unknown scales (published scores are on their record's own),
      only the correlations are given;
    - independence: replicates sharing a sample, a replicate inside its condition, one table
      scored twice, or a record's published scores against its own counts.
  - **The agreement of the variants scored on both**, each with its 95% interval:
    - Pearson's r and Spearman's ρ (Bonett and Wright's interval);
    - Lin's concordance correlation, with its accuracy, scale shift and location shift;
    - Bland–Altman's bias and limits of agreement, and the trend of the differences with the
      means;
    - the scatter plot (y = x drawn on one scale) and the Bland–Altman plot; a variant clicked is
      shown in the inspector and ringed.
  - **Exports:** the matched variants (`*_comparison.csv`), and the report and statistics with
    each run's output hash (`*_comparison.json`).
  - **Remote control:** `compare` (the sides by name) and `export` of `comparison`; `set_mode`
    shows `compare`.
  - **Guides:** the BRCA1 saturation genome editing example's last step compares its counts,
    scored, with the published scores; the guide page *Comparisons*.

- **Comparisons across the map (wave 4, slice 2; C2).** The Compare view has three tabs:
  Agreement, Maps and Disagreement.
  - **Filters**, by confidence and depth: leave out variants of low confidence on either side,
    those with an SE above a maximum, or those with fewer input reads than a minimum. The report
    says how many each filter left out. A side with no SEs or counts (published scores) is not
    filtered on them, and the report says so.
  - **Maps:** the first side's map, the second's, and the map of their difference (first − second,
    for two sides on one scale), panned and zoomed as one (two stretches of one protein lined up
    on its coordinates). A variant clicked is selected in each. Each exports as SVG.
  - **Disagreement:**
    - the variants that differ beyond their uncertainty: each difference's z from both SEs, and q
      by Benjamini–Hochberg, for two independent sides on one scale;
    - the dispersion, which says whether the SEs describe how far the two differ, and warns when
      they don't (GRB2's replicates differ 8 times as much as their counting SEs say);
    - the disagreement by position, as bars and the ten that differ most, each position with 3
      variants or more tested.
  - **Exports:** the variants compared with their z, p and q; the positions (`*_comparison_positions.csv`);
    the report with the discordant variants, the dispersion and the positions; the three maps.
  - **Remote control:** `compare` takes `low_confidence`, `max_se`, `min_reads` and `show` (the
    tab), and returns the discordance and the positions; `export` writes `comparison-positions`
    and `comparison-map` (`map`: first, second or difference).
  - **The DHFR example** has a sixth step: −Lon against +Lon, low confidence left out (r 0.52 →
    0.77), its discordant variants (201, 186 lower with Lon), its positions, and its maps.
- The map component tells others its pan and zoom, and takes theirs, so that maps shown together
  move as one.

- **Other sources and scales (wave 4, slice 3; C1, C3).**
  - **A MaveDB score set compared without opening it.** Under Other sources in Compare, a score
    set's URN fetches its record and published scores (only the URN is sent), kept beside the
    workspace and in its archive (an annotation, `mavedb-scores`). Its scores are read as published,
    as opening the record would, on the record's own target. MaveDB records no direction: say what
    a higher score means when adding it, or under Sides (in the history). Its scores are also a
    track beside the map.
  - **Another assay of the same protein:** matched on one sequence, or on UniProt's numbering.
    PTEN's abundance against its lipid phosphatase activity agrees only in part (ρ 0.37).
  - **A predictor:** AlphaMissense (from AlphaFold DB), or a predictor's file (EVE, ESM1b, any
    table), placed on the run's protein as its track is. Compared by rank (Spearman's ρ; Pearson's
    r, Lin's concordance, Bland–Altman and the tests of disagreement withheld), and by its classes
    in a new Classes tab:
    - the measured scores in each class, with the synonymous and nonsense medians for reference;
    - the AUC of telling the tolerated class from the damaging one, with DeLong's interval.

    AlphaMissense's and EVE's scores are compared negated. EVE's table gives its classes.
  - **Scale:**
    - as scored;
    - stated to be on one scale (two score sets of one study and one pipeline);
    - each side rescaled by its own anchors: nonsense median 0 and wild type 1, or synonymous
      median 0 and nonsense median −1.

    Rescaled, two assays get Lin's concordance, Bland–Altman, the difference map and the tests of
    disagreement. The report names each anchor, and the tests carry the anchors' uncertainty. GRB2's
    Run 1 against its record's published scores: r 0.997 on two scales; rescaled, ρc 0.996 and a
    bias of 0.009.
  - **Exports:** `*_comparison.csv` gains `compared_a` and `compared_b` (each score as compared); a
    predictor's classes (`*_comparison_classes.csv`); the report adds `scale`, `classes` and each
    side's source.
  - **Remote control:**
    - `compare` takes a score set's URN (fetched and kept first) or a predictor by name, `scale`,
      `direction` and `show: classes`;
    - `export` writes `comparison-classes`;
    - `add_track` takes `mavedb-scores` with a `urn`.
  - **The PTEN example's guide** compares its abundance with the phosphatase activity score set, not
    opened, and with AlphaMissense by class (its record and calibrations now one step). The GRB2
    example says what its comparison with its record shows.

- **Robustness to analysis choices (wave 4, slice 4; C4).** Below a run in Score, Check robustness
  scores it again across other reasonable choices, in the score worker (DHFR's 48 analyses in about
  3 s): each alternative alone, then combinations drawn with a fixed seed. CytoWeave's
  specification-curve pattern, `lib/robustness.js`.
  - **What is varied**, where the design allows it:
    - the pseudocount (0.1, 0.5, 1);
    - the normalization;
    - the model of uncertainty (DiMSum's error model with replicates scaled and shifted;
      ordinary least squares, or the first and last time points, and a regression's SE);
    - the combination of replicates (moderated, REML, fixed effects, their mean);
    - low-depth measurements removed, two replicates at least, every time point;
    - each replicate left out.

    Fixed effects are not tried where the replicates differ more than their SEs say, and the pane
    says why.
  - **For each variant and each difference between conditions:** its effect (against the wild
    type's), rank, SE, inclusion and class (lower than, like or higher than the wild type, q < 0.05)
    in every analysis. Its verdict:
    - robust;
    - fragile: a choice moves its effect beyond its 95% interval and changes its class, the choice
      named;
    - depends on its uncertainty;
    - borderline;
    - its effect's size depends on a choice;
    - not always scored.
  - **Also reported:**
    - how many calls hold in every analysis and in 90% of them;
    - each alternative's effect (the classes it changes, effects moved, variants dropped, the
      typical move, rank correlation);
    - the least tolerant positions;
    - a variant's robustness in the inspector.
  - **Exports and remote control:** `*_robustness.csv`, `*_robustness_positions.csv` and
    `*_robustness.json`; remote control's `check_robustness`, and `export` of `robustness` and
    `robustness-positions`.
  - **The DHFR example's guide** checks Run 1: of its 377 differences between the conditions, 54
    hold in every analysis. The guide page *Robustness*.
  - The simulator can draw missense effects either the wild type's or clearly lost (`neutralSd`,
    `lossMin`; off by default).

- **Selections (wave 4, slice 5; V3).** Variants are selected on the map by click, rectangle,
  freeform shape or query, saved by name with their query, combined, and carried to the other views.
  - **The query language** (`lib/query.js`), typed below the map. Its parser is adapted from
    Proteoscope's `select.js`. The roadmap's phrases are queries as written: `missense at 40-80
    with se < 0.2`, `variants whose class depends on the pseudocount`. The words:
    - the class (`missense`, `nonsense`, `synonymous`, `start-lost`);
    - the state (`scored`, `low`, `confident`, `filtered`, `missing`, `unscored`);
    - positions (`at`, `pos`, `refpos`) and residues (`from`, `to`; letters or the map's groups);
    - `score`, `se`, `q`, `replicates` and `input` compared with a number;
    - the class against the wild type (`lower`, `higher`, `neutral`);
    - the robustness verdicts, and `depends on`, `class depends on` and `size depends on` a choice;
    - `feature` (UniProt's or a GFF3 file's, beside the map);
    - `in` a saved selection, `selected`, `all`;
    - `and`, `or`, `not`, parentheses.

    A word not known is named in place. A query that needs the run's robustness, or features
    beside the map, offers them. A query can replace the selection, add to it, keep its matches in
    it, or remove them.
  - **Freeform shapes:** ⌥- or Alt-drag selects the cells a shape encloses. Pan, Rectangle and
    Freeform set what a plain drag does.
  - **Saved selections** keep their query. Each one under the map selects, adds to, intersects or
    subtracts from the selection, or runs its query again. A selection changed by queries keeps
    them combined. A saved selection applies to every run of the same protein; the inspector shows
    its query, its variants by class, and the runs it applies to.
  - **In the other views:**
    - the Score view's table lists the variants selected on the map, and sends any list it shows to
      the map;
    - the Robustness pane sends each verdict's variants;
    - Compare's maps outline the selection, and its discordant variants go to the map.
  - **Exports and remote control:** the selection's JSON gains `query`. `select_variants` takes
    `query`, `operation` and `contrast`; a query that needs the run's robustness checks it first.
    `get_state` gives each selection's query.
  - **The factor IX example's fifth step** selects the substitutions of its disulfide bonds'
    cysteines by query: 345 of the 399 scored are lower than the wild type, against 2,124 of 8,529
    missense variants. The guide page *Selections*.

- **The wave's examples (wave 4, slice 6; T4): fourteen in all.** Published comparisons that teach
  what the wave built.
  - **TP53, two screens on two scales** (`tp53-screens`), opened from MaveDB:
    - Giacomelli et al.'s etoposide screen of every substitution of TP53, its published Z-scores;
    - Kotler et al.'s screen of the DNA-binding domain by the growth of H1299 cells, and Giacomelli
      et al.'s nutlin-3 screen, kept beside it by URN, not opened.

    The record names no UniProt entry: checked against P04637, the target is TP53 with arginine at
    72. Matched on UniProt's numbering, the two laboratories' screens correlate at r −0.78 as
    published; with Kotler et al.'s direction stated, 0.78, on two scales; rescaled each by its own
    anchors, Lin's concordance is 0.78. They only seemed to disagree.
  - **Hsp90's sixth step**, a rescoring against the published scores: Run 1 against its record's own
    scores kept beside correlates at r 0.95. Stated to be on one scale, Lin's concordance is only
    0.48: the difference grows with the effect, where the authors fit null-like variants on their
    first three time points.
  - The examples page, the guide *Comparisons* (two screens that only seem to disagree; a rescoring
    against the published scores), and two screenshot scenes (`tp53-screens`, `hsp90-rescoring`).

### Changed

- An example opened from MaveDB gives its readout (what a higher score means, from the paper) to its
  counts' drafted design too, not only to its published scores: compared, both say it.
- The readiness's *Compared with a rescoring or another assay* no longer says comparisons come
  later.
- A score table's standard errors are read from a column named in words, `standard error`, as
  DHFR's MaveDB records name it (wave 4, slice 3): their published scores now carry their SEs.
- A comparison's report possessive reads "Published scores'", not "Published scores's".
- A robustness check keeps, by id, the choices that alone account for each variant's verdict
  (`dependsOnIds`), for selections by query; its files are unchanged.
- A saved selection is listed under the map of every run of the same protein, not only its own.
- A rectangle drawn without Shift (the Rectangle drag mode) replaces the selection; with ⌘, Ctrl or
  Shift held it adds, as Shift-drag always did.
- Published scores that write a protein variant on several rows with different scores (several
  codons, or measurements, with no nucleotide names to tell them apart, as Kotler et al.'s TP53
  record does: 936 variants on 2,908 rows) were refused. Each is now read as one, merged as DiMSum
  merges a protein variant's codons: weighted by 1/SE², or averaged without SEs. The other rows are
  left out with the stage `merged`. Frameshifts written alike at a codon are left out, not told
  apart (`alike`). A comparison's report says how many were merged. Nucleotide variants on several
  rows with other scores are still refused.
- A plot's axis labelled 0 as −5.55e-17 where its ticks summed a fractional step (Hsp90's
  Bland–Altman plot): each tick is now a whole multiple of the step.
- A robustness check of a run of fewer than twenty positions said "Of the 1 least tolerant
  positions"; one position is now said as one.
- Messages that name a run, a table or an annotation whose name ends in "s" wrote "Published
  scores's"; they write "Published scores'" now (`lib/words.js`). A selection changed by an
  operation through remote control says how many variants matched and what was done.

### Validation

- `compare` validation suite (19 checks):
  - **Against R:** the statistics of seven pairs (six simulated, and DHFR's published scores
    without and with Lon) equal R's (`cor.test`, DescTools' `CCC`, BlandAltmanLeh, `lm`) to
    10⁻¹⁰; the reference, `validation/reference/compare.json`, is written by
    `generate_compare.R`.
  - **Coverage:** in 2,000 simulated pairs of known agreement of each of five kinds (30 to 1,000
    variants), the 95% intervals hold the truth 94–96% of the time. Two are weaker, and the suite
    reports them as they are: near r = 1, Spearman's (86% with 30 variants, 92% with 200); with 30
    variants on two scales, Lin's (92%).
  - **The report's rules** on GRB2: replicates; a replicate inside its run; one table scored twice;
    GRB2 moved along UniProt P62993 and matched on its coordinates; the same blocked without an
    accession; a direction stated the other way.
  - **The published examples:** BRCA1's counts against its published scores (r 0.76, correlations
    only); DHFR's Run 1 against each record (r 0.898 and 0.959); DHFR's two published score sets
    matched as R's merge matches them; BRCA1 RING's replicates sharing their input.
- The remote-control session (114 checks): `compare` on GRB2's replicates and on its runs (one table
  scored twice; two scales), each as Node compares the runs it recomputes from the archive; the
  comparison's CSV and JSON as Node writes them; a side that does not exist refused.
- Unit tests: `compare.test.mjs` (8).
- `compare` suite, slice 2 (25 checks in all):
  - **Against R:** the discordance (z, p, BH's q) and the disagreement by position of 600 variants
    at 60 positions equal R's (`pnorm`, `p.adjust`) to 10⁻¹⁰.
  - **Planted differences:** in 20 simulated pairs with 30 variants and 3 positions planted to
    differ, 96% of the planted variants are found, with 4% of calls false (BH allows 5%), and 57
    of 60 planted positions. In 10 pairs with nothing planted the dispersion is 0.86–1.11, and
    none is called.
  - **DHFR:** each difference's z is Run 1's own differential z (Enrich2's independent test);
    leaving out low confidence leaves the count this suite counts, and r rises above 0.75; the
    difference map draws every variant compared with its difference.
  - **GRB2:** its replicates' dispersion (8.2) agrees with QC's failing variance beyond counting.
- The remote-control session (116 checks): `compare` with a filter, its discordance and positions
  as Node gives them; `comparison-positions` and `comparison-map` (the difference, the second side)
  the same bytes as Node's.
- Unit tests: three more in `compare.test.mjs` (11): the filters, when discordance is tested, a
  position's three variants, and the maps of a comparison.
- `compare` suite, slice 3 (36 checks in all):
  - **Against R:** two assays of 361 variants on two scales, each rescaled by its own anchors (both
    rescalings): the anchors and their SEs, the rescaled scores, Lin's concordance, Bland–Altman,
    and each difference's and position's z, p and q with the anchors' share. GRB2's published
    scores against AlphaMissense: the 1,053 variants matched, Spearman's ρ, each class's median and
    quartiles, and the AUC with DeLong's interval (pROC). An AUC with tied scores. All to 10⁻¹⁰;
    the reference adds pROC 1.19.
  - **The anchors' uncertainty:** in 600 simulated pairs of two assays differing only in scale,
    rescaled, any variant is called in 3.5–4% of the pairs; left out of the test, in 10–55%. With
    20 differences planted, 99% are found, 4.7% of calls false.
  - **DeLong's interval** holds the AUC 94–95% of the time in 6,000 simulated pairs of classes.
  - **A score set not opened:** DHFR's −Lon record kept beside the workspace gives Run 1 the same
    comparison as the record opened. GRB2's record and AlphaMissense kept, written to the archive
    and read back, give the same comparisons.
  - **The examples:** GRB2's Run 1 against its record (r 0.997; rescaled, ρc 0.996, bias 0.009)
    and AlphaMissense (ρ 0.55, AUC 0.78). DHFR's published pair stated on one scale (ρc 0.79; 761
    of 2,277 differ, dispersion 5.3). PTEN's abundance against its phosphatase activity (ρ 0.37;
    the record's wild-type row 1 with SE 0) and against AlphaMissense (AUC 0.77; activity 0.70).
- The remote-control session (119 checks): `compare` with a score set's URN (fetched from the cache,
  kept without opening it) rescaled by the anchors, and with AlphaMissense by class, each as Node
  gives them; `comparison` and `comparison-classes` the same bytes as Node's; a scale not known
  refused.
- Unit tests: `compare.test.mjs` (15): the AUC by hand; two runs rescaled by their anchors, stated
  on one scale, or not rescaled for want of an anchor; a predictor by rank and class; a score set as
  a side and its direction stated. `providers.test.mjs`: a score set by its URN, from the cache.
- `robustness` validation suite (slice 4, 9 checks):
  - **The specifications:** the declared first, each alternative alone once, combinations of two or
    more, none twice, the same for the same seed. The declared analysis is the run to the last bit,
    and the classes equal an independent computation.
  - **Planted fragile results:** ten simulated experiments of four replicates, declared by fixed
    effects. The variants reported fragile are exactly the replicate-driven ones every time (92 of
    93 naming that replicate left out). The variants whose effect's size depends on the pseudocount
    are exactly the zero-count ones, on pseudocount 0.1 alone. The clearly lost variants are robust.
    Under MaveScape's defaults the replicate-driven effect is not called, and nothing is fragile.
  - **GRB2:** fixed effects not tried (dispersion 11.6); every alternative's ρ above 0.95; the least
    tolerant positions held within the least tolerant fifth. The files are the same bytes from a
    second check.
  - **DHFR:** 54 of its 377 differences between the conditions hold in every analysis, 172 in 90%.
- The remote-control session (122 checks): `check_robustness` and its three files as Node finds them
  for the run it recomputes from the archive; the inspector's block; too few analyses refused.
- Unit tests: `robustness.test.mjs` (5): specifications, choices, a specification's inputs, the
  classes, each verdict from hand-made analyses.
- `selections` validation suite (slice 5, 8 checks):
  - **Against an independent account:** fourteen queries on GRB2's Run 1 select the same variants,
    in the same order, as an account of each of its map's 1,176 cells read from the run's own
    arrays. The roadmap's phrases parse as written, and mistakes are named in place.
  - **Set operations:** union, intersection and difference by query equal the sets' own. De
    Morgan's laws and double negation hold. A saved selection on a second run of GRB2 holds the
    same variants.
  - **Robustness:** each verdict selects exactly the variants GRB2's check gives it. In three
    planted experiments, `fragile` and `size depends on the pseudocount` select exactly the planted
    ones, and no zero count's class depends on the pseudocount.
  - **Features:** `feature disulfide` on factor IX is UniProt P00740's 22 bonded cysteines, and
    `feature Gla` is positions 47–92.
  - **Shapes:** a rectangle drawn as a shape selects what the rectangle tool does; a circle selects
    the cells whose centers it holds.
  - **Files:** the selection's files and the archive keep its query.
- The remote-control session (123 checks): `select_variants` by query, subtracting a query's
  matches, a saved selection named in a query, the robustness verdicts, as Node selects on the run
  it recomputes from the archive; a mistake named in place; the saved selection's file with its
  query.
- Unit tests: `query.test.mjs` (5): parsing, mistakes, classes, states, positions and residues on a
  toy map, sets and their operations, features and verdicts. `map-render.test.mjs`: a freeform
  shape's cells.
- `examples` validation suite (slice 6, 52 checks): the TP53 example opened as the window opens it,
  its table MaveDB's (`mavedb-tp53-screens`, a new data set in `sources.json`; the three records and
  UniProt's P04637 in `fixtures/public-data`).
  - **TP53:** the target checked against P04637 (P72R). Kotler et al.'s 936 protein variants merged
    from 2,908 rows, and its 191 frameshifts left out, the report saying so. As published r −0.78,
    as stated 0.78 (ρ 0.72), rescaled Lin's concordance 0.78 with a bias of −0.04. Four of the eight
    positions that differ most at 180–184. Nutlin-3 against etoposide: 0.75 and 0.72. Each number as
    the guide states it.
  - **Hsp90:** against its record's own scores, r 0.95; stated on one scale, Lin's concordance 0.48,
    a bias of 0.22 and a Bland–Altman slope of −0.91, the differences largest at 585–587; one
    experiment analysed twice, so no difference is tested.
- The remote-control session (124 checks): the TP53 example opened offline, its target checked
  against UniProt, and both other screens compared by URN, the statistics and report as Node gives
  them.
- Unit tests: `score.test.mjs`: a protein variant on several rows merged (unweighted, or by 1/SE²),
  a copy among them read once, frameshifts alike left out, nucleotide variants still refused.
- **Archives that keep opening:** two workspaces saved by MaveScape 0.4.0 itself, driven through its
  remote control offline (`validation/archives/release-0.4.0-*.msz`, written by `make-0.4.0.mjs`),
  hold what a comparison rests on, which the workspace keeps (a comparison itself is the
  session's):
  - the TP53 example, its target checked against UniProt, two MaveDB score sets kept beside it
    with the directions stated (one of them with protein variants on several rows), a selection by
    query and another made from it by a set operation;
  - GRB2's SH3 domain with two runs, its record's published scores kept beside, AlphaMissense and
    UniProt's features beside the map, and selections by query: a feature's positions, an
    operation on a saved selection, and Run 1's robustness verdicts.

  The `roundtrip` suite opens them with the archives of 0.1.0 to 0.3.0, recomputes their three runs
  to their recorded output hashes, and reads their annotations' tracks again. It now also reads each
  score set kept beside a workspace again from the archive's own file, and runs each saved
  selection's query again on its run's map: it must select the same variants. A query of the
  robustness verdicts, which a later version's check may vary, must keep its variants on the map.

## 0.3.0 (2026-10-11)

Wave 3 of the [roadmap](mavescape-spec/roadmap.md): public data in and out, through a fixed list of
services that only the program contacts. A target is checked against its UniProt entry; any
published MaveDB score set opens by search or URN, its scores as published and its counts to score
again, and several of one target open together as conditions to compare. The whole of MAVE-HGVS is
read (nucleotide variants for the protein changes they make; targets from GenBank files and
transcripts); a run becomes a MaveDB deposit that MaveDB's own validators accept; annotations line
up beside the map as tracks; and there are thirteen examples. Workspaces saved by 0.1.0 and 0.2.0
open and reproduce their runs; three saved by 0.3.0 are kept for later versions to do the same.

### Added

- **Public data through one list of services (wave 3, slice 1).** The MaveScape program fetches
  public data for the page, which contacts nothing else, from a fixed list of hosts (MaveDB,
  UniProt, RCSB PDB, PDBe, AlphaFold DB, NCBI E-utilities, Ensembl, gnomAD), each with the paths
  it may be asked for, checked as every request is sent, redirects included. Requests carry
  public identifiers. Each answer is cached with its retrieval record (the service, the URL, when
  it was retrieved and last confirmed, its ETag and release), checked again after 30 days, and
  served from the cache, marked stale, when the service cannot be reached. Answers have size
  limits, applied after decompression; brief outages are retried. `--offline` serves cached copies
  only and sends nothing; `--no-fetch` switches public data off; `--cache-dir` moves the cache
  (by default `<user cache dir>/MaveScape`). A request that would send a sequence is made only
  once you have seen exactly what it sends and confirmed it, and the cache keeps its answer
  without the sequence. [`docs/NETWORK.md`](docs/NETWORK.md)
  lists every host and request and what each sends. The cache and the download, limit and serve
  parts of the fetcher are adapted from Proteoscope 0.10.0.
- **A target checked against its UniProt entry (wave 3, slice 1).** Experiment, Target: *Check
  against UniProt* fetches the entry the target's accession names and shows where the target (or
  the protein a DNA target encodes) sits in it, how it differs, and what the entry would change:
  the offset, the accession and gene, the species, the known differences. *Use these* sets them;
  either way the check is recorded with the workspace (entry, release, date and placement), shown
  in the target pane and the inspector, and named in the methods, which cite UniProt. Recording a
  check that changes nothing leaves the design and its runs as they were. A tag or linker hanging
  over an end is allowed and named; a target that fits equally well in several places keeps its
  offset; an inactive accession is reported with the entries that replaced it. A target with no
  accession can be found by its exact sequence (*Find in UniProt by sequence…*), after
  confirming that the sequence may be sent. The remote action `check_target` (with `apply`)
  does the same for scripts and sends only the accession.
- **MaveDB, opened by search or URN (wave 3, slice 2).** *Open from MaveDB* (the Start page, the
  workspace menu, ⌘K) searches MaveDB's published score sets, 100 at a time, or takes a URN or a
  MaveDB address; `mavescape urn:mavedb:…` (or `--mavedb`) opens one at start, or in the MaveScape
  already running. A record is shown before it is opened: its license and what it allows (with a
  warning for one that restricts use: CC BY-NC-SA, or the record's own terms), citation, target (with its UniProt offset), what it
  holds, the assay in MaveDB's controlled terms, and its published calibrations, each class with its
  range of scores and, for a clinical calibration, the evidence strength it assigns (as published,
  for research). Opened, it becomes a workspace: its published scores as a run of their own, its
  counts (when deposited) with a design drafted from their column names, the record kept with the
  workspace and named in the methods. The experiment's keywords give the design's readout and
  library method. Records, tables and searches are cached, so a score set opened once opens again
  offline. Remote actions `search_mavedb` and `open_mavedb`.
- **Published scores, read as published (wave 3, slice 2).** A design of model `scores` reads a
  table's scores, standard errors and 95% intervals as they were published, into a run (the model
  `published`) for the map, QC, the inspector and every export, never rescoring them. Variants the
  table gives no score, and rows repeating an earlier row's variant and scores (read once), are left
  out with their stages; classes, an exclusion list and a maximum SE can be set. *Draft the design*
  reads any table with a column of scores this way; the Experiment view names its columns of scores,
  SEs and intervals. QC judges what scores alone show (the controls' separation, the scores'
  resolution, coverage of substitutions with a score), and says the findings about counts are not
  assessed. What the analysis can do, for published scores: the map, exploration and comparison
  ready; rescoring and QC of the counts needing the counts, and where they may be found (MaveDB,
  when it keeps them; else the paper's supplement, the authors' repository, or the raw reads the
  record names).
- **An example opened from MaveDB:** PTEN's VAMP-seq abundance (urn:mavedb:00000013-a-1), scores
  alone, downloaded when opened and checked against its checksum, with its record and six
  calibrations. Ten examples now.
- **Full MAVE-HGVS, and what a nucleotide variant does to the protein (wave 3, slice 3).** Every
  form of MAVE-HGVS is read, intronic and UTR positions and names prefixed by their target
  included. Each nucleotide variant of a DNA target is applied to its sequence and both coding
  sequences translated: its class is what it does (synonymous, missense, nonsense, start or stop
  lost, an in-frame deletion, insertion, duplication or deletion-insertion, a frameshift, a
  multi-variant; a splice site, intronic, a UTR) and its protein change is named in MAVE-HGVS, as
  biocommons hgvs names it. A nucleotide library's synonymous and nonsense variants are found by
  translation; its scores export carries each variant's protein change.
- **Nucleotide runs on the map (wave 3, slice 3).** A run of nucleotide variants is drawn at the
  protein level: the variants that make the same protein change are one cell, merged as DiMSum
  merges them (each score weighted by 1/SE²; a variant changing one amino acid and leaving another
  codon synonymous left out). The inspector lists a cell's nucleotide variants, each scored, and a
  nucleotide variant's protein change. A new export, *Scores at the protein level*, writes them
  (`protein_scores.csv` from `mavescape run` too).
- **Not on the map (wave 3, slice 3).** Beside every map, the variants a map of substitutions
  cannot show (frameshifts, insertions and deletions, multi-variants, splice-site, intronic and UTR
  variants), each with its class, protein change and score, in order along the target and by class.
- **Targets from GenBank (wave 3, slice 3).** A plasmid or construct map (`.gb`, `.gbk`, `.gbff`,
  `.genbank`, `.ape`; SnapGene, Benchling, ApE and Geneious export it) or a RefSeq record makes a
  target: the coding feature is chosen when there are several, and its translation checked against
  the record's. A plasmid's target is its coding sequence on its strand (joined across introns); an
  mRNA's the whole record, numbered from its coding start, its UTRs on it. Where the target came
  from is kept with the workspace, shown in the Experiment view and the inspector, and named in the
  methods.
- **MaveDB score sets whose target is a transcript (wave 3, slice 3).** A RefSeq transcript is
  fetched from NCBI as GenBank, an Ensembl one from Ensembl (its current version, said where the
  record names another, every variant's reference base checked against it); a transcript named
  beside its protein is one target. A score set of several targets opens one, chosen, at a time,
  the others' variants set aside. A genome named as the target is not fetched, and says so.
- **MaveDB's mapped variants (wave 3, slice 3).** *Keep MaveDB's mapping to the human reference*
  fetches a record's mapped variants and keeps them beside its tables (in the archive too): the
  inspector shows each variant's HGVS on the reference, its GA4GH VRS identifier and its ClinGen
  allele; the methods cite them. `open_mavedb` takes `target` and `mapped`; `inspect_variant`
  gives `protein`, `nucleotideVariants` and `mapped`.
- **An example of nucleotide variants:** BRCA1's saturation genome editing (urn:mavedb:00000097-0-2;
  Findlay et al. 2018), opened from MaveDB with its counts, its target the RefSeq transcript fetched
  from NCBI: the map at the protein level, the splice-site variants beside it, and the deposited
  counts scored against the published scores. Eleven examples now.
- **A run as a MaveDB deposit (wave 3, slice 4).** *Deposit in MaveDB…*, in a run's Export menu,
  writes the run as MaveDB takes a score set: `scores.csv` and `counts.csv` as MaveDB's upload
  reads them (every variant in strict MAVE-HGVS on the target; a run's score, SE, 95% interval,
  replicates and status, its counts by sample; published scores passed through), what each column
  is (`score_columns.json`, `count_columns.json`), and the experiment and score set as MaveDB's API
  takes them (`experiment.json`, `score_set.json`): MaveScape's methods as the analysis, the
  design's readout and library method as the experiment's keywords in MaveDB's vocabulary (the MAVE
  minimum information's), the target as MaveDB holds one (its sequence from the coding start, or
  the RefSeq or Ensembl transcript it was fetched as, each name prefixed by it). A README says how
  to deposit it and `mavescape.json` what was written and left out. The dialog shows what the
  deposit holds and what MaveDB requires that the workspace lacks (usually an abstract), and takes
  the **MaveDB details** (title, descriptions, abstract, license, publications, raw reads,
  contributors' ORCID iDs, an experiment of yours on MaveDB, the other MAVE minimum information
  keywords), kept with the workspace and in its history. Nothing is sent: you upload it.
- **`mavescape export` (wave 3, slice 4).** `--format mavedb` writes a saved workspace's run as a
  MaveDB deposit (a folder per condition; `--details` sets the MaveDB details from a JSON file;
  `--strict` exits 1 while MaveDB's requirements are not met); `--format tables` writes its tables,
  methods and record as `mavescape run` does. `export.json` records what was read and written.
  Remote actions `mavedb_deposit` (what a deposit holds and lacks) and `set_mavedb_details`;
  `export` writes `mavedb`.
- **A MaveDB package opens (wave 3, slice 4).** A deposit's folder or ZIP (or a package written for
  MaveDB's API) opens as a record from MaveDB does: its published scores on the map, its counts with
  a drafted design, its MaveDB details kept; written again, its MaveDB files are the same bytes.
- A design's target may give its organism's NCBI Taxonomy id (`taxonomyId`), as MaveDB keeps one;
  read from MaveDB records and GenBank records' `/db_xref="taxon:…"`.
- The guide's *Depositing in MaveDB* (Exports and the record), `mavescape export` (Scripting), and
  a screenshot of the deposit dialog; the GRB2 example's guide prepares a deposit.
- **Sequence tracks beside the map (wave 3, slice 5).** Below the map, on its positions and
  moving with it, *Tracks* lines up what else is known about each position: hover a track for what
  it holds there, click it to select that position's variants (a domain's, every position it
  covers). From public data, by the target's accession or gene only: UniProt's features (domains
  and regions, sites and motifs, secondary structure), conservation from PDBe-KB's profile of the
  protein's homologues, AlphaMissense's pathogenicity of every substitution (human proteins),
  ClinVar's classifications with their review status as stars, gnomAD v4's allele frequencies
  (exomes and genomes joined), and, for a run of a MaveDB record, MaveDB's own join of ClinVar and
  gnomAD to its variants. From a file: an alignment (A3M, FASTA, Stockholm, Clustal), scored as
  Capra and Singh's `score_conservation.py` scores it (Proteoscope's `conservation.js`); a
  predictor's scores (AlphaMissense's, EVE's, ESM1b's downloads, or any table of protein variants
  and scores); a custom track (GFF3, or a table of values by position or of stretches). The run's
  own tracks (reference, coverage, position effect, uncertainty) are there to show. Each track can
  be shown, hidden, moved, filtered (features by kind; ClinVar by class and review status; gnomAD
  by frequency) or removed, and names its source: the service, release and retrieval date, or the
  file. An annotation numbered on a reference is placed by the target's offset where the target has
  the residues it names, and refused, saying why, when they disagree. Annotations are kept with the
  workspace and its archive (their files by SHA-256), so they reopen offline; the methods name and
  cite each. The inspector shows a variant's annotations; the map exports (SVG, PNG) carry the
  tracks shown, and the tracks export as a table (CSV). Annotation providers sit behind one
  interface (`web/lib/providers/`). Alignments and GFF3 files can be dropped on the window. Remote
  actions `list_tracks`, `add_track`, `set_track`, `remove_track`, `export` of `tracks`;
  `inspect_variant` gives `annotations`.
- New requests through the fetcher: UniProt's features of an entry, PDBe-KB's conservation
  profile, AlphaFold DB's AlphaMissense table, ClinVar's search and summaries (NCBI E-utilities),
  gnomAD's gene and transcript (its GraphQL API), MaveDB's annotations of a score set's variants
  (wave 3, slice 5); [`docs/NETWORK.md`](docs/NETWORK.md) lists each and what it sends.
- The guide's *Tracks* (The map) and *Annotations beside the map* (Public data), and a screenshot
  of the GRB2 example's tracks; the GRB2 example's guide adds tracks to its map.
- **Several MaveDB score sets opened together, a condition each (wave 3, slice 6).** MaveDB keeps
  each selection as a score set of its own; give several URNs at once (*Open from MaveDB*,
  `open_mavedb`) and *Open together* opens them as one workspace: each record kept, each one's
  published scores a run of their own, and their counts joined into one table on their variant
  names, each record's columns named by its URN's number, with a design drafted from their names as
  for one record but a condition each, the first the reference. Their targets must be the same
  sequence. Scored, the map compares them.
- **Two examples, thirteen in all (wave 3, slice 6).** *DHFR with and without the Lon protease*
  (Thompson et al. 2020; urn:mavedb:00000063-b-1 and -a-1): two score sets opened together, their
  counts with the paper's design (four sub-libraries, two grown in each repeat, eight time points
  over 18 hours), the map opening on +Lon − −Lon. *BRCA1 RING domain, from MaveDB and back*
  (Starita et al. 2015, scored by Enrich2; urn:mavedb:00000003-a-2): its counts rescored, every
  replicate score the published one, deposited in MaveDB's format and opened again, its scores
  exactly the run's. An example opened from MaveDB can give the design its counts need, which the
  column names do not say, and its first run.
- The guide's *Several score sets as conditions* (Public data), the two examples' pages with their
  screenshots, and tiles grown together (The experiment).
- **The Network dialog** (the status bar's *Public data*): the services MaveScape may contact,
  what it asks each, the cache's folder, and what the cache holds.
- The guide page *Public data*; the GRB2 example's guide checks its target against UniProt; a
  screenshot of the check.

### Changed

- `mavescape run` and `mavescape validate` start their private window with public data off: they
  read only the files they are given.
- A table's standard errors are found by rank: a column named `se` before `sigma`, and a standard
  deviation (`sd`) only when nothing else is there; 95% intervals (`lower_ci`, `upper_ci`…) are
  found too.
- "Precomputed scores" are called published scores.
- A DNA target's protein is its coding sequence to its first stop: a transcript's 3′ UTR is not
  translated onto the map (wave 3, slice 3).
- QC's coverage counts nucleotide variants by the protein changes they make, judges a table of
  single-base substitutions on the substitutions one base change makes, and, without tiles, names
  the stretches of the protein the variants lie in, to give as tiles (wave 3, slice 3).
- A drafted time series or set of bins sets a lone sample aside (a library counted beside day 5
  and day 11) instead of making it a replicate of one time point (wave 3, slice 3).
- The map's description, the inspector and `inspect_variant` say "as published" of published
  scores, not "from 0 of 0 replicates" (wave 3, slice 3).
- The GRB2 example's two map steps are one, so that its guide keeps six steps.
- A MaveDB record kept with the workspace keeps its abstract, publications, contributors, column
  descriptions and its experiment's texts, for a deposit of it (wave 3, slice 4). A keyword given as
  "Other" with a description reads as the description.
- MaveScape's keyword vocabulary is MaveDB's whole controlled vocabulary for experiments, as of
  2026-10-10 (one assay method added) (wave 3, slice 4).
- The program opens a MaveDB package's JSON files (`score_set.json`, `experiment.json`,
  `score_columns.json`, `count_columns.json`) with its tables, from a folder too (wave 3, slice 4).
- A run's `export` of the map (SVG) carries the tracks shown; the map's description names them
  (wave 3, slice 5). With no track shown, the map and its exports are as before.
- `conservation.js`, copied from Proteoscope, uses `dmath.js`'s log and exp, so its scores do not
  depend on the JavaScript engine (wave 3, slice 5).
- **A replicate of a tile measures only its tile's positions** (wave 3, slice 6), though its
  samples hold others' (sub-libraries grown and sequenced together, as DHFR's were): another tile's
  variants in its samples are marked *outside its tile* and are neither scored nor combined in it,
  nor compared by QC; such samples are not "shared" between the tiles' replicates, and the design's
  summary says so. Before, a variant was combined from every replicate whose samples counted it, so
  a measurement shared by two tiles' replicates counted twice. Designs whose tiles have samples of
  their own (factor IX's) score as before, the same bytes.
- The inspector and `inspect_variant` list only the replicates of a variant's tile, and say how
  many of other tiles are not listed (wave 3, slice 6).
- Conditions that share no input are compared as independent by default; they were "paired by
  their shared input", which then fell back to independent (wave 3, slice 6). The scores are the
  same; the run's parameters now say what was done.
- A drafted time series takes its unit from the time points' names when they all name one
  (`t_02hrs`: hours; `day5`: days; `gen10`: generations) (wave 3, slice 6).
- An example opened from MaveDB sets its map's view (DHFR's, on the difference) though the map is
  already shown (wave 3, slice 6).
- The BRCA1 RING validation design and data set describe the phage assay as what it measures, E3
  ubiquitin ligase activity by autoubiquitination (selected with the E2, hence "PlusE2"), not E2
  binding (wave 3, slice 6).
- A run's tracks take the identifiers its target has gained since it was scored, while the
  target's sequence and offset are the run's. A target checked against UniProt after a run gets
  its gene and accession, but that run's *Add a track* still found ClinVar and gnomAD wanting a
  gene "as UniProt's check does" (found while saving 0.3.0's archives).
- The first run scored after opening a MaveDB record is Run 1. Published scores, read rather than
  scored, are named for what they are and take no number; they made it Run 2. A run's name skips
  one already taken (a run removed since), where it could repeat one before.

### Validation

- Go tests for the fetcher: the host list (look-alike hosts, other ports, schemes and paths, user
  names, dot segments refused), nothing sent to a host not listed, redirects, size limits on
  declared, streamed and compressed answers (a 4 KB answer expanding to 4 MB stops at the limit),
  retries, revalidation by ETag, stale copies, `--offline`, `--no-fetch`, the sequence sent only
  once confirmed; `docs/NETWORK.md` lists every host and request; no script in the page names
  another origin in a request.
- `public-data` validation suite (6 checks) on UniProt's answers as the fetcher cached them
  (`validation/fixtures/public-data/`): the three published examples' targets sit exactly where
  their designs say in UniProt, and the GRB2 example's check reaches its methods.
- The remote-control session (85 checks) runs offline on those cached answers, exercises
  `check_target`, `search_mavedb` and `open_mavedb` (the published run with Node's output hash), and
  records every request the page makes: none goes beyond its own origin.
- `public-data` (15 checks) reads the feasibility records (four score sets) with no code for any of
  them: their published scores read as published equal MaveDB's columns row for row, and their
  counts get valid designs drafted from their names, GRB2's and factor IX's as documented (but for
  the bins' values, which MaveDB does not record); a workspace of published scores reopens from its archive and reproduces its run.
- `validation/mavedb-live.mjs` (15 checks; in CI) opens the feasibility records from MaveDB, live,
  through the window: the tables MaveDB sends are the ones the validation pins, the published scores
  equal MaveDB's, and the PRD's phase-0 exit holds again from the live import (GRB2 by DiMSum's model
  r 0.994; BRCA1 E2's 50,043 replicate scores reproduced to 2 × 10⁻¹⁴; factor IX with MultiSTEP's
  settings r 0.9995).
- `examples` (29 checks) opens the PTEN example from MaveDB's table, pinned in `sources.json`.
- `consequences` validation suite (8 checks; wave 3, slice 3): every nucleotide variant's protein
  change as biocommons hgvs 1.5.7 gives it, on BRCA1's, TP53's and BAP1's transcripts (16,188
  variants: every name of three published score sets and generated ones of every kind); GenBank
  records read as Biopython reads them (two RefSeq mRNAs, a plasmid, a spliced gene); every variant
  of thirteen imported tables valid on its target; all 71,005 protein names MaveScape writes strict
  MAVE-HGVS; the protein names five MaveDB records publish beside their nucleotide names the same
  protein (CBS's 22,280 written alike); VarChAMP's 28 targets opened one at a time; the merge at the
  protein level as DiMSum 1.4's own code merges CBS's 11,478 codon variants (within 5 × 10⁻¹³).
- `hgvs` (6 checks): mavehgvs's own tests against a target sequence, 54 pairs.
- `public-data` (16 checks): GRB2's mapped variants each joined to its row of scores, its protein on
  NP_002077.1 the table's at the target's position plus the UniProt offset.
- `examples` (33 checks): the BRCA1 example, its counts drafted and scored against the published
  scores (r 0.76, as its guide says).
- The remote-control session (90 checks): MaveDB's mapping of GRB2 kept and shown; BAP1's exon 1
  opened offline on Ensembl's transcript (its version said), a merged protein variant inspected,
  the scores at the protein level exported as Node writes them. Headless runs (24 checks): BAP1's
  nucleotide variants run without a window, `protein_scores.csv` as Node writes it.
  `mavedb-live.mjs` (18 checks): BRCA1's saturation genome editing and BAP1's exon 1 opened live,
  their transcripts from NCBI and Ensembl.
- `mavedb-export` validation suite (8 checks; wave 3, slice 4): MaveDB's own validators (its
  `mavedb` package 2026.2.7.4, AGPL-3.0, used only as an external reference, with mavehgvs 0.8.1
  and biocommons hgvs 1.5.7 given each transcript from the cache) on 19 deposits of every kind of
  run and target, from the examples and published records: every table accepted
  (`validate_and_standardize_dataframe_pair`, 92,253 rows), every name strict MAVE-HGVS (133,173),
  the experiment and score set accepted by MaveDB's models, or refused for exactly what MaveScape
  says is missing; each deposit read back as MaveScape opens a package and written again, the same
  bytes; MaveScape's keyword vocabulary MaveDB's. The reference records the SHA-256 of every file it
  checked (`reference/mavedb-export.json`, `generate_mavedb_export.py`).
- Go tests: no request sends a deposit to MaveDB or writes to it; `mavescape export`'s command line.
- The remote-control session (96 checks): BAP1's deposit the same bytes as Node's, opened again
  from its folder and its ZIP and written again the same; GRB2's MaveDB details set and its deposit
  written. Headless runs (29 checks): `mavescape export` twice the same bytes, as Node writes the
  deposit from the archive; `--strict`, `--details`, a folder per condition, `--format tables` the
  same bytes as `mavescape run` wrote, and wrong command lines.
- `annotations` validation suite (12 checks; wave 3, slice 5): conservation from an alignment
  (Pfam's SH3 seed with the human GRB2 SH3 first) as Capra and Singh's `score_conservation.py`
  scores it (within 5 × 10⁻¹³; `reference/annotations.json`, `generate_annotations.py`; the tool is
  GPL, used only as an external reference), and PDBe-KB's profiles as its divergence gives them
  (1,382 positions, within 4 × 10⁻¹⁶); UniProt's features the same from its JSON and its GFF3;
  AlphaMissense's every substitution of GRB2 and factor IX as AlphaFold DB's tables give it;
  ClinVar's records of GRB2 and F9 (553) read with their own classification and review status;
  gnomAD's frequencies of BRCA1's variants equal MaveDB's own join of gnomAD to its saturation
  genome editing score set (41 of 41); MaveDB's annotations joined to the BRCA1 example's run by
  accession; seven annotations kept through an archive, the same tracks; the tracks' table read
  back; what each provider asks the fetcher; and the GRB2 example as its guide says.
- Go tests: each new request asks what NETWORK.md says, is cached under its own name, and refuses
  anything but public identifiers before a byte is sent; gnomAD's GraphQL errors read as "not
  found" or refused, never cached.
- The remote-control session (105 checks): the tracks added offline from the cached answers and
  from files, shown, moved and filtered (not in the history), a variant's annotations, and the
  tracks' table and the map with its tracks the same bytes as Node's from the archive; the methods
  cite each source. Unit tests: `tracks.test.mjs`, `providers.test.mjs`, `conservation.test.mjs`.
- `examples` validation suite (46 checks; wave 3, slice 6): the two new examples opened as the
  window opens them, their tables MaveDB's as pinned (`mavedb-dhfr`, a new external data set), QC
  raising exactly the findings they list. DHFR: each replicate measures only its own sub-library
  (none combined twice), the scores against the published ones (r 0.90 and 0.96 with the defaults,
  0.96 and 0.98 with the authors' unweighted regression, on the same scale), Lon's effect as the
  paper found it (the published 736 and 384 advantageous substitutions; here about twice as many
  without Lon; 92% of the differences called negative, most at native hydrophobic residues). BRCA1
  RING: 50,055 replicate scores equal the published ones within 2 × 10⁻¹⁴ with MaveScape's
  defaults, the combined ones with the Enrich2-compatible preset (r 1.000, 6,847 scored, as
  MaveDB's); its eight zinc ligands among its twelve least tolerant positions; Run 1 deposited,
  read back with its scores exact, and written again the same bytes.
- The remote-control session (108 checks): DHFR's two score sets opened together offline, the
  drafted design a condition each in hours; its example's Run 1 with Node's output hash, the map on
  +Lon − −Lon, and Run 1 reproduced from the joined table's two files. The CI's remote job fetches
  DHFR's tables (`--require-data`). `mavedb-live.mjs` (19 checks): DHFR's two score sets opened
  together live, their tables as pinned.
- The MaveDB deposit reference regenerated with MaveDB's validators (`generate_mavedb_export.py`):
  BRCA1's saturation genome editing counts now draft in days, which its deposit says.
- **Archives that keep opening:** three workspaces saved by MaveScape 0.3.0 itself, driven
  through its remote control offline (`validation/archives/release-0.3.0-*.msz`, written by
  `make-0.3.0.mjs`; 2.5 MB together), hold what 0.3 brought:
  - GRB2's SH3 domain opened from MaveDB, with the record, its published scores, MaveDB's mapped
    variants, the counts scored, the target checked against UniProt, and seven annotations
    arranged and filtered;
  - DHFR's two score sets opened together, with their counts joined, two tiles in each sample, time
    in hours, and the conditions compared as independent;
  - BRCA1's saturation genome editing, with a RefSeq transcript as its target, nucleotide variants,
    the counts scored, and MaveDB's own annotations and gnomAD.

  The `roundtrip` suite opens them with 0.1.0's and 0.2.0's archives. It recomputes their seven runs
  from the archives' own files to their recorded output hashes and archived scores, makes every
  export again (a nucleotide run's map drawn at the protein level), and reads every annotation's
  tracks again from the archive, in the order kept. `mavescape run --from-workspace` reruns each run
  in a window to the same hash. The remote-control session (109 checks) adds a target checked after
  its run, whose tracks are then found by the gene the check gave. CI's remote job fetches BAP1's
  MaveDB table too, which the session's deposit is compared with (CI runs on pull requests, so
  wave 3's first CI run, the release's, found it missing).

## 0.2.0 (2026-10-10)

Wave 2 of the [roadmap](mavescape-spec/roadmap.md): every common experiment design, each checked
against an independent reference (time series, sorted bins, barcodes, DiMSum's error model, two
conditions), headless runs and remote control; then what the scores mean: what the assay measures,
findings in context, intervals that hold the truth, what each analysis can do with what is there,
and nine examples. A workspace saved by 0.1.0 opens and reproduces its runs; one saved by 0.2.0 is
kept for later versions to do the same.

### Added

- **Remote control (wave 2, slice 1).** `mavescape --remote-control` lets programs on this computer
  drive the open window through `/api/remote/action`: `get_state`, `new_workspace`,
  `open_example`, `open_files`, `set_mode`, `focus`, `draft_design`, `set_design`, `score`,
  `qc_findings`, `select_variants`, `inspect_variant`, `render_map` and `export` (scores, counts,
  QC, provenance, methods, references, the map, a selection or the workspace archive). Each action
  happens in the window, its changes go into the history and can be undone; names are forgiving, and a wrong
  one is answered with the choices. `GET /api/remote/tools` lists the actions with their arguments.
  MaveScape writes its address and a token to `remote.json` in its data folder (readable by its
  owner only, removed on exit); reading and writing files needs the token. Only programs on this
  computer, never other web pages, can send actions. The hub, the connection file and the export
  writer are ported from CytoWeave 0.8.0.
- **Screenshots captured through remote control.** `docs/capture/capture.mjs` builds MaveScape,
  runs each scene on an empty library in headless Chrome by remote actions, and writes it in the
  light and dark themes to `docs/images/` (optionally auditing each with axe-core). Ten scenes: the
  start page, import, the design and its draft, scoring, QC, the map, a saved selection, the map by
  standard error, and the exports.
- **The website** (`docs/site/`, published on GitHub Pages from the `gh-pages` branch): home,
  install, science (the validation, with its numbers) and a guide of eleven pages (getting started,
  the examples, opening your data, the design, scoring, QC, the map and the inspector, the record,
  scripting, troubleshooting), with the screenshots in both themes. The build checks every link,
  anchor and screenshot. The README shows the map's screenshot.
- **The import wizard accepts what it detected** when asked (remote control's `open_files`), and
  leaves the wizard open for review otherwise.
- **Time series scored by regression (wave 2, slice 2).** A time series of three or more time
  points is scored by default from every time point: each variant's score is the slope of its
  normalized log count on time scaled to 0–1, by weighted least squares as Enrich2 computes it
  (ordinary least squares and the log ratio of the first and last samples are the other choices),
  on unevenly spaced times. A variant is fitted on the time points where it was counted, at least
  three with the first among them; fewer than the replicate has are flagged low confidence. The
  slope's SE is scaled by the residuals and, by default, never below what counting alone predicts;
  the Enrich2-compatible preset keeps Enrich2's. Equal to Enrich2 2.0.2's WLS and OLS to
  5 × 10⁻¹³ on BRCA1's two assays and a new time-series fixture, and to statsmodels to 5 × 10⁻¹⁴.
- **Time-series quality control:** "Time points used" and "Fit of the time courses" (how far the
  time courses scatter about their lines against counting noise), with plots; the variant inspector
  draws each replicate's time course and its fitted line.
- **"Missing = 0"** per sample in the Experiment view (`missingMeansZero` in the design), for tables
  that write variants that dropped out during selection as missing; scoring and QC read the counts
  the same way, and the run records it.
- **A third example: a simulated time series** with known effects (five times over eight
  generations), and time series in the simulator, with an optional bottleneck at every passage.
- **Sorted bins (FACS) scored (wave 2, slice 3)** by the weighted average of the bins' values
  (VAMP-seq), with an analytic or seeded-bootstrap SE, or by the censored log-normal
  maximum-likelihood fit from the bins' gates (Peterman and Levine 2016), reads reweighted by the
  cells sorted into each bin. Each replicate is scaled so that nonsense scores 0 and the wild type 1
  (VAMP-seq), or the median of its lowest 5% 0 (MultiSTEP). A VAMP-seq preset and the mean of
  replicates (SE = SD/√k). Factor IX's published scores are reproduced from its counts to
  10⁻¹⁵, and the maximum-likelihood fits equal fitdistrplus's to 3 × 10⁻⁷.
- **The design records each bin's gates and the cells sorted into it**, edited in the Experiment
  view.
- **Sorted-bin quality control:** "Occupancy of the bins" and "Cells sorted per variant", and
  replicate agreement, variance beyond counting and outlier replicates from the bins' weighted
  averages, replicates compared within their tile. The inspector shows a variant's distribution
  over the bins beside the wild type's.
- **A fourth example: a simulated sort-seq experiment** with gates, cells and known shifts.
- **Tables of barcodes (wave 2, slice 4).** A count table whose rows are barcodes, opened with the
  barcode-to-variant map that names each barcode's variant: MAVE-HGVS or lab names, dms_variants'
  substitutions, or whole variant sequences (Enrich2's map) named against the target. A barcode the
  map gives two different variants is left unmapped and listed, never resolved by guessing. The
  design names the column of barcodes (`library.barcodeColumn`); the source keeps the counts, the
  map and how they were put together, and assembles them again whenever it is read.
- **Barcodes scored two ways:** summed per variant, then scored (Enrich2; dms_variants by
  substitution), or each barcode scored against its replicate's normalizers (dms_variants by
  barcode) and a variant's barcodes combined within the replicate by REML, fixed effects or their
  mean. Every barcode is compared with its variant's others (its departure over √φ, φ being how much
  more a replicate's barcodes disagree than counting explains), and outliers are found one at a
  time. Two filters: a minimum of barcodes per variant, and the barcode filter, which leaves
  outliers out. Equal to dms_variants 1.6.0's `func_scores` by barcode and by substitution to
  5 × 10⁻¹³. The inspector lists a variant's barcodes in each replicate; a run's barcodes export
  one by one (CSV).
- **Barcode quality control:** "Barcodes the map names", "Barcodes per variant", "Agreement of a
  variant's barcodes" (φ and the split-half r) and "Outlier barcodes", with plots.
- **More layouts recognized at import (D12):** dms_variants' `variant_counts` (made one row per
  library and barcode, a count column per library and sample) and Enrich2's counts files (one per
  sample, its elements named in MAVE-HGVS, or barcodes with its map).
- **A fifth example: a simulated barcoded library** with a map in conflict and outlier barcodes.
- **A million rows (D9, S12).** `validation/bench.mjs` imports a million-barcode table and its
  million-line map in 3.5 s (budget 15 s, the process at most 830 MB of a 1 GB budget) and scores
  it in 1.3 s; `validation/browser-bench.mjs` does the same in the window in headless Chrome (3–4 s,
  the browser's memory up by about 600 MB at most). Both run in CI.
- **DiMSum's fitness and error model (wave 2, slice 5; S9).** For an input and an output,
  *Scored by* offers DiMSum's model (Faure et al. 2020), as DiMSum 1.4 computes it: fitness with
  no pseudocount (an optional dropout pseudocount for outputs of 0), each replicate scaled and
  shifted to agree with the others, and an error model with a multiplicative term for each input
  and output and an additive term per replicate, carried into every variant's SE; replicates are
  merged by inverse variance. The error model is linear in its terms, so MaveScape fits it exactly
  on every variant (bounded least squares) where DiMSum averages 100 nonlinear fits of bootstrap
  samples, and reports the 10th–90th percentiles of a seeded bootstrap. A DiMSum-compatible
  preset; the run lists each replicate's scale, shift and terms, and its methods give them.
  Against DiMSum 1.4's own functions on GRB2, DiMSum's demo and a fixture: the same threshold and
  variants fitted, the scales and shifts within 5 × 10⁻⁷, the error model within 5 × 10⁻⁶ of
  DiMSum's own fit on every variant and inside its percentiles, and every fitness, σ and merged
  score within 10⁻¹² given DiMSum's parameters. On simulated bottlenecks, its 95% intervals hold
  the true effects 93–96% of the time (counting alone, 67–69%).
- **Where the bottleneck is (Q4).** "Variance beyond counting" fits DiMSum's error model to the
  counts and says whether the excess is before selection or after it, with a plot of the terms.
  The GRB2 example now shows its bottleneck at the inputs (20–38× counting) and scores with the
  DiMSum-compatible preset in its guide.
- **Remote control's `score` takes the `dimsum` preset** and returns each replicate's fitted model.
- **Two conditions compared (wave 2, slice 6; S10).** With two or more conditions, each condition
  is compared with the reference: every variant measured in both gets a differential score with its
  SE, 95% interval, p and Benjamini–Hochberg q. Three methods, under *Conditions compared by*:
  limma's moderated t on voom log counts with a term for each input library and for selection in
  each condition, as mutscan's `calculateRelativeFC` computes it (the default where it applies:
  two populations, relative to the wild type or the synonymous variants, with residual degrees of
  freedom); replicates paired by their shared input, whose counting error cancels from each pair's
  difference; and the conditions as independent (Enrich2's z, the Enrich2-compatible preset's).
  limma's statistics (`web/lib/limma.js`, `web/lib/distributions.js`) are written from the
  publications, not from limma's source (GPL). Equal to mutscan 1.2.0 within 2 × 10⁻¹⁰ on a
  two-condition fixture and on CBS at two vitamin B6 levels (MaveDB, four shared inputs), and to
  Enrich2 2.0.2's z between conditions within 5 × 10⁻¹³. Runs made before keep their output
  hashes: the differential enters a run only when its parameters ask for it.
- **The differential on the map and in the inspector (V2):** *Color by* differential score, centered
  on no difference, a variant without one shown filtered with why; the inspector gives a variant's
  score in each condition and each difference with its interval and q (paired, each pair's too).
  The Score view's *Between conditions* pane: how each comparison was made, how many variants
  differ, a volcano plot and the largest differences. A run's differential scores export as CSV,
  and its methods describe the comparison with its references.
- **A sixth example: a simulated two-condition experiment** (one input selected without and with a
  ligand; a binding site that matters only with it), opening on its differential map; and two
  conditions in the simulator.
- **Remote control:** `score` summarizes each comparison, `inspect_variant` gives a variant's
  differences, `render_map` colors by the differential (`contrast` chooses one), `export` writes
  `differential`.
- **Headless runs (wave 2, slice 7; M1).** `mavescape run --design design.json --out results/
  counts.csv` scores without a window, in a headless Chrome on a private port: it checks the table,
  the design and the parameters first and scores nothing when anything blocks scoring, then writes
  the scores (a file per condition), counts, QC, differential scores, barcodes, the map, the
  provenance, methods and references, the workspace archive and `run.json` (the inputs and outputs
  with SHA-256, each step, the run and its QC). `--time` or SOURCE_DATE_EPOCH: every file the same
  bytes for the same inputs. `--from-workspace` reruns a saved run and fails unless it reproduces.
  `--log json`, `--strict`, `--overwrite`; exit status 0, 1 (not done, or a blocking problem) or 2
  (a wrong command line). Checked by `validation/headless-run.mjs` in CI.
- **`mavescape validate` (M2):** tables, a design and parameters checked as scoring would; exit 1
  with what blocks scoring; `--json`.
- **Remote control:** `check` (what would block scoring) and `reproduce_run` (a saved run recomputed
  and checked against its output hash).
- **What the assay measures (wave 2, slice 8; E7).** The design's `readout` records what was
  measured, its direction (a higher score means more of the function, less of it, or a larger
  change with no sign) and the assay's method, mechanism and model system, in MaveDB's controlled
  keywords. `library.method` says how the library was made. In the Experiment view, *What the assay
  measures* edits them and the controls. The design's summary, the methods and the exports carry
  the readout; until its direction is stated, MaveScape takes a higher score to mean more of the
  function and says so. The bundled examples state theirs.
- **Controls that fit the assay:** each control class can be limited to the positions where it
  serves (`controls.positions`) with why it is a control (`controls.why`); normalization,
  rescaling and QC use the limits.
- **Findings in context (Q11).** Every QC finding to review or failing says what could cause it (in
  the experiment, in the analysis, or expected from the library or assay) and what to do next (a
  plot to look at, an analysis choice, or what needs another experiment); one not assessed says
  what it needs. The separation of the controls reads the readout's direction, says when the
  nonsense variants score on the other side, and finds where late stops stop losing the function
  (position 93 in BRCA1's Y2H assay) to suggest limiting the controls. Coverage of a library made
  by error-prone PCR or doped oligos is judged against the substitutions one base change makes.
- **Acknowledging a finding:** *Acknowledge…* in the QC view, `acknowledge_finding` by remote
  control, and `mavescape run --acknowledge id=reason` record why a finding is expected here. The
  finding keeps its status; the reason goes into the history, the methods, the provenance, and the
  new `qc_findings.csv` export of every finding with its causes, next steps and acknowledgement.
- **Archives that keep opening:** a workspace saved by MaveScape 0.1.0 is kept as a fixture
  (`validation/archives/`); this version opens it and reproduces its runs, and each release adds
  one. 0.2.0's (`release-0.2.0.msz`) holds every kind of source and run 0.2 brought (barcodes with
  their map, sorted bins, two conditions, codon variants per generation, DiMSum's model, the
  moderated combination), and the replay assembles each run's source as the window does.
- **Intervals that hold the truth (wave 2, slice 9; S13).** A new way to combine replicates, the
  *moderated combination*, learns the noise beyond counting from every variant at once: a replicate
  score's variance is *a* × counting + *b*, fitted robustly to how far replicates disagree (as
  DiMSum's error model), with the reference's shared shift measured apart, and each variant's own
  dispersion moderated toward the others' by empirical Bayes (as limma moderates variances). Its
  95% intervals use t at each score's degrees of freedom (Satterthwaite's, when the reference's
  shift counts); the inspector shows them. Replicates that share a sample (one input selected
  several times, one time-0 sample) are combined by generalized least squares with its covariance,
  so the shared sample is counted once. The run's notes and methods give the fitted model.
- **The rescaling anchors' uncertainty (S11):** rescaled scores report the anchors' own error, which
  moves every score together, apart from each score's SE (`SE_scale`, by the delta method), in the
  inspector, the scores export and the methods.
- **Scores export:** `df` and `SE_scale` columns; `ci95_lower` and `ci95_upper` use t at `df`.
- **The coverage suite** (`validation/coverage.mjs`, in CI): 40 simulated experiments of each of 26
  kinds, from 30 to 2,000 reads per variant, two to six replicates, bottlenecks, selection noise,
  shared inputs, overdispersed reads, time series, sorted bins, barcodes, DiMSum's fitness, rescaled
  and differential scores. With the defaults, 95% intervals hold the truth 93.6–96.5% of the time in
  every kind (REML 81.8–95.5%); on dms_variants' simulated libraries, an independent simulator,
  94–98% (REML 83–86%); on real data, each replicate held out and predicted from the others, GRB2
  6.1% and CBS 5.6% beyond ±1.96 SD (REML 22.6% and 3.5%), factor IX 10.0% (26.3%) and BRCA1 12.3%
  (17.7%). It names what no variance fixes: a time course that is not a line, scored by its slope
  (QC flags it); variants depleted to a few reads, biased by the pseudocount; replicates selected
  with different strengths (BRCA1's).
- **The simulator** can share one input sample between replicates, draw overdispersed reads
  (gamma-Poisson) and run a time course that saturates; its defaults and the bundled examples are
  unchanged.
- **What the analysis can do (wave 2, slice 10; E8).** For the open workspace, every analysis the
  design allows (each way of scoring, normalizing and rescaling, combining replicates, differential
  scores, each QC finding, the record and what a MaveDB deposit needs) is ready, partial or not
  possible, with why. What is missing says why it matters, where it is usually found (the
  protocol, the bench, the counting pipeline) and where to give it. It is in the Experiment view
  (*What the analysis can do*, with *Give it*), the workflow strip, the Start page's *What to
  bring*, `mavescape validate` (in words, and `readiness` with `--json`) and the methods, which name
  what was not recorded and what that meant. Nothing is filled in by guessing.
- **The analysis package:** *Write the analysis package* (the Experiment view, a run's export menu,
  `export` `what: "package"`) writes one ZIP: the count table as imported, the target, the design,
  the design as a sample sheet, the parameters, the readiness, and a README with the
  `mavescape run` command. These are the files `mavescape run` reads; scored from a run's package
  alone, they give that run's output hash.
- **The cells recorded check the bottleneck:** with the cells carried into selection recorded on
  each input (and those recovered after it on each output; the Experiment view's Cells column now
  shows for two populations), the variance-beyond-counting finding says whether they account for
  the bottleneck the replicates imply, or the replicates show more (another step, or noise between
  replicates) or less (check the cells recorded).
- **Scores per generation:** *A score is the change* per unit of time (`timeScale: "unit"`) gives a
  time series' slope on time itself, per generation with the times in generations: a selection
  coefficient, comparable between experiments of different lengths. Enrich2's whole time course
  stays the default.
- **Three more examples (wave 2, slice 11), nine in all:** Hsp90 over 21 generations (MaveDB
  urn:mavedb:00000011-a-1, scored per generation, one replicate), coagulation factor IX in sorted
  bins (urn:mavedb:00001200-a-1, MultiSTEP), both with MaveDB's counts unchanged, and a simulated
  experiment with two problems to find (a recorded bottleneck and a failing replicate). Each has
  its question, readout, readiness, the QC findings it teaches and a guided workflow; the guide
  compares every run of a simulated example with the truth.
- **Codon variants read at the protein level:** *Each row is: a codon variant* in the import
  wizard reads a table that names each codon on its own row (MaveDB's EMPIRIC tables) at the
  protein level: each row's protein change worked out from its nucleotide name against the target,
  a variant written on several rows with the same counts read once, and each protein variant's
  codons summed. A design naming `hgvs_pro (from hgvs_nt)` reads its table this way wherever it is
  opened, `mavescape run` included.
- **Sample sheets written back:** the package writes the design as a sample sheet that reads as the
  same design; a sample selected under several conditions is one row naming them
  (`Without ligand;With ligand`), which sheets now read.

### Changed

- **The README and the guide say what a MAVE is:** a multiplexed assay of variant effect, from the
  bench to counts to MaveScape (and optionally MaveDB), and what MaveScape needs to begin.
- **The roadmap, after a researcher's review.** Wave 2 gains three slices before its examples. The
  first records what the assay measures, so legends and QC stop assuming a direction; QC findings
  say what to do next and can be acknowledged with a reason. The second tests whether the
  intervals hold the truth as often as they claim: with three replicates, the simulations so far
  put 95% intervals at 87–90%. The third shows what an analysis can do with what the researcher
  has, and what is missing and where to find it. Outside laboratories no longer gate any wave or
  release. Comparison and robustness to analysis choices move ahead of structure (0.4 and 0.5).
  Each release keeps a workspace archive that later versions must reopen and reproduce.

- **Replicates are combined by the moderated combination by default** (MaveScape 0.1 used REML).
  REML estimates each variant's noise between replicates from its own two to six scores; often 0
  by chance, it left intervals too narrow (as little as 82% coverage where 95% was claimed). Runs
  keep their parameters, so earlier runs are unchanged and reproduce; score again to use it. REML
  and the others remain choices. Replicates paired by a shared input are combined the same way, so
  their differential scores have t statistics (`t_` in the differential export, in place of `z_`).
- **The shared-samples warning** is a note when the moderated combination accounts for the shared
  sample, and with the other combinations points to it.

- **The map's legend names its ends from the readout** ("blue is less function, red more
  function") and says "lower" and "higher" until the direction is stated; the palettes are named by
  their colors only.
- **`mavescape run --strict` fails on a failing QC finding that is not acknowledged.**

- **Records take their time from a session clock** (`web/lib/clock.js`), the wall clock in a window;
  a headless run with a fixed time makes them, and their identifiers, the same every time.

- **Tables are held column by column, a column of numbers as numbers only** (its text is not kept;
  `cellText` gives it back): a million rows take about 85 MB once read, not 500 MB, and are read in
  about a second.
- **Workers end when they have nothing more to do**, so that what a large table or run left in
  their memory is released.
- **Synonymous variants named from whole sequences** (DiMSum's, Enrich2's maps) are named by the
  codons changed (`p.Ala2=`), not `p.(=)`.
- **A time series is scored by weighted regression by default** (it was the log ratio of its first
  and last samples). Runs keep their parameters, so earlier runs are unchanged; score again to use
  every time point.

### Fixed

- **The moderated combination understated the SEs of a single replicate** (0.2 development):
  with no pairs of replicates to fit its model, it fell back to counting error alone, so a time
  series' slopes lost the scatter of their own residuals (Hsp90's SEs a median 6.3× too small).
  With no model to fit, each score keeps its own SE, as with the other combinations.
- **DiMSum's model on a table of barcodes** (summed, which is allowed) failed after scoring, reading
  barcode counts its replicates do not keep.
- **Sorted bins without the wild type were refused by default**: both scales need it. They now
  start unscaled (an MLE's σ each variant's own), and with the nonsense controls named none, at the
  lowest 5%.
- **The separation of the controls used every nonsense variant**, even where the design named others
  or none; it now uses the design's controls, as scoring does.
- **A validation note called BRCA1's library error-prone PCR**, but it holds 71% of the
  substitutions two or three bases from the wild-type codon, which such a library rarely makes; the
  note no longer says how it was made.

- **Enrich2's estimator with several conditions** started, in MaveScape, from the variance over the
  variants scored in every replicate of that condition; Enrich2 starts every condition from its
  table of variants scored in every replicate of at least one condition. Enrich2-compatible runs of
  designs with conditions now equal Enrich2's (they differed by up to 1.5 × 10⁻⁵).
- **"Samples shared between replicates"** was raised for an input selected under two conditions,
  which does not make one condition's replicates dependent; it is now raised only for samples
  shared within a condition.
- **A table joined from several files, or named from DiMSum's sequences, could not be read again
  from the library** (it had to be opened again): the source's files are now assembled again as at
  import.
- **Scores depended on the browser.** JavaScript's `Math.log` and `Math.exp` differ in their last
  bit between engines and their versions (Chrome 154 and Node 22 on about 2% of logarithms), so a
  run's output hash depended on the browser that scored it, and a saved run could stop reproducing
  after a browser update. Scoring, QC, statistics and simulation now use `web/lib/dmath.js`
  (fdlibm's logarithm and exponential in plain arithmetic): within one unit in the last place of
  the engines' functions, and the same bits everywhere. The scoring engine's version is now 2; runs
  made by 0.1.0 reopen with scores that differ only in their last digits, and say why.

## 0.1.0 (2026-10-09)

MaveScape's first release, wave 1 of the [roadmap](mavescape-spec/roadmap.md): from a
two-population count table to QC, scores checked against Enrich2, an interactive variant-effect
map and a saved, reproducible record.

### Added

- **The program and its window (wave 1, slice 1).** One self-contained program (`mavescape`) for
  macOS, Linux and Windows, x64 and ARM64, that serves its embedded web app on 127.0.0.1 (port
  8820, or the next free one) and opens it in a desktop window. A second launch hands its files to
  the open window. The host, its security (Host-header check against DNS rebinding, same-origin
  API, Content-Security-Policy, cross-origin isolation) and its content-addressed workspace
  library are adapted from CytoWeave 0.8.0; the web app also runs from any static web server, with
  the library in the browser.
- **The workbench shell.** Views in the order of an analysis (Start, Experiment, QC, Score, Map;
  each says what it will do until it is built), a dataset tree, an inspector, a bottom drawer with
  the history of the analysis and the session's log, a status bar, the command palette (⌘K), undo
  and redo, light and dark themes and color-vision-friendly colors.
- **The build commit** in the status bar and `/api/info`: release builds embed it, other builds
  take Go's version-control stamp.
- **Installers** (`install.sh`, `install.ps1`) that check the download's SHA-256 and version, and a
  release workflow that builds six binaries with their checksums.

- **The experiment design (wave 1, slice 2).** A versioned schema (`mavescape-design` v1,
  `docs/schemas/design.v1.json`) and `web/lib/design.js`, which checks a design against its table
  and describes it in plain language. One schema represents two-population, time-series, FACS-bin
  and score-only experiments, samples shared between replicates, tiled libraries (overlapping too),
  several experiments in one table and known differences between a construct and its reference.
  Every column of a table is a sample's or set aside with a reason: none is dropped silently.

- **Import (wave 1, slice 3).** Open count or score tables (CSV or TSV, gzip too; per-sample
  files together) and the target's FASTA. The import wizard says what it found (layout, rows,
  delimiter, line ends, encoding), lets you choose the variant names and the count columns,
  suggests each column's role from its name (input, output, time, bin, tile, replicate; shown,
  never applied), checks every variant name against the target and lists, by line, every problem
  that blocks scoring: the same variant on two rows (however written), counts that are not numbers
  or are negative, rows of the wrong width. Missing counts are never read as 0. Tables are kept in
  the library by SHA-256; a mapping can be saved as a template. MaveDB's tables, DiMSum's (whose
  variants are whole sequences, named against the wild type) and generic tables are recognized.
- **MAVE-HGVS** (`web/lib/hgvs.js`): the whole grammar, agreeing with mavehgvs 0.8.1 on every one of
  16,959 test strings, and a lenient mode for lab and legacy names (A12V, `_wt`, `p.Ala12*`,
  repeated or unsorted components), which keeps the original beside the canonical name.

- **The Experiment view (wave 1, slice 4).** Say what each column of the counts is: a sample, a
  technical replicate of one (summed), a copy of a shared sample's column, or not used (and why);
  and each replicate's samples: input and output, each time, or each bin, with conditions, tiles,
  controls and the target's offset and identifiers. A design starts from MaveScape's draft from the
  column names, or from a sample sheet (one row per sample: column, role, replicate, condition,
  time or bin, tile, batch; DiMSum's experiment design file works as one), and is checked and
  described in plain language as you edit. Designs export and open as `*.design.json`.
- **A history that cannot be rewritten quietly.** Every material change (an import, a target, the
  design) is written to the workspace's history, each entry chained to the one before by SHA-256;
  the drawer lists it and says whether the chain holds.

- **Scoring (wave 1, slice 5).** The Score view turns the counts and the design into functional
  scores with standard errors: log ratios normalized to the wild type, complete cases, all reads
  or the synonymous median, with a pseudocount; technical replicates summed, biological
  replicates scored separately and combined by REML random effects, fixed effects or Enrich2's own
  estimator (an "Enrich2-compatible" preset reproduces Enrich2 2.0.2's numbers); heterogeneity
  (Q, I², τ²) and leave-one-replicate-out sensitivity for every variant; optional rescaling
  (nonsense 0 and wild type 1; synonymous 0 and nonsense −1). Filters are ordered and visible (a
  filter bar and the filter flow), and a filtered variant keeps its counts and replicate scores
  with the stage that left it out; nothing unscored is shown as 0. Conditions are scored apart.
  Scoring runs in a worker, with progress and cancel.
- **Runs that can be repeated.** Each run is kept unchanged with its table's SHA-256, the design,
  the parameters, the software version and the hash of its output; the same inputs always make
  the same run. Reopened, a run is recomputed and checked against its output hash. The run says in
  sentences how its scores were made.
- **Drafts that keep experiments apart.** A table holding two assays (BRCA1's E2 binding and
  yeast two-hybrid) drafts into two conditions instead of one experiment.

- **Quality control (wave 1, slice 6).** The QC view says whether the experiment supports
  reliable scores, finding by finding: every sample has counts (blocking when not), sequencing
  depth, low counts before selection, missing counts, variants missing after selection (a table
  that writes dropouts as missing), coverage of the designed substitutions (a grid by position),
  replicate agreement, variance beyond counting (a bottleneck), outlier replicates, and from a
  score run the separation of the controls, the resolution of the scores and the variants
  scored. Each says pass, review, fail or not assessed (and why), with what it found in numbers,
  its threshold and rationale, what it concerns and its plot; the overall status is shown beside
  the list. QC runs from the counts alone, before scoring, or of any score run. Thresholds can be
  changed, and each change goes into the history.
- **Simulated experiments** (`web/lib/simulate.js`): a library, bottlenecks, selection with
  replicate noise and sequencing, seeded and labeled simulated.

- **The variant-effect map (wave 1, slice 7).** Positions across, the 20 amino acids and stop
  down, colored by score (blue for loss, red for gain, or purple and orange; white is the wild
  type), or by SE, replicates used or input count. Missing, filtered, low-confidence and
  not-designed cells are each drawn their own way, never in the wild type's color; reference
  residues are outlined and hold the synonymous variant. The median of each position is shown
  above and of each substitution at the right, with target and reference numbering and an
  overview of the whole target. Pan, zoom, hover; click, ⌘-click and Shift-drag to select; the
  keyboard moves through the cells and announces each. Selections can be saved by name. The map
  exports as SVG and PNG, is described in words, and lists every cell in a table.
- **The variant inspector.** A variant chosen on the map, in its table or in the Score view shows
  its identifiers as written and canonical, its score with SE and 95% interval (or why it has
  none), its flags, each replicate's counts and score, every sample's counts, the other
  substitutions at its position, the sequence around it and the run it comes from.

- **The workspace archive (`.msz`, wave 1, slice 8).** One file with everything needed to reopen
  an analysis on another computer: the workspace (targets, design, score runs, selections, QC
  thresholds, the chained history), each run's scores, the methods with references, and the
  tables (or only their checksums). Saved, reopened and saved again it has the same bytes; opened,
  every file is checked against the manifest's SHA-256 and the history's chain, and anything that
  does not hold is reported. Workspace menu → Export.
- **Exports.** From a run's Export menu: scores and the counts it scored, in MaveDB's columns (they
  import again without loss, and MaveDB's upload layout is now recognized at import); QC per
  sample and per variant; the run's provenance as JSON; the methods paragraph, written from what
  the run did, with numbered references and their BibTeX. From the map: the selected variants as
  CSV or JSON.
- **Examples.** Two on the Start page, each opened as a new workspace with a first score run and a
  guide in the inspector (its question, steps, what to expect, source and license): the **GRB2
  SH3 domain** (the Human Domainome's CC0 counts from MaveDB) and **a simulated experiment** whose
  true effects are known (and compared with its scores). Simulated data are labeled as such.
- **Blank layouts and `docs/FORMATS.md`.** Annotated count table, sample sheet and target FASTA to
  fill in, from the Start page; every file MaveScape reads and writes, described.

- **The workflow strip.** Above every view, the analysis as steps (counts, target, design, score,
  QC, map, record), each done, next, needing attention or still to do, and the next step said in
  words with its button: "Draft the design" drafts it in one click. It says what is wrong when a
  step is blocked: a table of scores rather than counts, problems that block scoring, a design to
  fix, a design changed since the last run, a FASTA opened without its count table.
- Starting MaveScape while one is already running now says which files were handed to it and
  where to find its window.

### Validation

- Go tests of the host: security headers, foreign Host headers and cross-origin requests refused,
  the library's round trips, files stored under the hash the program computes, range requests,
  folders opened in natural order, every web module embedded.
- `node --test` of the shared modules (seeded random numbers against FNV-1a test vectors and
  their moments, SHA-256, ZIP, color-vision simulation, the workspace document).
- `validation/run.mjs accessibility`: every text-on-surface pair of both themes, with
  color-vision-friendly colors off and on, at WCAG AA contrast (lowest 4.58:1); the palettes and
  status colors apart in protanopia, deuteranopia and tritanopia; the diverging score maps' two
  ends apart in every vision.
- `validation/run.mjs designs` (wave 1, slice 2): three public MaveDB data sets of different
  designs (GRB2 SH3, two populations; BRCA1 RING, time series with shared inputs and a second assay
  in the same table; factor IX, FACS bins in overlapping tiles), downloaded and checksummed by
  `validation/fetch.mjs`, each described by a design written as data, with no code for any of them;
  every design satisfies the schema and agrees with its data (37 checks).
- `validation/run.mjs enrich2`: reference scores from Enrich2 2.0.2 (`validation/reference/`,
  generated from MaveScape's designs) equal the scoring formulas MaveScape will use, computed
  independently, to 5 × 10⁻¹³; Enrich2 2.0.2 reproduces the BRCA1 replicate scores published in 2017
  to the same precision, which confirms their method (19 checks).
- `validation/run.mjs hgvs` (wave 1, slice 3): the MAVE-HGVS parser against mavehgvs 0.8.1 on
  16,959 strings: the same decision, reason, canonical form and parts for every one.
- `validation/run.mjs import`: the four feasibility tables import with every variant name valid
  against its target; 13,757 legacy BRCA1 names read leniently; designs drafted from column names
  have the hand-written designs' shape; shuffled rows and columns, text read in parts and per-sample
  files joined give the same counts; DiMSum's demo is named against its wild type; a fixture with
  one problem of each kind raises exactly those, on their lines (29 checks).
- `validation/run.mjs experiment` (wave 1, slice 4): each feasibility design rebuilt with the
  editor's operations alone says what the hand-written one says; sample sheets for GRB2, BRCA1 and
  factor IX, and DiMSum's own design file, give the same samples and slots; a workspace's history
  survives saving and reopening, and an entry edited afterward is caught (12 checks).
- `validation/run.mjs scoring` (wave 1, slice 5): the scoring engine equals Enrich2 2.0.2 replicate
  by replicate and combined (GRB2 with three normalizations, BRCA1 E2, a synthetic fixture), and
  dms_variants 1.6.0's `func_scores`, to 5 × 10⁻¹³; its REML equals metafor 5.2-1 to 3.4 × 10⁻¹²;
  each of the PRD's two-population edge cases, planted in the fixture, behaves as specified;
  scores are deterministic, independent of row and column order, and reproduced from a saved
  workspace (46 checks).
- `validation/run.mjs qc` (wave 1, slice 6): simulated experiments with one problem each (poor
  replicate agreement, a failing replicate, a severe bottleneck, a low-count tail, a missing
  sample) raise exactly their findings on three seeds, and a clean one none; the variance check
  follows a simulated bottleneck; findings do not depend on row order or on a run; the
  feasibility data's findings as found (15 checks).
- `validation/run.mjs map` (wave 1, slice 7): the map's SVG against a golden file, each state where
  it is planted, state colors apart from the neutral color in every theme, the scale centered on
  the wild type, and on BRCA1 the zinc ligands as the least tolerant positions (9 checks).
  `validation/bench.mjs`: 105,000 variants scored, mapped and drawn within budget.
- `validation/run.mjs roundtrip` (wave 1, slice 8): workspaces saved as archives, reopened and
  saved again give the same bytes, and every export the same bytes; exported scores and counts
  import again without loss; tampered, hostile and foreign archives are caught; the examples and
  layouts are what they say (25 checks).
