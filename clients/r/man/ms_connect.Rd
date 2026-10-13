\name{ms_connect}
\alias{ms_connect}
\alias{ms_default}
\title{Connect to a running MaveScape}
\usage{
ms_connect(url = NULL, token = NULL, client = "R", timeout = 3600, data_dir = NULL)

ms_default()
}
\arguments{
\item{url}{MaveScape's address, such as \code{"http://127.0.0.1:8820"}.}
\item{token}{The token MaveScape printed when it started; opening files by path and writing files need it.}
\item{client}{The name MaveScape's log shows for your actions.}
\item{timeout}{Seconds to wait for an action (scoring a large table takes a while).}
\item{data_dir}{MaveScape's data folder, when it was started with \code{--data-dir}.}
}
\value{
A \code{mavescape} connection, which also becomes the default that every function uses.
}
\description{
MaveScape started with \code{mavescape --remote-control} accepts actions from programs on this
computer. Every action an AI agent has in MaveScape is an R function (\code{ms_open_example},
\code{ms_score}, \code{ms_scores}, \code{ms_qc_findings}, \code{ms_render_map}, \dots) that the open
MaveScape window performs, so the analysis stays visible; each change goes into the workspace's
history.

Without \code{url} and \code{token}, the connection is found in the environment
(\code{MAVESCAPE_URL} and \code{MAVESCAPE_TOKEN}), else in the \code{remote.json} file MaveScape
writes to its data folder (\code{data_dir}, \code{MAVESCAPE_DATA_DIR} or the default folder), else
at MaveScape's default address without a token. \code{ms_default()} returns the last connection
made, connecting first if there is none.
}
\examples{
\dontrun{
ms_connect()
ms_open_example("grb2-sh3")
scores <- as.data.frame(ms_scores(limit = 0))
ms_render_map(file = "map.png")
}
}
