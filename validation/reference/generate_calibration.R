# Reference metrics of calibration for the validation suite `calibration` (wave 8, slice 2;
# validation/reference/calibration.json).
#
# Run from the repository root (pROC 1.19, PRROC 1.4, binom 1.1 and jsonlite), after
# node validation/fixtures/make-calibration.mjs has written factor IX's scored controls:
#
#     Rscript validation/reference/generate_calibration.R
#
# Each case is two score vectors, P (the P controls: pathogenic, likely pathogenic or abnormal, as
# their source says) and B, and the side of the scale where abnormal-like scores are ("below":
# lower scores are less function). Synthetic cases of known shape (set.seed), and one real case,
# factor IX's ClinVar controls as the example's Run 1 scores them
# (validation/fixtures/controls/factor9-run1-controls.csv). For each:
#   - the ROC curve: pROC::roc with P the cases, B the controls and the direction the side gives
#     (">" for below: a case at or below the threshold is called), every point of
#     coords(r, "all"); the AUC and DeLong's 95% interval (ci.auc, method "delong");
#   - the precision-recall curve: PRROC::pr.curve with the P controls the foreground on scores
#     oriented so that higher is more abnormal-like (negated for below): its area (auc.integral,
#     Keilwagen et al. 2014's interpolation; and Davis and Goadrich's) and its points
#     (minStepSize = Inf: the curve's own points without those interpolated for drawing);
#   - thresholds by MaveScape's rules, written out here from pROC's points, each point's tp and fp
#     read back from its sensitivity and specificity:
#       "error" (rate 0.05, and 0.1): the abnormal threshold the point of the most P controls
#       called with at most floor(rate nB) B controls called (ties: the fewer B); the normal
#       threshold the point of the fewest B controls called with at most floor(rate nP) P controls
#       not called (ties: the more P); where the two cross, both their middle;
#       "youden": the point of the largest sensitivity + specificity (ties: the higher
#       specificity), as coords(r, "best", best.method = "youden") finds it;
#     and the factor IX case with given thresholds (0.3, 0.7);
#     each with the controls in each class (abnormal-like at or beyond the abnormal threshold,
#     WT-like short of the normal one, intermediate between), sensitivity (P abnormal-like) and
#     specificity (B WT-like) with Wilson's 95% intervals (binom::binom.confint, "wilson");
#   - a stratified bootstrap of 2000 samples (pROC's default), each side drawn again with
#     replacement (set.seed per case): pROC's ci.auc (method "bootstrap") and ci.se at the
#     specificities seq(0, 1, 0.05); and, written out here on pROC's and PRROC's curves of each
#     sample, the area under the precision-recall curve, the precision at the recalls 0.05 to 1 on
#     Keilwagen's interpolation (in the first step that reaches the recall), and each rule's
#     thresholds; their 2.5%, 50% and 97.5% quantiles (type 7). MaveScape draws its samples with its
#     own seeded generator, so these agree within their Monte Carlo error, not exactly.
# Scores rounded to 13 significant digits before anything is computed, and every result after; an
# infinite threshold (a class left empty) is null.

suppressPackageStartupMessages({
  library(jsonlite)
  library(pROC)
  library(PRROC)
  library(binom)
})

round13 <- function(x) as.numeric(formatC(x, digits = 13, format = "g"))
finite13 <- function(x) ifelse(is.finite(x), round13(x), NA)
BOOT <- 2000

roc_of <- function(P, B, side) {
  roc(response = c(rep("P", length(P)), rep("B", length(B))), predictor = c(P, B), levels = c("B", "P"),
      direction = if (side == "below") ">" else "<", quiet = TRUE)
}

points_of <- function(r, nP, nB) {
  co <- coords(r, "all", ret = c("threshold", "sensitivity", "specificity"), transpose = FALSE)
  co$tp <- round(co$sensitivity * nP)
  co$fp <- round((1 - co$specificity) * nB)
  co
}

# A rule's thresholds on the original scale: c(abnormal, normal).
rule_thresholds <- function(co, nP, nB, side, rule, rate) {
  if (rule == "youden") {
    j <- co$sensitivity + co$specificity
    best <- which(j == max(j))
    best <- best[which.min(co$fp[best])]
    return(c(co$threshold[best], co$threshold[best]))
  }
  maxB <- floor(rate * nB + 1e-9)
  maxP <- floor(rate * nP + 1e-9)
  A <- which(co$fp <= maxB)
  a <- A[order(-co$tp[A], co$fp[A])][1]
  W <- which(nP - co$tp <= maxP)
  w <- W[order(co$fp[W], -co$tp[W])][1]
  ta <- co$threshold[a]
  tn <- co$threshold[w]
  crossed <- if (side == "below") ta > tn else ta < tn
  if (crossed) {
    ta <- (ta + tn) / 2
    tn <- ta
  }
  c(ta, tn)
}

