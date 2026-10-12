# Reference agreement statistics for the validation suite `compare` (wave 4, slice 1;
# validation/reference/compare.json).
#
# Run from the repository root (DescTools 0.99, BlandAltmanLeh 0.3, pROC 1.19 and jsonlite), with
# DHFR's MaveDB tables in validation/cache (node validation/fetch.mjs mavedb-dhfr):
#
#     Rscript validation/reference/generate_compare.R
#
# Each case is a pair of score vectors x and y of the same variants, kept in the reference so that
# the suite gives MaveScape the same numbers: synthetic pairs of known shape (set.seed), and one
# real pair, DHFR's published scores without and with Lon (urn:mavedb:00000063-b-1 and -a-1)
# matched by their protein variants. For each:
#   - Pearson's r and its 95% interval: cor.test(x, y) (Fisher's z);
#   - Spearman's rho: cor(x, y, method = "spearman") (ties at their average rank), and its 95%
#     interval from Fisher's z with Bonett and Wright's SE sqrt((1 + rho^2/2)/(n - 3)), written out
#     here from the paper;
#   - Lin's concordance correlation: DescTools::CCC(x, y, ci = "z-transform"), with its interval,
#     the scale shift, location shift and accuracy C.b;
#   - Bland and Altman: BlandAltmanLeh::bland.altman.stats(x, y) (d = x - y), the bias and limits
#     with their 95% intervals;
#   - the trend of d on the means (x + y)/2: lm, its slope, interval and p.
# And one case of discordance (wave 4, slice 2): two independent sets of scores of 600 variants at
# 60 positions with their SEs, 30 variants and 3 positions planted to differ; each difference's
# z = (x - y)/sqrt(sx^2 + sy^2), p = 2 pnorm(-|z|), q = p.adjust(p, "BH"); and each position's
# (3 variants or more) z = sum(x - y)/sqrt(sum(sx^2 + sy^2)), p and q over the positions.
# Other sources and scales (wave 4, slice 3):
#   - rescaling: two assays of one protein's variants (the wild type, synonymous, nonsense and
#     missense), the same function measured on two scales (a log ratio, an abundance), each side
#     rescaled by its own anchors (nonsense median 0 and wild type 1; synonymous median 0 and
#     nonsense median -1), the anchors' SEs (the wild type's; a median's sqrt(pi/2 sum(se^2)/n)/sqrt(n)),
#     written out here as in anchors.js: Lin's concordance and Bland-Altman of the rescaled scores
#     (DescTools, BlandAltmanLeh), and each difference's z with the anchors' share of its variance
#     ((1 - t)^2 u0^2 + t^2 u1^2 on each side), p, q, and each position's z with the anchors'
#     shared variance ((sum(1 - t))^2 u0^2 + (sum t)^2 u1^2);
#   - classes: GRB2's published scores (urn:mavedb:00000835-a-1) against AlphaMissense (P62993),
#     matched on UniProt's numbering (the domain from residue 159): Spearman's rho of the score and
#     the negated pathogenicity, the scores' median and quartiles (type 7) in each of AlphaMissense's
#     classes, and the AUC of telling its likely benign from its likely pathogenic substitutions
#     with DeLong's interval (pROC::roc, ci.auc and var, method "delong");
#   - aucTies: an AUC and its DeLong interval with tied scores (pROC).
# Numbers rounded to 13 significant digits.

suppressPackageStartupMessages({
  library(jsonlite)
  library(DescTools)
  library(BlandAltmanLeh)
  library(pROC)
})

round13 <- function(x) as.numeric(formatC(x, digits = 13, format = "g"))

synthetic <- function() {
  set.seed(20261011)
  n <- 400
  x <- rnorm(n)
  cases <- list(
    list(name = "one scale, close agreement", x = x, y = x + rnorm(n, sd = 0.3)),
    list(name = "twice the scale (a proportional difference)", x = x, y = 2 * x + rnorm(n, sd = 0.3)),
    list(name = "shifted by 0.5", x = x, y = x + 0.5 + rnorm(n, sd = 0.3)),
    list(name = "weak and negative", x = x, y = -0.3 * x + rnorm(n))
  )
  # Ties: scores rounded to one decimal, as a table of published scores may give them.
  xt <- round(rnorm(200), 1)
  cases[[length(cases) + 1]] <- list(name = "ties (one decimal)", x = xt, y = round(xt + rnorm(200, sd = 0.5), 1))
  # Few variants.
  xs <- rnorm(12)
  cases[[length(cases) + 1]] <- list(name = "twelve variants", x = xs, y = xs + rnorm(12, sd = 0.6))
  cases
}

