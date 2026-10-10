# Reference outputs of DiMSum 1.4's fitness and error model for the validation suite `scoring`
# (validation/reference/dimsum.json; wave 2, slice 5).
#
#   node validation/fetch.mjs
#   Rscript validation/reference/generate_dimsum.R
#
# DiMSum (Faure et al. 2020; MIT) is run as its own R code: the source of its 1.4 release is
# downloaded (SHA-256 checked) and the functions of its counts-to-fitness stage are sourced:
# dimsum__error_model (the input threshold, the replicates' scales and shifts by nlm, and the
# error model by nls over 100 bootstrap samples, numCores = 1, so that it is reproducible),
# dimsum__add_dropout_pseudocount and dimsum__calculate_fitness; the merge is
# dimsum__merge_fitness's two lines. Its reports are not drawn. Each data set is given to them as
# DiMSum's count table would be after its earlier stages: one row per variant, its number of
# substitutions (DiMSum's weights; MaveScape's count from the variant's name: at the protein level
# synonymous changes not counting), the wild type, and each replicate's input and output counts
# (technical replicates summed). Three data sets:
#
# - fixture: validation/fixtures/two-population.csv, three replicates, with its edge cases;
# - grb2: GRB2 SH3's MaveDB counts (urn:mavedb:00000835-a-1), the data DiMSum scored for MaveDB;
# - demo: DiMSum's own demo, countFile_Toy.txt (TDP-43, four replicates), its whole sequences of
#   the wild type's length, the number of substitutions their Hamming distance.
#
# For each: the threshold, the variants fitted, the scales and shifts, the error model's bootstrap
# means and 10th and 90th percentiles; the same error model fitted once on every variant (DiMSum's
# own bootstrap function given every variant in order: the reference for MaveScape's exact fit);
# every variant's fitness and sigma in each replicate from DiMSum's own parameters, and merged; for
# the fixture also with a dropout pseudocount of 1. Numbers to 13 significant digits.

suppressMessages(library(data.table))
suppressMessages(library(jsonlite))

args <- commandArgs(trailingOnly = FALSE)
here <- dirname(normalizePath(sub("^--file=", "", args[grep("^--file=", args)])))
root <- normalizePath(file.path(here, "..", ".."))
cache <- file.path(root, "validation", "cache")

# DiMSum 1.4, as released.
url <- "https://github.com/lehner-lab/DiMSum/archive/refs/tags/v1.4.tar.gz"
sha <- "1f37a2f5d252884da5cbdfcf297d7cdcbdb09053eca133dc21c0018c2d884879"
work <- tempfile("mavescape-dimsum-")
dir.create(work)
tarball <- file.path(work, "dimsum-1.4.tar.gz")
download.file(url, tarball, quiet = TRUE, mode = "wb")
digest <- tryCatch(system2("shasum", c("-a", "256", shQuote(tarball)), stdout = TRUE), error = function(e) system2("sha256sum", shQuote(tarball), stdout = TRUE))
if (strsplit(digest, " ")[[1]][1] != sha) stop("DiMSum 1.4's archive does not have the expected SHA-256")
untar(tarball, exdir = work)
src <- file.path(work, "DiMSum-1.4", "R")
for (f in c("dimsum__error_model.R", "dimsum__fit_error_model.R", "dimsum__fit_error_model_bootstrap.R",
  "dimsum__replicate_fitness_deviation.R", "dimsum__calculate_fitness.R", "dimsum__add_dropout_pseudocount.R",
  "dimsum__status_message.R")) source(file.path(src, f))
dimsum__render_report <- function(...) invisible(NULL)

# The variant table dimsum__error_model is handed, kept for the fit on every variant.
captured <- NULL
dimsum__fit_error_model_original <- dimsum__fit_error_model
dimsum__fit_error_model <- function(dimsum_meta, input_dt, all_reps, norm_dt, ...) {
  captured <<- copy(input_dt)
  dimsum__fit_error_model_original(dimsum_meta, input_dt, all_reps, norm_dt, ...)
}

num <- function(x) ifelse(is.finite(x), signif(x, 13), NA)

# A variant's number of substitutions from its MAVE-HGVS name (MaveScape's substitutionsOf).
substitutions_of <- function(names) {
  vapply(names, function(k) {
    if (is.na(k) || k == "") return(-1L)
    if (k %in% c("p.=", "c.=", "p.(=)")) return(0L)
    parts <- if (grepl("[", k, fixed = TRUE)) strsplit(sub("^.*\\[(.*)\\]$", "\\1", k), ";")[[1]] else substring(k, 3)
    if (startsWith(k, "p.")) parts <- parts[!grepl("=$", parts)]
    length(parts)
  }, integer(1), USE.NAMES = FALSE)
}