class_of <- function(x, side, ta, tn) {
  if (side == "below") ifelse(x <= ta, "abnormal-like", ifelse(x > tn, "WT-like", "intermediate"))
  else ifelse(x >= ta, "abnormal-like", ifelse(x < tn, "WT-like", "intermediate"))
}

counts_of <- function(x, side, ta, tn) {
  k <- class_of(x, side, ta, tn)
  list(`abnormal-like` = sum(k == "abnormal-like"), intermediate = sum(k == "intermediate"), `WT-like` = sum(k == "WT-like"))
}

wilson <- function(x, n) {
  w <- binom.confint(x, n, conf.level = 0.95, methods = "wilson")
  list(x = x, n = n, p = round13(w$mean), low = round13(w$lower), high = round13(w$upper))
}

classes_of <- function(P, B, side, ta, tn) {
  cp <- counts_of(P, side, ta, tn)
  cb <- counts_of(B, side, ta, tn)
  list(abnormal = finite13(ta), normal = finite13(tn), P = cp, B = cb,
       sensitivity = wilson(cp$`abnormal-like`, length(P)), specificity = wilson(cb$`WT-like`, length(B)))
}

oriented <- function(x, side) if (side == "below") -x else x

# Each distinct oriented score, from the highest, with the P and B controls at or beyond it.
steps_of <- function(oP, oB) {
  u <- sort(unique(c(oP, oB)), decreasing = TRUE)
  list(u = u, tp = vapply(u, function(v) sum(oP >= v), 0), fp = vapply(u, function(v) sum(oB >= v), 0))
}

# The precision at a recall on Keilwagen's interpolation: in the first step that reaches it.
precision_at <- function(s, nP, v) {
  tpPrev <- 0
  fpPrev <- 0
  for (i in seq_along(s$u)) {
    if (s$tp[i] > tpPrev && s$tp[i] >= v * nP - 1e-9) {
      h <- (s$fp[i] - fpPrev) / (s$tp[i] - tpPrev)
      x <- max(0, min(s$tp[i] - tpPrev, v * nP - tpPrev))
      return((tpPrev + x) / (tpPrev + x + fpPrev + h * x))
    }
    tpPrev <- s$tp[i]
    fpPrev <- s$fp[i]
  }
  NA
}

# PRROC's points without the interpolated ones, by recall ascending (its order reversed), and
# without the first and last it adds (recall 0 and 1, the ends' precision).
pr_points <- function(oP, oB) {
  pr <- pr.curve(scores.class0 = oP, scores.class1 = oB, curve = TRUE, minStepSize = Inf)
  m <- pr$curve[nrow(pr$curve):1, , drop = FALSE]
  list(pr = pr, curve = m)
}

quantiles <- function(x) {
  q <- quantile(x[is.finite(x)], c(0.025, 0.5, 0.975), type = 7, names = FALSE)
  list(low = round13(q[1]), median = round13(q[2]), high = round13(q[3]))
}

RULES <- list(list(rule = "error", rate = 0.05), list(rule = "error", rate = 0.1), list(rule = "youden", rate = NA))

