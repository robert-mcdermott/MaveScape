# DiMSum 1.4's merge of nucleotide variants into amino-acid variants, the reference for MaveScape's
# protein view of a nucleotide run (web/lib/collapse.js; validation suite `consequences`;
# validation/reference/dimsum-aggregate.json; wave 3, slice 3).
#
#   node validation/fetch.mjs mavedb-cbs
#   Rscript validation/reference/generate_dimsum_aggregate.R
#
# DiMSum (Faure et al. 2020; MIT) is run as its own R code, as generate_dimsum.R runs it: the source
# of its 1.4 release (SHA-256 checked), its dimsum__aggregate_AA_variants_fitness sourced, with
# mixedSubstitutions = FALSE (its default). Its input is what DiMSum's counts-to-fitness stage hands
# it: one row per nucleotide variant with its sequence, its translation, its numbers of changed
# bases, amino acids and codons, and a fitness and sigma. The variants are CBS's 11,478 codon
# variants of the low-vitamin-B6 selection (urn:mavedb:00000005-a-5, CC0), each applied to CBS's
# coding sequence (validation/differential-cases.mjs) and translated here; DiMSum's rule for mixed
# substitutions (dimsum__process_merged_variants: Nmut_codons − Nham_aa ≠ 0 and Nham_aa ≠ 0) is
# applied as DiMSum applies it. The fitness and sigma are a simple count ratio of the first
# replicate (select1 over nonselect1, pseudocount 0.5) and its counting error: any numbers would do,
# what is checked is how DiMSum merges them. The wild type, which DiMSum needs, is added with
# counts of 1000 and 1000. Out: each row DiMSum returns, its amino-acid sequence written as its
# changes from the wild type (position, wild type, mutant), its fitness and sigma to 13 significant
# digits; a synonymous row (which DiMSum keeps apart, by its nucleotide sequence) by its changed
# bases.

suppressMessages(library(data.table))
suppressMessages(library(jsonlite))

args <- commandArgs(trailingOnly = FALSE)
here <- dirname(normalizePath(sub("^--file=", "", args[grep("^--file=", args)])))
root <- normalizePath(file.path(here, "..", ".."))

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
for (f in c("dimsum__aggregate_AA_variants_fitness.R", "dimsum__check_variants.R", "dimsum__status_message.R")) source(file.path(src, f))

# CBS's coding sequence, as the validation writes it.
js <- readLines(file.path(root, "validation", "differential-cases.mjs"))
first <- grep("^const CBS = \\[", js)
last <- first + grep("^\\]\\.join", js[(first + 1):length(js)])[1]
wt <- paste(gsub("[^ACGT]", "", js[(first + 1):(last - 1)]), collapse = "")

# The standard genetic code (NCBI table 1), codons in TCAG order.
bases <- c("T", "C", "A", "G")
codons <- character(0)
for (x in bases) for (y in bases) for (z in bases) codons <- c(codons, paste0(x, y, z))
code <- setNames(strsplit("FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG", "")[[1]], codons)
translate <- function(s) paste(code[substring(s, seq(1, nchar(s) - 2, 3), seq(3, nchar(s), 3))], collapse = "")
hamming <- function(a, b) sum(strsplit(a, "")[[1]] != strsplit(b, "")[[1]])