run_case <- function(name, ids, subs, wt, inputs, outputs, keep_every = 1, dropout = 0) {
  R <- length(inputs)
  reps <- seq_len(R)
  dt <- data.table(merge_seq = as.character(ids), nt_seq = NA_character_, aa_seq = NA_character_,
    Nham_nt = subs, Nham_aa = subs, Nmut_codons = NA, WT = ifelse(wt, TRUE, NA), indel = FALSE, STOP = FALSE, STOP_readthrough = FALSE)
  for (j in reps) dt[, paste0("count_e", j, "_s0") := inputs[[j]]]
  for (j in reps) dt[, paste0("count_e", j, "_s1") := outputs[[j]]]
  dt[, error_model := TRUE]
  # DiMSum's count filters at 0: a variant counted in some input and some output.
  dt <- dt[rowSums(!is.na(dt[, paste0("count_e", reps, "_s0"), with = FALSE])) > 0 & rowSums(!is.na(dt[, paste0("count_e", reps, "_s1"), with = FALSE])) > 0]
  tmp <- tempfile("dimsum-")
  dir.create(tmp)
  meta <- list(fitnessErrorModel = TRUE, fitnessNormalise = TRUE, sequenceType = "coding", mixedSubstitutions = FALSE,
    numCores = 1, tmp_path = tmp, fitness_path = tmp, projectName = name, fitnessDropoutPseudocount = dropout)
  model <- dimsum__error_model(meta, copy(dt[, c("Nham_nt", "Nham_aa", "WT", grep("^count", names(dt), value = TRUE)), with = FALSE]), reps, report = FALSE)
  em <- model[["error_model"]]
  nm <- model[["norm_model"]]
  # The input threshold, as dimsum__error_model computes it.
  w <- copy(dt)
  for (j in reps) {
    w[, paste0("fitness", j) := log(.SD[[2]] / .SD[[1]]), .SDcols = c(paste0("count_e", j, "_s0"), paste0("count_e", j, "_s1"))]
    w[is.nan(get(paste0("fitness", j))) | is.infinite(get(paste0("fitness", j))), paste0("fitness", j) := NA]
  }
  w[, all_reads := rowSums(.SD > 0) == 2 * R, .SDcols = grep("^count_e", names(w))]
  threshold <- w[all_reads == TRUE, exp(-quantile(.SD, probs = 0.01, na.rm = TRUE)), .SDcols = paste0("fitness", reps)]
  # The scales and shifts as dimsum__error_model fits them (nlm from 1 and 0), with nlm's minimum,
  # its code and its estimate before the scales are divided by the first.
  w[, above := rowSums(.SD > threshold) == R, .SDcols = paste0("count_e", reps, "_s0")]
  for (j in reps) {
    wt_corr <- as.numeric(w[WT == TRUE, get(paste0("fitness", j))])
    w[, paste0("fitness", j) := get(paste0("fitness", j)) - wt_corr]
  }
  F_data <- w[above == TRUE & all_reads == TRUE, as.matrix(.SD), .SDcols = paste0("fitness", reps)]
  nl <- nlm(f = dimsum__replicate_fitness_deviation, p = rep(c(1, 0), each = R), fitness_mat = F_data, all_reps = reps)
  # The error model fitted once on every variant: DiMSum's own bootstrap function, every variant
  # drawn once, in order.
  idx <- list()
  for (i in R:2) idx <- c(idx, combn(R, i, function(x) list(x)))
  if (length(idx) > 500) idx <- idx[1:500]
  assign("sample", function(x, size, replace = FALSE, prob = NULL) seq_len(size), envir = .GlobalEnv)
  set.seed(20261015)
  full <- dimsum__fit_error_model_bootstrap(1, captured, reps, idx, .Machine$integer.max, 20, 1e-4, unlist(nm[, paste0("scale_", reps), with = FALSE]))
  rm(sample, envir = .GlobalEnv)
  fitted <- captured[input_above_threshold == TRUE & all_reads == TRUE & is.na(WT), .N]
  # Fitness and sigma from DiMSum's own parameters; merged by inverse variance.
  scored <- function(pseudocount) {
    m <- meta
    m[["fitnessDropoutPseudocount"]] <- pseudocount
    d <- dimsum__add_dropout_pseudocount(m, copy(dt), reps, verbose = FALSE)
    f <- dimsum__calculate_fitness(m, d, reps, em, nm, verbose = FALSE)
    fitness_rx <- f[, paste0("fitness", reps, "_uncorr"), with = FALSE]
    sigma_rx <- f[, paste0("sigma", reps, "_uncorr"), with = FALSE]
    f[, fitness := rowSums(fitness_rx / (sigma_rx^2), na.rm = TRUE) / rowSums(1 / (sigma_rx^2), na.rm = TRUE)]
    f[, sigma := sqrt(1 / rowSums(1 / (sigma_rx^2), na.rm = TRUE))]
    f <- f[as.integer(merge_seq) %% keep_every == 0]
    list(
      rows = as.integer(f$merge_seq),
      fitness = lapply(reps, function(j) num(f[[paste0("fitness", j, "_uncorr")]])),
      sigma = lapply(reps, function(j) num(f[[paste0("sigma", j, "_uncorr")]])),
      merged = list(fitness = num(f$fitness), sigma = num(f$sigma)))
  }
  pick <- function(p) lapply(c("input", "output", "reperror"), function(x) num(em[parameter == p & rep %in% reps][order(rep), get(x)]))
  out <- list(
    replicates = R,
    threshold = sprintf("%.17g", threshold),
    fitted = fitted,
    normalisation = list(scale = num(unlist(nm[, paste0("scale_", reps), with = FALSE])), shift = num(unlist(nm[, paste0("shift_", reps), with = FALSE])),
      nlm = list(minimum = num(nl$minimum), code = nl$code, iterations = nl$iterations, estimate = num(nl$estimate))),
    error_model = list(
      input = num(em[parameter == "input"][order(rep), mean_value]), output = num(em[parameter == "output"][order(rep), mean_value]), reperror = num(em[parameter == "reperror"][order(rep), mean_value]),
      lower = list(input = num(em[parameter == "input"][order(rep), CI90_lower]), output = num(em[parameter == "output"][order(rep), CI90_lower]), reperror = num(em[parameter == "reperror"][order(rep), CI90_lower])),
      upper = list(input = num(em[parameter == "input"][order(rep), CI90_upper]), output = num(em[parameter == "output"][order(rep), CI90_upper]), reperror = num(em[parameter == "reperror"][order(rep), CI90_upper])),
      bootstrap = em[1, ensemble]),
    full_fit = list(input = num(full[reps]), output = num(full[R + reps]), reperror = num(full[2 * R + reps])),
    scored = scored(0))
  if (dropout > 0) out$dropout <- c(list(pseudocount = dropout), scored(dropout))
  out
}