reference <- function(name, P, B, side, seed, given = NULL) {
  # The scores as the reference gives them (13 significant digits), so that MaveScape reads the
  # very numbers R computed on.
  P <- round13(P)
  B <- round13(B)
  nP <- length(P)
  nB <- length(B)
  r <- roc_of(P, B, side)
  co <- points_of(r, nP, nB)
  delong <- ci.auc(r, method = "delong", conf.level = 0.95)
  oP <- oriented(P, side)
  oB <- oriented(B, side)
  pp <- pr_points(oP, oB)
  rules <- lapply(RULES, function(x) {
    t <- rule_thresholds(co, nP, nB, side, x$rule, x$rate)
    c(list(rule = x$rule, error = if (is.na(x$rate)) NULL else x$rate), classes_of(P, B, side, t[1], t[2]))
  })
  if (!is.null(given)) rules[[length(rules) + 1]] <- c(list(rule = "given"), classes_of(P, B, side, given[1], given[2]))
  # The bootstrap: pROC's own, then MaveScape's other measures on samples of the same kind.
  set.seed(seed)
  auc_boot <- ci.auc(r, method = "bootstrap", boot.n = BOOT, boot.stratified = TRUE, conf.level = 0.95)
  set.seed(seed + 1)
  se_band <- ci.se(r, specificities = seq(0, 1, 0.05), boot.n = BOOT, boot.stratified = TRUE, conf.level = 0.95)
  set.seed(seed + 2)
  recalls <- (1:20) * 0.05
  pr_auc <- numeric(BOOT)
  prec <- matrix(NA, BOOT, length(recalls))
  th <- lapply(RULES, function(x) matrix(NA, BOOT, 2))
  for (k in seq_len(BOOT)) {
    rp <- sample(P, replace = TRUE)
    rb <- sample(B, replace = TRUE)
    orp <- oriented(rp, side)
    orb <- oriented(rb, side)
    pr_auc[k] <- pr.curve(scores.class0 = orp, scores.class1 = orb)$auc.integral
    st <- steps_of(orp, orb)
    prec[k, ] <- vapply(recalls, function(v) precision_at(st, nP, v), 0)
    rr <- roc_of(rp, rb, side)
    cc <- points_of(rr, nP, nB)
    for (i in seq_along(RULES)) th[[i]][k, ] <- rule_thresholds(cc, nP, nB, side, RULES[[i]]$rule, RULES[[i]]$rate)
  }
  list(
    name = name, side = side, P = round13(P), B = round13(B),
    roc = list(threshold = finite13(co$threshold), sensitivity = round13(co$sensitivity), specificity = round13(co$specificity)),
    auc = list(auc = round13(as.numeric(r$auc)), low = round13(delong[1]), high = round13(delong[3])),
    pr = list(auc = round13(pp$pr$auc.integral), davisGoadrich = round13(pp$pr$auc.davis.goadrich),
              recall = round13(pp$curve[, 1]), precision = round13(pp$curve[, 2]), threshold = round13(pp$curve[, 3])),
    rules = rules,
    bootstrap = list(
      samples = BOOT,
      auc = list(low = round13(auc_boot[1]), median = round13(auc_boot[2]), high = round13(auc_boot[3])),
      roc = lapply(seq_len(nrow(se_band)), function(i) list(specificity = round13(seq(0, 1, 0.05)[i]), low = round13(se_band[i, 1]), median = round13(se_band[i, 2]), high = round13(se_band[i, 3]))),
      prAuc = quantiles(pr_auc),
      pr = lapply(seq_along(recalls), function(i) c(list(recall = round13(recalls[i])), quantiles(prec[, i]))),
      thresholds = lapply(seq_along(RULES), function(i) list(rule = RULES[[i]]$rule, error = if (is.na(RULES[[i]]$rate)) NULL else RULES[[i]]$rate,
        abnormal = quantiles(th[[i]][, 1]), normal = quantiles(th[[i]][, 2]),
        withoutZone = mean(th[[i]][, 1] == th[[i]][, 2]),
        empty = list(abnormal = sum(!is.finite(th[[i]][, 1])), normal = sum(!is.finite(th[[i]][, 2])))))
    )
  )
}

set.seed(20261014)
cases <- list(
  list(name = "P below B, overlapping", P = rnorm(150, -1, 0.8), B = rnorm(40, 0.3, 0.5), side = "below"),
  list(name = "P above B", P = rnorm(60, 1, 1), B = rnorm(60, 0, 1), side = "above"),
  list(name = "ties (one decimal)", P = round(rnorm(80, -0.8, 0.7), 1), B = round(rnorm(50, 0, 0.6), 1), side = "below"),
  list(name = "well apart (the error rule's thresholds cross)", P = rnorm(50, -2.2, 0.6), B = rnorm(50, 0, 0.6), side = "below"),
  list(name = "fully apart (AUC 1)", P = rnorm(30, -3, 0.5), B = rnorm(30, 0, 0.5), side = "below"),
  list(name = "few controls", P = rnorm(8, -1, 1), B = rnorm(6, 0, 1), side = "below")
)
f9 <- read.csv("validation/fixtures/controls/factor9-run1-controls.csv", stringsAsFactors = FALSE)
cases[[length(cases) + 1]] <- list(name = "factor IX's ClinVar controls in Run 1", P = f9$score[f9$side == "P"], B = f9$score[f9$side == "B"], side = "below", given = c(0.3, 0.7))

out <- list(
  generator = paste0("R ", R.version$major, ".", R.version$minor, "; pROC ", packageVersion("pROC"), "; PRROC ", packageVersion("PRROC"), "; binom ", packageVersion("binom")),
  method = "pROC::roc, coords('all'), ci.auc (delong; bootstrap, stratified), ci.se (bootstrap, stratified, specificities seq(0, 1, 0.05)); PRROC::pr.curve (auc.integral, auc.davis.goadrich, curve, minStepSize = Inf); binom::binom.confint (wilson); MaveScape's threshold rules, classes, precision at a recall and the bootstrap's other measures written out; quantile(type = 7). Rounded to 13 significant digits.",
  cases = lapply(seq_along(cases), function(i) { x <- cases[[i]]; reference(x$name, x$P, x$B, x$side, 20261100 + 10 * i, x$given) })
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, na = "null"), "validation/reference/calibration.json")
