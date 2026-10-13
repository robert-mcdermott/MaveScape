# R and Python clients

MaveScape started with `mavescape --remote-control` accepts actions from programs on this
computer: every action an AI agent has (open count and score tables, describe the experiment's
design, score, read the QC, select variants, compare runs and score sets, make figures, certify,
export files) is performed by the open MaveScape window, so you watch the script work and every
change goes into the workspace's history. A script's changes apply as yours do; an AI agent's are
proposals ([docs/MCP.md](../docs/MCP.md)).

These packages make each action a function, with its arguments and help:

| | R | Python |
| --- | --- | --- |
| Package | [`r/`](r/) (`mavescape`, needs curl and jsonlite) | [`python/`](python/) (`mavescape`, the standard library only; pandas for data frames) |
| Install | `remotes::install_github("robert-mcdermott/MaveScape", subdir = "clients/r")` | `pip install "git+https://github.com/robert-mcdermott/MaveScape#subdirectory=clients/python"` |
| Connect | `ms_connect()` | `ms = mavescape.connect()` |
| An action | `ms_score(preset = "enrich2")` | `ms.score(preset="enrich2")` |
| A table | `as.data.frame(ms_scores(limit = 0))` | `ms.scores(limit=0).frame()` (or `.records()`) |
| A picture | `ms_render_map(file = "map.png")` | `ms.render_map(file="map.png")` |
| Any action by name | `ms_call("qc_findings")` | `ms.call("qc_findings")` |
| The actions | `ms_tools()` | `ms.tools()` |

They are not on CRAN or PyPI. Their version is MaveScape's; use the clients of the MaveScape
release you run.

```r
library(mavescape)
ms_connect()
ms_open_example("grb2-sh3")
scores <- as.data.frame(ms_scores(run = "Run 1", limit = 0))
findings <- as.data.frame(ms_qc_findings())
ms_render_map(run = "Run 1", file = "grb2-map.png")
```

```python
import mavescape

ms = mavescape.connect()
ms.open_example(id="grb2-sh3")
ms.score(preset="enrich2")
scores = ms.scores(run="Run 1", limit=0).frame()
lowest = ms.scores(run="Run 1", kinds=["missense"], sort="score", limit=10).records()
ms.export("scores", "/tmp/grb2_scores.csv", run="Run 1")
```

## Connecting

With `--remote-control`, MaveScape writes `remote.json` to its data folder: its address and the
token that opening and writing files need, readable by you only, removed when MaveScape stops.
`ms_connect()` and `mavescape.connect()` read it. Otherwise they use, in order: the `url` and
`token` you give; `MAVESCAPE_URL` and `MAVESCAPE_TOKEN`; `remote.json` in `MAVESCAPE_DATA_DIR` (for
MaveScape started with `--data-dir`) or the default data folder; `http://127.0.0.1:8820` without a
token.

## Arguments and results

Arguments are those of the actions ([docs/MCP.md](../docs/MCP.md), `ms_tools()`); the required ones
come first and can be given by position. In Python, `render_map`'s `from` is `from_`. Every result
has the action's `message` (a sentence) and `data`:

- **Tables.** `scores` gives a run's variants with the columns of its scores export, `NA` (R) or
  `None` (Python) where the export has NA; 100 rows from `offset` unless `limit` says otherwise
  (`limit = 0` for all). `as.data.frame(result)` and `result.frame()` take the first list of records
  in any result (the QC findings, a run's variants, a comparison's rows).
- **Pictures.** `render_map` and `figures` with `image`, and `render_structure`, return PNGs:
  `file` saves one (and asks for it), `ms_save_image()` and `result.save_image()` write one,
  `ms_images()` and `result.images()` give them all.
- **Errors.** An action MaveScape refuses is an error carrying its reason, the HTTP status and the
  action (`mavescape_error` in R, `MaveScapeError` in Python).

## For developers

The functions are generated from [`tools.json`](tools.json), the program's actions, which a Go
test keeps equal to `actions.go`. After changing an action:

```bash
go test -run TestTheClientsToolListIsCurrent -update
node clients/generate.mjs
```

`generate.mjs` also sets both packages' versions to `main.go`'s; `--check` fails when anything is
out of date (CI runs it). The tests run each client against MaveScape in headless Chrome: GRB2
opened and scored through the client, its scores table every number of Node's, a figure and the
map written as files, errors carrying MaveScape's reason, results equal to the HTTP API's:

```bash
node clients/test-clients.mjs            # both; --python or --r for one
```

They need Go, Chrome (`CHROME=path`), Python 3 (with pandas for the data frames, else that test is
skipped) and R with curl, jsonlite and testthat. The R package also passes `R CMD check`.
