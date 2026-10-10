# Reference outputs of mutscan's limma contrasts for the validation suite `scoring`
# (validation/reference/mutscan.json; wave 2, slice 6).
#
#   node validation/fetch.mjs
#   Rscript validation/reference/generate_mutscan.R
#
# mutscan (Soneson et al. 2023; MIT) is run as published: calculateRelativeFC(method = "limma")
# with the reference rows as WTrows (normMethod "sum": their summed counts, through edgeR's
# scaleOffset, are voom's library sizes), on a design with a term for each input library and one
# for selection in each condition, ~ Library + Condition, the input the baseline; the contrast is
# selection in one condition less the reference's. limma (GPL) is the reference here only:
# MaveScape's web/lib/limma.js is written from the publications. Two data sets:
#
# - fixture: validation/fixtures/two-condition.csv (fixtures/make-two-condition.mjs), one input
#   per replicate selected without and with a ligand, a fourth replicate without it only, its edge
#   cases planted; relative to the wild type (p.=);
# - cbs: cystathionine beta-synthase's yeast complementation (Sun et al. 2020; MaveDB
#   urn:mavedb:00000005-a-5, low vitamin B6, and -a-6, high), whose non-selected samples 1–4 are
#   the same in both records: their select1–4 against the shared nonselect1–4 (the low-B6 record's
#   select5–8, at a concentration the record does not give, are not used), the records joined on
#   hgvs_nt in the low-B6 record's order, an input counted only where both records count it;
#   relative to the synonymous variants' summed counts (the data have no wild-type row).
#
# Rows: those counted in every sample. For each case: the rows' identifiers, and per row logFC,
# its SE, t, the p-value, the BH-adjusted p-value, the 95% interval, AveExpr, df.total and
# df.prior (every row for the fixture; for cbs every 5th row and the reference rows). Numbers to
# 15 significant digits.

suppressMessages({
  library(mutscan)
  library(SummarizedExperiment)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = FALSE)
here <- dirname(normalizePath(sub("^--file=", "", args[grep("^--file=", args)])))
root <- normalizePath(file.path(here, "..", ".."))
cache <- file.path(root, "validation", "cache")

num <- function(x) suppressWarnings(as.numeric(ifelse(x %in% c("", "NA"), NA, x)))

# A case: counts (rows × samples, rownames the identifiers), the samples' library and condition,
# the reference rows, the contrast's conditions.
run_case <- function(counts, library, condition, levels, reference, contrast, keep) {
  complete <- rowSums(is.na(counts)) == 0
  counts <- counts[complete, , drop = FALSE]
  cd <- DataFrame(Library = factor(library, levels = unique(library)), Condition = factor(condition, levels = c("input", levels)))
  se <- SummarizedExperiment(assays = list(counts = counts), colData = cd)
  design <- model.matrix(~ Library + Condition, data = cd)
  co <- setNames(rep(0, ncol(design)), colnames(design))
  co[paste0("Condition", contrast[1])] <- 1
  co[paste0("Condition", contrast[2])] <- -1
  wt <- intersect(reference, rownames(counts))
  tt <- calculateRelativeFC(se, design, contrast = unname(co), WTrows = wt, method = "limma")
  stopifnot(identical(rownames(tt), rownames(counts)))
  kept <- if (identical(keep, "all")) seq_len(nrow(tt)) else sort(unique(c(seq(1, nrow(tt), by = keep), match(wt, rownames(tt)))))
  r <- function(x) signif(x, 15)
  list(
    samples = colnames(counts), design = unname(split(design, row(design))), contrast = unname(co),
    rows = nrow(tt), reference = length(wt), dfPrior = r(tt$df.prior[1]),
    kept = if (identical(keep, "all")) "all" else keep,
    ids = rownames(tt)[kept],
    logFC = r(tt$logFC[kept]), se = r(tt$se.logFC[kept]), t = r(tt$t[kept]), p = r(tt$P.Value[kept]), q = r(tt$adj.P.Val[kept]),
    ciLow = r(tt$CI.L[kept]), ciHigh = r(tt$CI.R[kept]), aveExpr = r(tt$AveExpr[kept]), dfTotal = r(tt$df.total[kept])
  )
}

# The fixture, from its design.
fixture <- function() {
  design <- fromJSON(file.path(root, "validation", "fixtures", "two-condition.design.json"), simplifyVector = FALSE)
  table <- read.csv(file.path(root, "validation", "fixtures", "two-condition.csv"), check.names = FALSE, colClasses = "character")
  reps <- design$replicates
  inputs <- unique(vapply(reps, function(r) r$input, ""))
  outputs <- vapply(reps, function(r) r$output, "")
  samples <- c(inputs, outputs)
  counts <- sapply(samples, function(s) num(table[[s]]))
  rownames(counts) <- table$hgvs_pro
  library <- c(inputs, vapply(reps, function(r) r$input, ""))
  condition <- c(rep("input", length(inputs)), vapply(reps, function(r) r$condition, ""))
  levels <- vapply(design$conditions, function(c) c$id, "")
  run_case(counts, library, condition, levels, "p.=", c("b", "a"), "all")
}

cbs <- function() {
  low <- read.csv(file.path(cache, "mavedb-cbs", "low-b6-counts.csv"), check.names = FALSE, colClasses = "character")
  high <- read.csv(file.path(cache, "mavedb-cbs", "high-b6-counts.csv"), check.names = FALSE, colClasses = "character")
  m <- match(low$hgvs_nt, high$hgvs_nt)
  low <- low[!is.na(m), ]
  high <- high[m[!is.na(m)], ]
  counts <- cbind(
    sapply(1:4, function(i) { a <- num(low[[paste0("nonselect", i)]]); b <- num(high[[paste0("nonselect", i)]]); ifelse(is.na(a) | is.na(b), NA, a) }),
    sapply(1:4, function(i) num(low[[paste0("select", i)]])),
    sapply(1:4, function(i) num(high[[paste0("select", i)]])))
  colnames(counts) <- c(paste0("nonselect", 1:4), paste0("low", 1:4), paste0("high", 1:4))
  rownames(counts) <- low$hgvs_nt
  synonymous <- low$hgvs_nt[grepl("=$", low$hgvs_pro)]
  run_case(counts, rep(paste0("nonselect", 1:4), 3), c(rep("input", 4), rep("low", 4), rep("high", 4)), c("low", "high"), synonymous, c("high", "low"), 5)
}

versions <- list(mutscan = as.character(packageVersion("mutscan")), limma = as.character(packageVersion("limma")),
                 edgeR = as.character(packageVersion("edgeR")), R = paste(R.version$major, R.version$minor, sep = "."))
out <- list(
  about = "mutscan's calculateRelativeFC(method = 'limma') on the validation data sets, made by validation/reference/generate_mutscan.R. Per case: the samples, the design (~ Library + Condition) and contrast, the rows fitted (counted in every sample) and reference rows, and per kept row logFC (log2), its SE, t, p, BH-adjusted p, the 95% interval, AveExpr, df.total; df.prior.",
  generated = format(Sys.Date()),
  versions = versions,
  cases = list(fixture = fixture(), cbs = cbs())
)
path <- file.path(root, "validation", "reference", "mutscan.json")
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, null = "null", na = "null"), path)
cat(sprintf("wrote %s (%.0f KB)\n", path, file.size(path) / 1e3))