dhfr <- function() {
  read <- function(dir) {
    t <- read.csv(file.path("validation/cache/mavedb-dhfr", dir, "scores.csv"), check.names = FALSE, stringsAsFactors = FALSE)
    t <- t[!is.na(t$score) & t$hgvs_pro != "_wt" & t$hgvs_pro != "p.=" & !grepl("^p\\.\\[", t$hgvs_pro), c("hgvs_pro", "score")]
    t[!duplicated(t$hgvs_pro), ]
  }
  m <- merge(read("minus-lon"), read("plus-lon"), by = "hgvs_pro", suffixes = c(".minus", ".plus"), sort = FALSE)
  m <- m[order(m$hgvs_pro), ]
  list(name = "DHFR's published scores, without and with Lon", x = m$score.minus, y = m$score.plus, keys = m$hgvs_pro)
}

statistics <- function(case) {
  x <- case$x
  y <- case$y
  n <- length(x)
  p <- cor.test(x, y)
  rho <- cor(x, y, method = "spearman")
  se_rho <- sqrt((1 + rho^2 / 2) / (n - 3))
  q <- qnorm(0.975)
  ccc <- CCC(x, y, ci = "z-transform", conf.level = 0.95)
  ba <- bland.altman.stats(x, y, conf.int = 0.95)
  d <- x - y
  m <- (x + y) / 2
  fit <- lm(d ~ m)
  ci <- confint(fit)["m", ]
  list(
    n = n,
    pearson = list(r = round13(unname(p$estimate)), low = round13(p$conf.int[1]), high = round13(p$conf.int[2])),
    spearman = list(rho = round13(rho), low = round13(tanh(atanh(rho) - q * se_rho)), high = round13(tanh(atanh(rho) + q * se_rho))),
    concordance = list(
      ccc = round13(ccc$rho.c$est), low = round13(ccc$rho.c$lwr.ci), high = round13(ccc$rho.c$upr.ci),
      scaleShift = round13(ccc$s.shift), locationShift = round13(ccc$l.shift), accuracy = round13(ccc$C.b)
    ),
    blandAltman = list(
      bias = round13(ba$mean.diffs), lower = round13(ba$lower.limit), upper = round13(ba$upper.limit),
      biasLow = round13(unname(ba$CI.lines["mean.diff.ci.lower"])), biasHigh = round13(unname(ba$CI.lines["mean.diff.ci.upper"])),
      lowerLow = round13(unname(ba$CI.lines["lower.limit.ci.lower"])), lowerHigh = round13(unname(ba$CI.lines["lower.limit.ci.upper"])),
      upperLow = round13(unname(ba$CI.lines["upper.limit.ci.lower"])), upperHigh = round13(unname(ba$CI.lines["upper.limit.ci.upper"]))
    ),
    trend = list(slope = round13(unname(coef(fit)["m"])), low = round13(unname(ci[1])), high = round13(unname(ci[2])), p = round13(summary(fit)$coefficients["m", 4]))
  )
}

discordance <- function() {
  set.seed(20261012)
  n <- 600
  position <- rep(1:60, each = 10)
  truth <- rnorm(n)
  sx <- runif(n, 0.1, 0.3)
  sy <- runif(n, 0.1, 0.3)
  shift <- rep(0, n)
  planted <- sample(n, 30)
  shift[planted] <- sample(c(-1.5, 1.5), 30, replace = TRUE)
  planted_positions <- c(12, 31, 47)
  shift[position %in% planted_positions] <- shift[position %in% planted_positions] + 0.5
  x <- round13(truth + rnorm(n, sd = sx))
  y <- round13(truth + shift + rnorm(n, sd = sy))
  sx <- round13(sx)
  sy <- round13(sy)
  z <- (x - y) / sqrt(sx^2 + sy^2)
  p <- 2 * pnorm(-abs(z))
  q <- p.adjust(p, method = "BH")
  d <- x - y
  v <- sx^2 + sy^2
  pos <- sort(unique(position))
  pz <- sapply(pos, function(k) sum(d[position == k]) / sqrt(sum(v[position == k])))
  pp <- 2 * pnorm(-abs(pz))
  list(
    name = "discordance: 600 variants at 60 positions, 30 variants and 3 positions planted",
    x = x, y = y, sx = sx, sy = sy, position = position, planted = sort(planted), plantedPositions = planted_positions,
    z = round13(z), p = round13(p), q = round13(q),
    positions = list(position = pos, z = round13(pz), p = round13(pp), q = round13(p.adjust(pp, method = "BH")), mean = round13(sapply(pos, function(k) mean(d[position == k]))))
  )
}

# --- Other sources and scales (wave 4, slice 3) ---------------------------------------------------

