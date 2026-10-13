# Score-level likelihood ratios as acmgscaler computes them, and the R numerics they rest on, for the
# validation suite `likelihood` (wave 8, slice 4; validation/reference/likelihood.json).
#
# Run from the repository root (R 4.6.1 with acmgscaler 1.0.0 and jsonlite), after
# node validation/fixtures/make-calibration.mjs has written factor IX's scores:
#
#     Rscript validation/reference/generate_likelihood.R
#
# R is GPL: MaveScape ports none of it. web/lib/rcompat.js writes each numeric from its publication
# and finds R's conventions by experiment, against what this script records of R as a black box:
#   - set.seed(seed, kind = "Mersenne-Twister", sample.kind = "Rejection"): the 624 words of the
#     state, the first runif() values and sample.int(n, 20, replace = TRUE) for several n;
#   - seq(0, 1, length.out = 1024);
#   - density(x, n = 1024, bw) (every eighth point) and bw.bcv(x, nb = 1024) (and nb = 1000) on
#     four sets of scores;
#   - isoreg(y)$yf; optimize(f, interval, tol)$minimum; approx(ties = mean, rule = 1 and 2);
#     mad; qbinom(0.025, n, 0.5); cor(method = "spearman").
# acmgscaler (Badonyi 2025, MIT; web/lib/likelihood.js ports it) on:
#   - its own example, variant_data, by gene (BRCA1, TP53), as its documentation calls it (prior
#     0.1, seed 42): every variant's likelihood ratio with its interval and evidence, and the score
#     thresholds with theirs;
#   - BRCA1's scores alone at Pejaver et al. 2022's prior, 0.0441 (seed 7);
#   - TP53's scores negated, so that lower scores are the benign ones (seed 11);
#   - factor IX's Run 1 (validation/fixtures/controls/factor9-run1-scores.csv): its 164 P and 22 B
#     ClinVar controls and every other variant it scores unlabeled (seed 20261009, MaveScape's), the
#     controls' rows and every tenth other row, and the evidence of every row counted;
#   - find_pvst at the priors 0.1 and 0.0441, and thresholds_upon_prior.
# Pejaver et al. 2022's Table 1 (AJHG 109:2163, doi:10.1016/j.ajhg.2022.10.013, CC BY), typed from
# the paper: at the prior 0.0441, c = 1,124 and the likelihood ratios and posteriors it gives.
# Numbers written with 17 significant digits.

suppressPackageStartupMessages({
  library(jsonlite)
  library(acmgscaler)
})

out <- list(generator = paste0("R ", R.version$major, ".", R.version$minor, "; acmgscaler ", packageVersion("acmgscaler")))

# --- R's numerics, as a black box -------------------------------------------------------------------

out$seeds <- lapply(c(42L, 1L, 20261009L, -5L), function(s) {
  set.seed(s, kind = "Mersenne-Twister", sample.kind = "Rejection")
  st <- .Random.seed
  u <- runif(5)
  set.seed(s, kind = "Mersenne-Twister", sample.kind = "Rejection")
  smp <- lapply(c(7L, 186L, 1000L, 65537L), function(n) sample.int(n, 20, replace = TRUE))
  list(seed = s, state = st[3:626], unif = u, n = c(7L, 186L, 1000L, 65537L), sample = smp)
})
out$seq <- seq(0, 1, length.out = 1024)
set.seed(7, kind = "Mersenne-Twister", sample.kind = "Rejection")
sets <- list(rnorm(50), rexp(200), round(rnorm(120, 2, 3), 1), c(rnorm(30, -2), rnorm(40, 3, 0.5)))
out$sets <- lapply(sets, function(x) {
  bw <- suppressWarnings(bw.bcv(x, nb = 1024))
  d <- density(x, n = 1024, bw = bw)
  every <- seq(1, 1024, by = 8)
  list(x = x, bw = bw, bw1000 = suppressWarnings(bw.bcv(x)), at = every, dx = d$x[every], dy = d$y[every])
})
set.seed(8, kind = "Mersenne-Twister", sample.kind = "Rejection")
y <- cumsum(rnorm(1024)) * 0.1 + sin(seq(0, 6, length.out = 1024))
ytie <- c(1, 1, 0, 2, 2, 2, 1, 3)
out$isoreg <- list(y = y, yf = isoreg(y)$yf, ytie = ytie, yftie = isoreg(ytie)$yf)
out$optimize <- list(
  list(f = "(x - 1)^2 + sin(3 x)", lower = -2, upper = 4, tol = 1e-3, minimum = optimize(function(x) (x - 1)^2 + sin(3 * x), c(-2, 4), tol = 1e-3)$minimum),
  list(f = "|x - 0.3| + x^4", lower = 0, upper = 1, tol = 1e-6, minimum = optimize(function(x) abs(x - 0.3) + x^4, c(0, 1), tol = 1e-6)$minimum))
