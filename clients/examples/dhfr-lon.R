# DHFR with and without the Lon protease, from R.
#
# MaveScape's DHFR example, run from an R script in the MaveScape window: every substitution of
# E. coli's DHFR grown for 18 hours in cells without the Lon protease and with it (Thompson et al.,
# eLife 2020, doi:10.7554/eLife.53476; MaveDB urn:mavedb:00000063-b-1 and -a-1, CC0). MaveScape
# opens both score sets from MaveDB with their counts, joins the counts into one table with a design
# of two conditions and scores them together: each condition's scores, and for every variant the
# difference +Lon - -Lon with its SE and q. The script asks which substitutions Lon penalizes, how
# sure each difference is and where in the protein they are. Each step appears in the window and
# goes into the workspace's history.
#
# To run it, start MaveScape with remote control, install the R client and run the script from a
# folder where it may write a folder dhfr-lon (its plots and tables):
#
#   mavescape --remote-control
#   R CMD INSTALL clients/r
#   Rscript clients/examples/dhfr-lon.R
#
# Opening the example downloads the two score sets and their counts from MaveDB once (about
# 2.4 MB); MaveScape keeps them in its cache. Each stopifnot() is what the project's CI checks when
# it runs this script against a build of MaveScape.

library(mavescape)

ms <- ms_connect(client = "DHFR script")
out <- "dhfr-lon"
dir.create(out, showWarnings = FALSE)
# The conditions as the example's design names them (the minus sign is U+2212).
without <- "\u2212Lon"
with <- "+Lon"
contrast <- paste(with, "vs", without)

# --- The example ------------------------------------------------------------------------------------
# The published scores of each record read as published (a run each), and the joined counts scored
# with MaveScape's defaults: Run 1.
opened <- ms_open_example("dhfr-lon")
cat(opened$message, "\n\n")

# --- Each condition ---------------------------------------------------------------------------------
# Substitutions that grow faster than the wild type (a score above 0.2): about twice as many without
# Lon as with it, in Run 1 as in the published scores (736 and 384, as the paper found).
condition <- function(run, which = NULL) as.data.frame(ms_scores(run = run, condition = which, limit = 0))
faster <- function(scores) sum(scores$score > 0.2, na.rm = TRUE)
growth <- data.frame(
  row.names = c("Run 1", "Published"),
  without_Lon = c(faster(condition("Run 1", without)), faster(condition("Published scores (deficient Lon)"))),
  with_Lon = c(faster(condition("Run 1", with)), faster(condition("Published scores (functioning Lon)")))
)
print(growth)
stopifnot(all(growth$without_Lon > 1.5 * growth$with_Lon), growth["Published", "without_Lon"] == 736)

# --- Against the published scores -------------------------------------------------------------------
# The authors fitted each time course by ordinary least squares; MaveScape's defaults weight each
# time point by its counts. Scored again their way (Run 2), both conditions follow the published
# scores more closely. Pearson's r only: the published scores are on their record's own scale.
ms_score(parameters = list(model = "ols"))
pearson <- function(run, which, published) ms_compare(a = paste0(run, ": ", which), b = published)$data$statistics$pearson$r
agreement <- data.frame(
  row.names = c("Run 1 (weighted)", "Run 2 (least squares)"),
  without_Lon = sapply(c("Run 1", "Run 2"), pearson, which = without, published = "Published scores (deficient Lon)"),
  with_Lon = sapply(c("Run 1", "Run 2"), pearson, which = with, published = "Published scores (functioning Lon)")
)
print(round(agreement, 3))
stopifnot(all(agreement[2, ] > agreement[1, ]), all(agreement[2, ] > 0.95))

# --- The difference Lon makes -----------------------------------------------------------------------
# Run 1's differential scores: each variant's difference +Lon - -Lon, its SE, z, p and q (Benjamini-
# Hochberg). Almost every difference called is negative: Lon penalizes, it does not help.
difference <- as.data.frame(ms_scores(run = "Run 1", contrast = contrast, limit = 0))
estimated <- difference[!is.na(difference$q), ]
called <- estimated[estimated$q < 0.05, ]
cat(sprintf("\n%d differences estimated, %d called at q < 0.05, %d of them negative.\n", nrow(estimated), nrow(called), sum(called$difference < 0)))
stopifnot(nrow(called) == 377, mean(called$difference < 0) > 0.9)

# The residue each called substitution replaces: more often a hydrophobic one (V, I, L, M, F, W, Y)
# than among the substitutions estimated, as the paper found for DHFR's buried core.
residue <- function(variants) substr(variants$hgvs_pro, 3, 5)
hydrophobic <- c("Val", "Ile", "Leu", "Met", "Phe", "Trp", "Tyr")
share <- c(
  penalized = mean(residue(called[called$difference < 0, ]) %in% hydrophobic),
  estimated = mean(residue(estimated) %in% hydrophobic)
)
cat("Share of hydrophobic residues replaced:\n")
print(round(share, 2))
stopifnot(share[["penalized"]] > 1.4 * share[["estimated"]])

# Where: every difference by position, the called ones in color, and each position's mean (single
# substitutions only: four variants are more than one change).
single <- grepl("^p\\.[A-Za-z]{3}[0-9]+[A-Za-z]{3}$", estimated$hgvs_pro)
estimated <- estimated[single, ]
estimated$position <- as.integer(sub("^p\\.[A-Za-z]{3}([0-9]+).*$", "\\1", estimated$hgvs_pro))
means <- tapply(estimated$difference, estimated$position, mean)
beyond <- sum(abs(estimated$difference) > 5)
png(file.path(out, "difference-by-position.png"), width = 1800, height = 650, res = 200)
par(mar = c(4, 4.2, 2.6, 1))
plot(estimated$position, estimated$difference, pch = 16, cex = 0.35, ylim = c(-5, 5),
  col = ifelse(estimated$q < 0.05, "#d1603d", "#b8c4d6"),
  xlab = "Position in DHFR", ylab = "+Lon \u2212 \u2212Lon", main = "The difference Lon makes, each substitution")
mtext(sprintf("%d differences beyond \u00b15 not shown", beyond), side = 3, line = 0.2, cex = 0.7)
lines(as.integer(names(means)), means, col = "#1f3b63", lwd = 1.2)
abline(h = 0, col = "grey50", lty = 2)
legend("bottomleft", c("q < 0.05", "not called", "mean at the position"), pch = c(16, 16, NA), lty = c(NA, NA, 1),
  col = c("#d1603d", "#b8c4d6", "#1f3b63"), bty = "n", cex = 0.8)
invisible(dev.off())
most <- head(sort(table(estimated$position[estimated$q < 0.05 & estimated$difference < 0]), decreasing = TRUE), 8)
cat("\nThe positions with the most substitutions penalized: ", paste0(names(most), " (", most, ")", collapse = ", "), "\n", sep = "")

# MaveScape's own picture of it: the map colored by the difference, as its SVG export draws it.
ms_render_map(run = "Run 1", contrast = contrast, file = file.path(out, "difference-map.png"))

# And the differential scores as MaveScape exports them (export takes an absolute path).
ms_export("differential", path = file.path(normalizePath(out), "differential.csv"), run = "Run 1", overwrite = TRUE)
exported <- utils::read.csv(file.path(out, "differential.csv"), check.names = FALSE)
stopifnot(nrow(exported) == nrow(difference), sum(exported$q < 0.05, na.rm = TRUE) == nrow(called))

cat("\nWritten to ", out, ": ", paste(list.files(out), collapse = ", "), "\n", sep = "")
