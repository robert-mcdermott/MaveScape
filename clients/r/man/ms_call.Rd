\name{ms_call}
\alias{ms_call}
\title{Perform any MaveScape action by its name}
\usage{
ms_call(.action, ..., .args = list(), ms = ms_default())
}
\arguments{
\item{.action}{The action's name, as \code{\link{ms_tools}} lists it (for example \code{"qc_findings"}); named so that no argument of the action, such as \code{compare}'s \code{a}, is taken for it.}
\item{...}{The action's arguments, named as MaveScape names them (such as \code{color_by}); \code{NULL} arguments are left out.}
\item{.args}{More arguments, as a named list.}
\item{ms}{A connection from \code{\link{ms_connect}} (default: the last one made).}
}
\value{
A \code{mavescape_result}: the \code{action}, MaveScape's \code{message} (a sentence) and its
\code{data} (lists of records become data frames). An action MaveScape refuses or cannot perform is
an error of class \code{mavescape_error} carrying MaveScape's reason, with the HTTP \code{status}
and the \code{action}.
}
\description{
Every \code{ms_*} action function calls \code{ms_call}; it is the way to reach an action this
version of the package does not know yet.
}
\seealso{\code{\link{mavescape_result}}}
