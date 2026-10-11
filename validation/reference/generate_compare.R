# Reference agreement statistics for the validation suite `compare` (wave 4, slice 1;
# validation/reference/compare.json).
#
# Run from the repository root (DescTools 0.99, BlandAltmanLeh 0.3 and jsonlite), with DHFR's MaveDB
# tables in validation/cache (node validation/fetch.mjs mavedb-dhfr):
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
# Numbers rounded to 13 significant digits.

suppressPackageStartupMessages({
  library(jsonlite)
  library(DescTools)
  library(BlandAltmanLeh)
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

cases <- c(synthetic(), list(dhfr()))
out <- list(
  generator = paste0("R ", R.version$major, ".", R.version$minor, "; DescTools ", packageVersion("DescTools"), "; BlandAltmanLeh ", packageVersion("BlandAltmanLeh")),
  method = "cor.test; cor(method = 'spearman') with Bonett and Wright's interval; DescTools::CCC(ci = 'z-transform'); BlandAltmanLeh::bland.altman.stats; lm(d ~ m); discordance by pnorm and p.adjust(method = 'BH'). Rounded to 13 significant digits.",
  cases = lapply(cases, function(case) c(
    list(name = case$name, x = round13(case$x), y = round13(case$y)),
    if (!is.null(case$keys)) list(keys = case$keys),
    statistics(list(x = round13(case$x), y = round13(case$y)))
  )),
  discordance = discordance()
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA), "validation/reference/compare.json")
cat("validation/reference/compare.json:", length(out$cases), "cases\n")