counts <- fread(file.path(root, "validation", "cache", "mavedb-cbs", "low-b6-counts.csv"))
# Each name is a codon's deletion-insertion (c.268_270delinsTAT) or a base's substitution (c.270C>G).
apply_name <- function(name) {
  d <- regmatches(name, regexec("^c\\.(\\d+)_(\\d+)delins([ACGT]+)$", name))[[1]]
  if (length(d) == 4) return(paste0(substr(wt, 1, as.integer(d[2]) - 1), d[4], substr(wt, as.integer(d[3]) + 1, nchar(wt))))
  u <- regmatches(name, regexec("^c\\.(\\d+)([ACGT])>([ACGT])$", name))[[1]]
  if (length(u) == 4 && substr(wt, as.integer(u[2]), as.integer(u[2])) == u[3]) return(paste0(substr(wt, 1, as.integer(u[2]) - 1), u[4], substr(wt, as.integer(u[2]) + 1, nchar(wt))))
  stop(paste("a name that is not a codon's deletion-insertion or a substitution of the target's base:", name))
}
nt <- vapply(counts$hgvs_nt, apply_name, character(1), USE.NAMES = FALSE)
dt <- data.table(nt_seq = c(wt, nt), name = c("c.=", counts$hgvs_nt))
dt[, aa_seq := vapply(nt_seq, translate, character(1))]
wt_aa <- translate(wt)
dt[, Nham_nt := vapply(nt_seq, hamming, integer(1), b = wt)]
dt[, Nham_aa := vapply(aa_seq, hamming, integer(1), b = wt_aa)]
wt_split <- strsplit(wt, "")[[1]]
dt[, Nmut_codons := vapply(nt_seq, function(s) length(unique(ceiling(which(strsplit(s, "")[[1]] != wt_split) / 3))), integer(1))]
dt[, WT := ifelse(nt_seq == wt, TRUE, NA)]
dt[, indel := FALSE]
dt[, STOP := grepl("\\*", aa_seq)]
dt[, STOP_readthrough := FALSE]
dt[, error_model := TRUE]
# DiMSum's rule for mixed substitutions, with mixedSubstitutions = FALSE.
dt[, mixed := (Nmut_codons - Nham_aa) != 0 & Nham_aa != 0]
inp <- c(1000, counts$nonselect1)
out <- c(1000, counts$select1)
dt[, count_e1_s0 := inp]
dt[, count_e1_s1 := out]
dt[, mean_count := inp]
dt[, fitness1_uncorr := log((out + 0.5) / (inp + 0.5))]
dt[, sigma1_uncorr := sqrt(1 / (out + 0.5) + 1 / (inp + 0.5))]
dt[, fitness := fitness1_uncorr]
dt[, sigma := sigma1_uncorr]
kept <- dt[mixed == FALSE]
# DiMSum names its input rows by nt_seq (one per sequence): a sequence named twice is one.
kept <- kept[!duplicated(nt_seq)]

meta <- list(exp_design = data.frame(experiment = 1, experiment_replicate = 1), retainedReplicates = "all", sequenceType = "coding", mixedSubstitutions = FALSE, synonym_sequences = NULL)
merged <- dimsum__aggregate_AA_variants_fitness(dimsum_meta = meta, input_dt = copy(kept[, .SD, .SDcols = setdiff(names(kept), c("name", "mixed"))]), all_reps = 1)

changes <- function(aa) {
  a <- strsplit(aa, "")[[1]]
  w <- strsplit(wt_aa, "")[[1]]
  d <- which(a != w)
  if (!length(d)) return(character(0))
  paste0(w[d], d, a[d])
}
# A synonymous row (DiMSum keeps each apart, by its nucleotide sequence): its changed bases.
base_changes <- function(seq) {
  a <- strsplit(seq, "")[[1]]
  d <- which(a != wt_split)
  if (!length(d)) return(character(0))
  paste0(d, wt_split[d], ">", a[d])
}
num <- function(x) ifelse(is.finite(x), signif(x, 13), NA)
rows <- lapply(seq_len(nrow(merged)), function(i) {
  r <- merged[i]
  list(changes = changes(r$aa_seq), bases = if (r$Nham_aa == 0) base_changes(r$merge_seq) else NULL, nham_aa = r$Nham_aa, fitness = num(r$fitness), sigma = num(r$sigma))
})
out <- list(
  about = "DiMSum 1.4's dimsum__aggregate_AA_variants_fitness on CBS's low-B6 codon variants (generate_dimsum_aggregate.R): each row it returns, its amino-acid changes from the wild type (a synonymous row's changed bases), its fitness and sigma.",
  versions = list(dimsum = "1.4", R = paste(R.version$major, R.version$minor, sep = ".")),
  input = list(variants = nrow(dt) - 1, mixed = sum(dt$mixed), wild_type = list(input = 1000, output = 1000)),
  rows = rows
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, null = "null"), file.path(root, "validation", "reference", "dimsum-aggregate.json"))
cat("rows", nrow(merged), "\n")
