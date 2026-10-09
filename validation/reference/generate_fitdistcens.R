# Reference maximum-likelihood fits of sorted bins from fitdistrplus for the validation suite
# `scoring` (validation/reference/fitdistcens.json, wave 2 slice 3).
#
# Run from the repository root (fitdistrplus 1.2.6 and jsonlite):
#
#     Rscript validation/reference/generate_fitdistcens.R
#
# For the synthetic sort-seq fixture (validation/fixtures/sort-seq.csv, made by
# make-sort-seq.mjs), each replicate's variants as interval-censored observations: one row per
# bin, between its gates (NA for the open outer bins), weighted by the variant's reads in the bin.
# fitdistcens(…, "lnorm") fits a log-normal by maximum likelihood (Peterman & Levine 2016 fit the
# same censored log-normal): with both meanlog and sdlog free (variants with reads in three or more
# bins), and with sdlog fixed at the wild type's own fit. Stored: meanlog, sdlog and the SE of
# meanlog (from the Hessian), rounded to 12 significant digits. optim's tolerance is tightened so
# that the reference's own error is well below the comparison's, and it starts from the weighted
# mean and SD of the bins' log midpoints: fitdistcens' default start ignores the weights, and from
# it Nelder-Mead stopped far from the maximum for variants with nearly all reads in an outer bin
# (found by wave 2, slice 3).

suppressPackageStartupMessages({
  library(jsonlite)
  library(fitdistrplus)
})

counts <- read.csv("validation/fixtures/sort-seq.csv", check.names = FALSE)
design <- fromJSON("validation/fixtures/sort-seq.design.json", simplifyVector = FALSE)
control <- list(reltol = 1e-14, maxit = 20000)
round12 <- function(x) if (is.null(x) || is.na(x)) NA else signif(x, 12)

fit_one <- function(reads, lower, upper, sdlog = NULL) {
  keep <- reads > 0
  data <- data.frame(left = lower[keep], right = upper[keep])
  w <- as.integer(reads[keep])
  # The start: the weighted mean and SD of the bins' log midpoints, an open bin one inner width
  # beyond its gate.
  lo <- log(lower); hi <- log(upper)
  width <- mean((hi - lo)[is.finite(hi - lo)])
  mid <- ifelse(is.na(lo), hi - width / 2, ifelse(is.na(hi), lo + width / 2, (lo + hi) / 2))
  m0 <- sum(reads * mid) / sum(reads)
  s0 <- max(sqrt(sum(reads * (mid - m0)^2) / sum(reads)), width / 2)
  fit <- tryCatch(
    if (is.null(sdlog)) fitdistcens(data, "lnorm", start = list(meanlog = m0, sdlog = s0), weights = w, control = control)
    else fitdistcens(data, "lnorm", start = list(meanlog = m0), weights = w, fix.arg = list(sdlog = sdlog), control = control),
    error = function(e) NULL)
  if (is.null(fit)) return(NULL)
  list(meanlog = round12(fit$estimate[["meanlog"]]),
       sdlog = round12(if (is.null(sdlog)) fit$estimate[["sdlog"]] else sdlog),
       se = round12(fit$sd[["meanlog"]]))
}

out <- list(
  about = "fitdistrplus fits of the synthetic sort-seq fixture, made by validation/reference/generate_fitdistcens.R. Per replicate and variant: free (meanlog and sdlog fitted; variants with reads in three or more bins) and fixed (sdlog the wild type's) [meanlog, sdlog, SE of meanlog].",
  generated = format(Sys.Date()),
  versions = list(R = paste(R.version$major, R.version$minor, sep = "."), fitdistrplus = as.character(packageVersion("fitdistrplus"))),
  replicates = list()
)
names_ <- counts[[design$variants$column]]
for (replicate in design$replicates) {
  bins <- replicate$bins[order(sapply(replicate$bins, function(b) b$order))]
  lower <- sapply(bins, function(b) if (is.null(b$lower)) NA else b$lower)
  upper <- sapply(bins, function(b) if (is.null(b$upper)) NA else b$upper)
  columns <- sapply(bins, function(b) design$samples[[which(sapply(design$samples, function(s) s$id) == b$sample)]]$columns[[1]])
  reads <- as.matrix(counts[, columns])
  wt <- which(names_ == design$controls$wildType)
  wt_fit <- fit_one(reads[wt, ], lower, upper)
  free <- list()
  fixed <- list()
  for (i in seq_along(names_)) {
    r <- reads[i, ]
    if (sum(r) == 0) next
    if (sum(r > 0) >= 3) {
      f <- fit_one(r, lower, upper)
      if (!is.null(f)) free[[names_[i]]] <- c(f$meanlog, f$sdlog, f$se)
    }
    only <- which(r > 0)
    if (length(only) == 1 && (only == 1 || only == length(r))) next
    g <- fit_one(r, lower, upper, sdlog = wt_fit$sdlog)
    if (!is.null(g)) fixed[[names_[i]]] <- c(g$meanlog, g$sdlog, g$se)
  }
  out$replicates[[replicate$id]] <- list(wildTypeSdlog = wt_fit$sdlog, free = free, fixed = fixed)
  cat(replicate$id, ": ", length(free), " free fits, ", length(fixed), " with the wild type's sdlog\n", sep = "")
}
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA), "validation/reference/fitdistcens.json")
