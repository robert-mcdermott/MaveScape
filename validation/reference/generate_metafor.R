# Reference random-effects combinations from metafor for the validation suite `scoring`
# (validation/reference/metafor.json).
#
# Run from the repository root (metafor 5.2-1 and jsonlite):
#
#     Rscript validation/reference/generate_metafor.R
#
# The inputs are Enrich2 2.0.2's replicate scores and SEs of the feasibility data, read from
# validation/reference/enrich2.json (so the reference does not depend on MaveScape's own scoring),
# plus synthetic sets for the edge cases of the estimator (two replicates; tau^2 at its bound of 0;
# large heterogeneity; very unequal variances). For each set of replicate scores y and variances
# v = SE^2: rma(y, v, method = "REML") with a tight convergence threshold, and the fixed-effect
# (method = "EE") estimate, each estimate, SE, tau^2 and Cochran's Q, rounded to 13 significant
# digits.

suppressPackageStartupMessages({
  library(jsonlite)
  library(metafor)
})

reference <- fromJSON("validation/reference/enrich2.json", simplifyVector = FALSE)

value <- function(x) if (is.null(x)) NA_real_ else as.numeric(x)
round13 <- function(x) as.numeric(formatC(x, digits = 13, format = "g"))

# Per variant of a case and method: the replicate scores and variances where Enrich2 scored the
# variant in at least two replicates.
sets_from <- function(case, method) {
  entry <- reference$cases[[case]]
  replicates <- entry$methods[[method]]$replicates
  out <- list()
  for (i in seq_along(entry$variants)) {
    y <- c()
    v <- c()
    for (rep in names(replicates)) {
      s <- value(replicates[[rep]]$score[[i]])
      e <- value(replicates[[rep]]$se[[i]])
      if (!is.na(s) && !is.na(e)) {
        y <- c(y, s)
        v <- c(v, e^2)
      }
    }
    if (length(y) >= 2 && all(v > 0)) out[[length(out) + 1]] <- list(name = entry$variants[[i]], y = y, v = v)
  }
  out
}

synthetic <- list(
  list(name = "two replicates, agreeing", y = c(-1.20, -1.15), v = c(0.04, 0.05)),
  list(name = "two replicates, disagreeing", y = c(-2.0, 0.5), v = c(0.01, 0.02)),
  list(name = "tau2 at its bound", y = c(0.10, 0.11, 0.09, 0.10), v = c(0.5, 0.4, 0.6, 0.5)),
  list(name = "large heterogeneity", y = c(-3.1, -0.2, 1.4, -1.9, 0.8, -2.6), v = c(0.02, 0.03, 0.01, 0.05, 0.02, 0.04)),
  list(name = "very unequal variances", y = c(-0.8, -1.4, -0.3), v = c(1e-4, 2.5, 0.3)),
  list(name = "six replicates, moderate", y = c(0.21, 0.35, -0.05, 0.12, 0.40, 0.18), v = c(0.02, 0.025, 0.03, 0.02, 0.05, 0.015))
)

# The inputs are written for the synthetic sets only: for the others they are in enrich2.json (the
# replicates in its order, v the square of its SE).
combine <- function(set, inputs = FALSE) {
  yi <- set$y
  vi <- set$v
  re <- rma(yi = yi, vi = vi, method = "REML", control = list(threshold = 1e-14, maxiter = 10000))
  fe <- rma(yi = yi, vi = vi, method = "EE")
  c(list(name = set$name), if (inputs) list(y = round13(set$y), v = round13(set$v)), list(
    reml = list(estimate = round13(c(re$beta)), se = round13(re$se), tau2 = round13(re$tau2), q = round13(re$QE)),
    fixed = list(estimate = round13(c(fe$beta)), se = round13(fe$se))
  ))
}

cases <- list(
  list(name = "grb2-sh3 ratios/wt", sets = lapply(sets_from("grb2-sh3", "ratios/wt"), combine)),
  list(name = "brca1-ring-e2 ratios/wt", sets = lapply(sets_from("brca1-ring-e2", "ratios/wt"), combine)),
  list(name = "synthetic", sets = lapply(synthetic, combine, inputs = TRUE))
)

out <- list(
  about = paste(
    "Random-effects (REML) and fixed-effect combinations by metafor, made by validation/reference/generate_metafor.R.",
    "Inputs: Enrich2 2.0.2's replicate scores and variances (SE^2) from enrich2.json, for variants scored in two or more replicates (by name; the replicates in enrich2.json's order), and synthetic sets (y and v given).",
    "rma(method = 'REML', threshold 1e-14) and rma(method = 'EE'); numbers rounded to 13 significant digits."
  ),
  generated = format(Sys.Date()),
  versions = list(metafor = as.character(packageVersion("metafor")), R = paste(R.version$major, R.version$minor, sep = ".")),
  cases = cases
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA), "validation/reference/metafor.json")
cat("wrote validation/reference/metafor.json\n")