ax <- c(3, 1, 2, 2, 5); ay <- c(30, 10, 20, 26, 50); axo <- c(0.5, 1, 1.5, 2, 2.5, 4.9, 5, 6)
out$approx <- list(x = ax, y = ay, xout = axo, rule1 = approx(ax, ay, xout = axo, ties = mean, rule = 1)$y, rule2 = approx(ax, ay, xout = axo, ties = mean, rule = 2)$y)
out$mad <- list(x = sets[[2]], mad = mad(sets[[2]]))
out$qbinom <- list(n = c(1000, 999, 50, 20), q = sapply(c(1000, 999, 50, 20), function(n) qbinom(0.025, n, 0.5)))
out$spearman <- list(a = sets[[3]][1:100], b = sets[[1]][c(1:50, 1:50)], rho = cor(sets[[3]][1:100], sets[[1]][c(1:50, 1:50)], method = "spearman"))

# --- acmgscaler ----------------------------------------------------------------------------------------

as_case <- function(name, data, result, prior, seed, keep = NULL) {
  lr <- result$likelihood_ratios
  rows <- if (is.null(keep)) seq_len(nrow(lr)) else keep
  list(
    name = name, prior = prior, seed = seed, score = data$score, class = data$class,
    rows = rows,
    lrLower = lr$score_lr_lower[rows], lr = lr$score_lr[rows], lrUpper = lr$score_lr_upper[rows],
    evidence = as.character(lr$score_evidence[rows]),
    evidenceCounts = as.list(table(as.character(lr$score_evidence))),
    thresholds = list(boundary = as.character(result$score_thresholds$evidence), lower = result$score_thresholds$score_lower,
                      score = result$score_thresholds$score, upper = result$score_thresholds$score_upper)
  )
}

data(variant_data)
grouped <- suppressMessages(capture.output(g <- calibrate(variant_data, value = "score", group = "gene")))
cases <- list(list(name = "acmgscaler's example (variant_data), by gene", grouped = TRUE, prior = 0.1, seed = 42,
  groups = lapply(c("BRCA1", "TP53"), function(gene) as_case(gene, variant_data[variant_data$gene == gene, ], g[[gene]], 0.1, 42))))

brca1 <- variant_data[variant_data$gene == "BRCA1", ]
cases[[2]] <- as_case("BRCA1 at Pejaver et al.'s prior, 0.0441", brca1, calibrate(brca1, value = "score", prior = 0.0441, seed = 7), 0.0441, 7)
tp53 <- variant_data[variant_data$gene == "TP53", ]
tp53$score <- -tp53$score
cases[[3]] <- as_case("TP53, its scores negated", tp53, calibrate(tp53, value = "score", seed = 11), 0.1, 11)
f9 <- read.csv("validation/fixtures/controls/factor9-run1-scores.csv", stringsAsFactors = FALSE)
f9$class <- ifelse(f9$side %in% c("P", "B"), f9$side, "U")
f9r <- calibrate(f9[, c("score", "class")], value = "score", seed = 20261009)
keep <- sort(c(which(f9$class != "U"), which(f9$class == "U")[seq(1, sum(f9$class == "U"), by = 10)]))
f9case <- as_case("factor IX's Run 1, its ClinVar controls and every other variant it scores", f9[, c("score", "class")], f9r, 0.1, 20261009, keep)
f9case$score <- NULL
f9case$class <- NULL
f9case$fixture <- "validation/fixtures/controls/factor9-run1-scores.csv"
cases[[4]] <- f9case
out$cases <- cases

out$pvst <- list(prior = c(0.1, 0.0441), pvst = c(acmgscaler:::find_pvst(0.1), acmgscaler:::find_pvst(0.0441)),
  thresholds = list(unname(acmgscaler:::thresholds_upon_prior(0.1)), unname(acmgscaler:::thresholds_upon_prior(0.0441))))
# Pejaver et al. 2022, Table 1, as printed (four significant digits).
out$pejaver2022 <- list(prior = 0.0441, c = 1124,
  pathogenic = list(strength = c("supporting", "moderate", "strong", "very strong"), lr = c(2.406, 5.790, 33.53, 1124), posterior = c(0.0999, 0.2108, 0.6073, 0.9811)),
  benign = list(strength = c("supporting", "moderate", "strong", "very strong"), lr = c(0.4156, 0.1727, 0.0298, 0.0009), posterior = c(0.9812, 0.9921, 0.9986, 1.0000)))

writeLines(toJSON(out, digits = I(17), auto_unbox = TRUE, na = "null"), "validation/reference/likelihood.json")
