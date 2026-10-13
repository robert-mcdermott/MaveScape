# mavescape (R)

Remote control of a running [MaveScape](https://github.com/robert-mcdermott/MaveScape), the
workbench for multiplexed assays of variant effect, from R: every action an AI agent can take in
MaveScape is an R function, performed by the open MaveScape window.

```r
remotes::install_github("robert-mcdermott/MaveScape", subdir = "clients/r")
```

Start MaveScape with `mavescape --remote-control`, then:

```r
library(mavescape)
ms_connect()                       # finds the running MaveScape
ms_open_example("grb2-sh3")
scores <- as.data.frame(ms_scores(run = "Run 1", limit = 0))
ms_render_map(run = "Run 1", file = "grb2-map.png")
```

`?ms_scores` describes each action's arguments. See
[clients/README.md](https://github.com/robert-mcdermott/MaveScape/tree/main/clients) for how the
connection is found, tables, pictures and errors.