rescaling <- function() {
  set.seed(20261013)
  # 361 variants: the wild type, then at each of 60 positions a synonymous one (positions 1-40), a
  # nonsense one (1-20) and five missense; the function f: the wild type and synonymous 1, nonsense
  # 0, missense mostly near 1 and some lost.
  kind <- "wild type"
  position <- 0
  for (p in 1:60) {
    if (p <= 40) { kind <- c(kind, "synonymous"); position <- c(position, p) }
    if (p <= 20) { kind <- c(kind, "nonsense"); position <- c(position, p) }
    kind <- c(kind, rep("missense", 5))
    position <- c(position, rep(p, 5))
  }
  n <- length(kind)
  f <- ifelse(kind %in% c("wild type", "synonymous"), 1, ifelse(kind == "nonsense", 0, NA))
  mis <- which(kind == "missense")
  lost <- runif(length(mis)) < 0.35
  f[mis] <- ifelse(lost, runif(length(mis), 0, 0.9), pmin(1.05, rnorm(length(mis), 1, 0.08)))
  sx <- runif(n, 0.08, 0.25)
  sy <- runif(n, 0.03, 0.08)
  sx[1] <- 0.06
  sy[1] <- 0.02
  x <- round13(-3 + 3 * f + rnorm(n, sd = sx))
  y <- round13(0.05 + 0.95 * f + rnorm(n, sd = sy))
  sx <- round13(sx)
  sy <- round13(sy)
  anchors <- function(score, se, what, to) {
    one <- function(w, t) {
      if (w == "wild type") {
        i <- which(kind == "wild type")[1]
        return(list(what = w, to = t, from = score[i], se = se[i], n = 1))
      }
      idx <- which(kind == w)
      s <- se[idx]
      list(what = w, to = t, from = median(score[idx]), se = sqrt((pi / 2) * sum(s^2) / length(s) / length(s)), n = length(idx))
    }
    a <- list(one(what[1], to[1]), one(what[2], to[2]))
    slope <- (a[[2]]$to - a[[1]]$to) / (a[[2]]$from - a[[1]]$from)
    list(anchors = a, slope = slope, u = c(a[[1]]$se, a[[2]]$se) * abs(slope), to = c(a[[1]]$to, a[[2]]$to))
  }
  mode <- function(name, what, to) {
    ra <- anchors(x, sx, what, to)
    rb <- anchors(y, sy, what, to)
    k <- which(kind != "wild type")
    xr <- ra$to[1] + (x[k] - ra$anchors[[1]]$from) * ra$slope
    yr <- rb$to[1] + (y[k] - rb$anchors[[1]]$from) * rb$slope
    sxr <- sx[k] * abs(ra$slope)
    syr <- sy[k] * abs(rb$slope)
    place <- function(v, r) (v - r$to[1]) / (r$to[2] - r$to[1])
    av <- function(v, r) (1 - place(v, r))^2 * r$u[1]^2 + place(v, r)^2 * r$u[2]^2
    z <- (xr - yr) / sqrt(sxr^2 + syr^2 + av(xr, ra) + av(yr, rb))
    p <- 2 * pnorm(-abs(z))
    st <- statistics(list(x = xr, y = yr))
    pos <- sort(unique(position[k]))
    pz <- sapply(pos, function(q) {
      m <- which(position[k] == q)
      shared <- function(v, r) sum(1 - place(v, r))^2 * r$u[1]^2 + sum(place(v, r))^2 * r$u[2]^2
      sum(xr[m] - yr[m]) / sqrt(sum(sxr[m]^2 + syr[m]^2) + shared(xr[m], ra) + shared(yr[m], rb))
    })
    pp <- 2 * pnorm(-abs(pz))
    side <- function(r) list(anchors = lapply(r$anchors, function(a) list(what = a$what, to = a$to, from = round13(a$from), se = round13(a$se), n = a$n)), slope = round13(r$slope))
    list(
      mode = name, a = side(ra), b = side(rb),
      x = round13(xr), y = round13(yr),
      concordance = st$concordance, blandAltman = st$blandAltman,
      z = round13(z), p = round13(p), q = round13(p.adjust(p, method = "BH")),
      positions = list(position = pos, z = round13(pz), p = round13(pp), q = round13(p.adjust(pp, method = "BH")))
    )
  }
  list(
    name = "two assays of one protein on two scales (-3 + 3f and 0.05 + 0.95f), each rescaled by its own anchors",
    kind = kind, position = position, x = x, y = y, sx = sx, sy = sy,
    modes = list(
      mode("nonsense-wt", c("nonsense", "wild type"), c(0, 1)),
      mode("synonymous-nonsense", c("synonymous", "nonsense"), c(0, -1))
    )
  )
}

