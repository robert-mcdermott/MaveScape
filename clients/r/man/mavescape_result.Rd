\name{mavescape_result}
\alias{mavescape_result}
\alias{print.mavescape_result}
\alias{as.data.frame.mavescape_result}
\alias{print.mavescape}
\title{MaveScape's answer to an action}
\usage{
\method{print}{mavescape_result}(x, ...)

\method{as.data.frame}{mavescape_result}(x, row.names = NULL, optional = FALSE, key = NULL, ...)

\method{print}{mavescape}(x, ...)
}
\arguments{
\item{x}{A \code{mavescape_result}, or a \code{mavescape} connection.}
\item{row.names, optional}{As for \code{\link{as.data.frame}}.}
\item{key}{The element of the result's data to convert (default: the first data frame in it).}
\item{...}{Passed on to \code{\link{as.data.frame}}.}
}
\value{
\code{print} returns \code{x} invisibly; \code{as.data.frame} a data frame.
}
\description{
Every action returns a \code{mavescape_result}, a list of the \code{action}, MaveScape's
\code{message} and its \code{data}. Printing shows the message; \code{as.data.frame} gives a table in
the data, such as a run's variants from \code{\link{ms_scores}} (the columns of its scores export,
\code{NA} where it has NA) or the findings of \code{\link{ms_qc_findings}}.
}
