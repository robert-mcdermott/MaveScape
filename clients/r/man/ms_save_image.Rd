\name{ms_save_image}
\alias{ms_save_image}
\alias{ms_images}
\title{Pictures of a result, as PNG files}
\usage{
ms_save_image(result, file, index = NULL)

ms_images(result)
}
\arguments{
\item{result}{The result of \code{\link{ms_render_map}} (with \code{image = TRUE}), \code{\link{ms_render_structure}} or \code{\link{ms_figures}} (with \code{image = TRUE}).}
\item{file}{The path of the PNG file to write.}
\item{index}{Which picture, from 1, when the result has several (the pages of several figures).}
}
\value{
\code{ms_save_image}: \code{file}, invisibly. \code{ms_images}: a list of the pictures as raw
vectors (PNG), named by their captions.
}
\description{
MaveScape gives pictures as data URLs in a result's data. \code{ms_save_image} writes one to a PNG
file; \code{ms_render_map(file = )}, \code{ms_render_structure(file = )} and
\code{ms_figures(figure = , file = )} do the same.
}