classes <- function() {
  one <- c(Ala = "A", Arg = "R", Asn = "N", Asp = "D", Cys = "C", Gln = "Q", Glu = "E", Gly = "G", His = "H", Ile = "I", Leu = "L", Lys = "K", Met = "M", Phe = "F", Pro = "P", Ser = "S", Thr = "T", Trp = "W", Tyr = "Y", Val = "V")
  scores <- read.csv("validation/fixtures/public-data/mavedb/urn_mavedb_00000835-a-1.scores.csv", check.names = FALSE, stringsAsFactors = FALSE)
  scores <- scores[!duplicated(scores$hgvs_pro), ]
  am <- read.csv("validation/fixtures/public-data/alphafold/P62993.aa-substitutions.csv", stringsAsFactors = FALSE)
  m <- regmatches(scores$hgvs_pro, regexec("^p\\.([A-Z][a-z]{2})(\\d+)([A-Z][a-z]{2})$", scores$hgvs_pro))
  key <- vapply(m, function(v) if (length(v) == 4 && !is.na(one[v[2]]) && !is.na(one[v[4]])) paste0(one[v[2]], as.integer(v[3]) + 158, one[v[4]]) else NA_character_, "")
  j <- merge(data.frame(key = key, score = scores$score, stringsAsFactors = FALSE), am, by.x = "key", by.y = "protein_variant")
  j <- j[!is.na(j$key) & is.finite(j$score), ]
  n <- nrow(j)
  rho <- cor(j$score, -j$am_pathogenicity, method = "spearman")
  se_rho <- sqrt((1 + rho^2 / 2) / (n - 3))
  q <- qnorm(0.975)
  byClass <- lapply(c("LPath", "Amb", "LBen"), function(k) {
    s <- j$score[j$am_class == k]
    list(code = k, n = length(s), median = round13(median(s)), low = round13(unname(quantile(s, 0.25, type = 7))), high = round13(unname(quantile(s, 0.75, type = 7))))
  })
  r <- roc(controls = j$score[j$am_class == "LPath"], cases = j$score[j$am_class == "LBen"], direction = "<", quiet = TRUE)
  ci <- ci.auc(r, method = "delong")
  list(
    name = "GRB2's published scores (urn:mavedb:00000835-a-1) against AlphaMissense (P62993) by its classes",
    n = n,
    spearman = list(rho = round13(rho), low = round13(tanh(atanh(rho) - q * se_rho)), high = round13(tanh(atanh(rho) + q * se_rho))),
    classes = byClass,
    auc = list(auc = round13(as.numeric(ci[2])), low = round13(as.numeric(ci[1])), high = round13(as.numeric(ci[3])), se = round13(sqrt(var(r, method = "delong"))))
  )
}

aucTies <- function() {
  set.seed(20261014)
  cases <- round(rnorm(80, 0.8), 1)
  controls <- round(rnorm(120), 1)
  r <- roc(controls = controls, cases = cases, direction = "<", quiet = TRUE)
  ci <- ci.auc(r, method = "delong")
  list(name = "80 cases and 120 controls, scores rounded to one decimal (ties)", cases = cases, controls = controls,
    auc = round13(as.numeric(ci[2])), low = round13(as.numeric(ci[1])), high = round13(as.numeric(ci[3])), se = round13(sqrt(var(r, method = "delong"))))
}

cases <- c(synthetic(), list(dhfr()))
out <- list(
  generator = paste0("R ", R.version$major, ".", R.version$minor, "; DescTools ", packageVersion("DescTools"), "; BlandAltmanLeh ", packageVersion("BlandAltmanLeh"), "; pROC ", packageVersion("pROC")),
  method = "cor.test; cor(method = 'spearman') with Bonett and Wright's interval; DescTools::CCC(ci = 'z-transform'); BlandAltmanLeh::bland.altman.stats; lm(d ~ m); discordance by pnorm and p.adjust(method = 'BH'); rescaling by anchors written out; pROC::roc, ci.auc and var (method = 'delong'); quantile(type = 7). Rounded to 13 significant digits.",
  cases = lapply(cases, function(case) c(
    list(name = case$name, x = round13(case$x), y = round13(case$y)),
    if (!is.null(case$keys)) list(keys = case$keys),
    statistics(list(x = round13(case$x), y = round13(case$y)))
  )),
  discordance = discordance(),
  rescaling = rescaling(),
  classes = classes(),
  aucTies = aucTies()
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA), "validation/reference/compare.json")
cat("validation/reference/compare.json:", length(out$cases), "cases\n")
