\name{ms_tools}
\alias{ms_tools}
\title{The actions a running MaveScape performs}
\usage{
ms_tools(ms = ms_default())
}
\arguments{
\item{ms}{A connection from \code{\link{ms_connect}} (default: the last one made).}
}
\value{
A data frame of the actions' names, titles and descriptions.
}
\description{
The actions of the running MaveScape (an AI agent's tools), each also an R function named
\code{ms_<name>}.
}