# Counts of a design's sample from its columns (technical replicates summed; missing if any is).
sample_counts <- function(table, design, id) {
  cols <- design$samples$columns[[which(design$samples$id == id)]]
  Reduce(`+`, lapply(cols, function(c) as.numeric(table[[c]])))
}

cases <- list()

# The fixture.
fx <- fread(file.path(root, "validation", "fixtures", "two-population.csv"), na.strings = c("", "NA"))
fd <- fromJSON(file.path(root, "validation", "fixtures", "two-population.design.json"))
cases$fixture <- run_case("fixture", seq_len(nrow(fx)), substitutions_of(fx$hgvs_pro), fx$hgvs_pro == "p.=",
  lapply(fd$replicates$input, function(s) sample_counts(fx, fd, s)), lapply(fd$replicates$output, function(s) sample_counts(fx, fd, s)), dropout = 1)

# GRB2 SH3 (MaveDB).
grb2 <- fread(file.path(cache, "mavedb-grb2-sh3", "counts.csv"), na.strings = c("", "NA"))
cases$grb2 <- run_case("grb2", seq_len(nrow(grb2)), substitutions_of(grb2$hgvs_pro), grb2$hgvs_pro == "p.=",
  lapply(1:3, function(r) as.numeric(grb2[[paste0("input_count_rep", r)]])), lapply(1:3, function(r) as.numeric(grb2[[paste0("output_count_rep", r)]])))

# DiMSum's demo: sequences of the wild type's length, their Hamming distance from it.
sources <- fromJSON(file.path(root, "validation", "sources.json"))
wt_seq <- toupper(sources$datasets[["dimsum-demo"]]$wildType)
toy <- fread(file.path(cache, "dimsum-demo", "countFile_Toy.txt"))
seqs <- toupper(toy$nt_seq)
same <- nchar(seqs) == nchar(wt_seq) & grepl("^[ACGT]+$", seqs)
wt_chars <- strsplit(wt_seq, "")[[1]]
ham <- ifelse(same, vapply(strsplit(seqs, ""), function(s) if (length(s) == length(wt_chars)) sum(s != wt_chars) else -1L, integer(1)), -1L)
keep <- which(same)
cases$demo <- run_case("demo", keep, ham[keep], seqs[keep] == wt_seq,
  lapply(1:4, function(r) as.numeric(toy[[paste0("input", r)]][keep])), lapply(1:4, function(r) as.numeric(toy[[paste0("output", r, "A")]][keep])), keep_every = 8)

out <- list(
  about = paste("DiMSum 1.4's fitness and error model (its own R functions, numCores = 1) on validation/fixtures/two-population.csv, GRB2 SH3's MaveDB counts and DiMSum's demo,",
    "made by validation/reference/generate_dimsum.R. Per data set: the input threshold, the variants fitted, the scales and shifts (nlm), the error model's bootstrap means",
    "and 10th-90th percentiles (nls, 100 samples), the error model fitted once on every variant, and each variant's fitness and sigma per replicate from DiMSum's parameters",
    "and merged; rows are 1-based rows of the data set's table (the demo's: every 8th of its sequences of the wild type's length). Numbers to 13 significant digits."),
  generated = format(Sys.Date()),
  versions = list(DiMSum = "1.4", R = paste(R.version$major, R.version$minor, sep = "."), data.table = as.character(packageVersion("data.table"))),
  cases = cases)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, na = "null"), file.path(root, "validation", "reference", "dimsum.json"))
cat("wrote validation/reference/dimsum.json\n")
