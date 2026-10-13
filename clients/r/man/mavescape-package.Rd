\name{mavescape-package}
\alias{mavescape-package}
\alias{mavescape}
\docType{package}
\title{Remote control of a running MaveScape}
\description{
MaveScape is a workbench for multiplexed assays of variant effect (deep mutational scans) that
runs on this computer. Started with \code{mavescape --remote-control}, it performs actions sent by
programs on the same computer in its open window. This package makes each action an R function:
\code{\link{ms_connect}} finds the running MaveScape, and \code{ms_open_files},
\code{ms_set_design}, \code{ms_score}, \code{ms_scores}, \code{ms_qc_findings}, \code{ms_compare},
\code{ms_render_map}, \code{ms_export} and the others do what their names say.
\code{\link{ms_tools}} lists them, and \code{\link{ms_call}} sends any action by its name. Scores
are research evidence of a variant's functional effect in its assay, never a clinical
classification.
}
\seealso{\url{https://github.com/robert-mcdermott/MaveScape}}
