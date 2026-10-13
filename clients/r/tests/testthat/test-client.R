# The R client against a running MaveScape (wave 7, slice 4): GRB2 opened and scored through the
# client, its scores table every number of Node's, a figure and the map written as files, errors
# carrying MaveScape's reason, results equal to the HTTP API's for the same actions, and MaveScape
# found through its connection file. clients/test-clients.mjs starts MaveScape and sets
# MAVESCAPE_TEST_URL, MAVESCAPE_TEST_TOKEN, MAVESCAPE_TEST_DIR, MAVESCAPE_TEST_EXPECTED and
# MAVESCAPE_DATA_DIR; without them the tests that need MaveScape are skipped.

url <- Sys.getenv("MAVESCAPE_TEST_URL")
token <- Sys.getenv("MAVESCAPE_TEST_TOKEN")
out <- Sys.getenv("MAVESCAPE_TEST_DIR", tempdir())
expected <- Sys.getenv("MAVESCAPE_TEST_EXPECTED")
live <- function() skip_if(!nzchar(url), "needs a running MaveScape (node clients/test-clients.mjs)")
png <- as.raw(c(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))

# The same action sent to the HTTP API directly, parsed as the client parses answers.
http <- function(action, args = structure(list(), names = character(0))) {
  handle <- curl::new_handle()
  curl::handle_setheaders(handle, "Content-Type" = "application/json", "X-MaveScape-Token" = token)
  curl::handle_setopt(handle, customrequest = "POST", postfields = jsonlite::toJSON(list(action = action, args = args, client = "R"), auto_unbox = TRUE))
  response <- curl::curl_fetch_memory(paste0(url, "/api/remote/action"), handle = handle)
  text <- rawToChar(response$content)
  Encoding(text) <- "UTF-8"
  jsonlite::fromJSON(text)
}

# Where a data frame of a run's variants differs from an exported CSV: each number the same double,
# NA where the CSV has NA, text as written.
differences <- function(got, path) {
  written <- utils::read.csv(path, colClasses = "character", na.strings = "NA", check.names = FALSE)
  out <- character(0)
  if (!identical(names(got), names(written))) out <- c(out, paste("columns", paste(names(got), collapse = ","), "against", paste(names(written), collapse = ",")))
  if (nrow(got) != nrow(written)) return(c(out, paste(nrow(got), "rows against", nrow(written))))
  for (column in intersect(names(got), names(written))) {
    w <- written[[column]]
    g <- got[[column]]
    if (!identical(is.na(w), is.na(g))) {
      out <- c(out, paste(column, ": NA in other rows"))
      next
    }
    ok <- !is.na(w)
    # Numbers read by jsonlite's parser, as the client reads them (R's as.numeric is not always
    # correctly rounded at 17 digits).
    numeric <- length(w[ok]) > 0 && all(grepl("^-?[0-9][0-9.]*([eE][-+]?[0-9]+)?$", w[ok]))
    same <- if (numeric) identical(as.numeric(jsonlite::fromJSON(paste0("[", paste(w[ok], collapse = ","), "]"))), as.numeric(g[ok])) else identical(w[ok], as.character(g[ok]))
    if (!same) out <- c(out, paste(column, ": values differ"))
  }
  out
}

test_that("it connects through the connection file, and its version is the program's", {
  live()
  ms <- ms_connect(client = "R")
  expect_equal(ms$url, url)
  expect_equal(ms$token, token)
  expect_equal(ms$version, as.character(utils::packageVersion("mavescape")))
  expect_output(print(ms), "MaveScape")
})

test_that("every action is a function", {
  live()
  tools <- ms_tools()
  expect_gt(nrow(tools), 50)
  missing <- tools$name[!vapply(paste0("ms_", tools$name), exists, logical(1), envir = asNamespace("mavescape"))]
  expect_equal(missing, character(0))
})

test_that("GRB2 opened and scored, its scores table Node's, as a data frame", {
  live()
  opened <- ms_open_example("grb2-sh3")
  expect_equal(opened$data$id, "grb2-sh3")
  scored <- ms_score(preset = "enrich2")
  expect_equal(scored$data$name, "Run 2")
  result <- ms_scores(run = "Run 1", limit = 0)
  expect_equal(result$data$total, 1121)
  frame <- as.data.frame(result)
  expect_s3_class(frame, "data.frame")
  expect_equal(nrow(frame), 1121)
  expect_equal(differences(frame, expected), character(0))
  expect_output(print(result), "Run 1")
  # A query's variants: positions 30 to 40 only.
  lower <- as.data.frame(ms_scores(run = "Run 1", query = "lower and position 30-40", columns = c("hgvs_pro", "score"), limit = 0))
  positions <- as.integer(gsub("[^0-9]", "", substring(lower$hgvs_pro, 6)))
  expect_true(all(positions >= 30 & positions <= 40))
  expect_equal(names(lower), c("hgvs_pro", "score"))
})

test_that("results equal the HTTP API's", {
  live()
  cases <- list(
    list(function() ms_qc_findings(run = "Run 1"), "qc_findings", list(run = "Run 1")),
    list(function() ms_scores(run = "Run 1", kinds = "nonsense", sort = "score", limit = 5), "scores", list(run = "Run 1", kinds = list("nonsense"), sort = "score", limit = 5)),
    list(function() ms_inspect_variant("p.Trp36Ala", run = "Run 1"), "inspect_variant", list(variant = "p.Trp36Ala", run = "Run 1"))
  )
  for (case in cases) {
    mine <- case[[1]]()
    theirs <- http(case[[2]], case[[3]])
    expect_true(theirs$ok, info = case[[2]])
    expect_equal(mine$message, theirs$message, info = case[[2]])
    expect_equal(mine$data, theirs$data, info = case[[2]])
  }
})

test_that("a figure and pictures are written as files", {
  live()
  ms_create_figure(name = "R figure", size = "single")
  ms_add_figure_panel(figure = "R figure", run = "Run 1")
  svg <- file.path(out, "r-figure.svg")
  unlink(svg)
  ms_export_figure("R figure", svg)
  expect_true(startsWith(readLines(svg, n = 1, warn = FALSE), "<svg"))
  page <- file.path(out, "r-figure.png")
  result <- ms_figures(figure = "R figure", file = page, dpi = 100)
  expect_equal(readBin(page, "raw", 8), png)
  expect_length(ms_images(result), 1)
  drawn <- file.path(out, "r-map.png")
  ms_render_map(run = "Run 1", from = 30, to = 40, file = drawn)
  expect_equal(readBin(drawn, "raw", 8), png)
})

test_that("exports need the token and never replace a file", {
  live()
  path <- file.path(out, "r-scores.csv")
  unlink(path)
  ms_export("scores", path, run = "Run 1")
  expect_equal(readLines(path), readLines(expected))
  expect_error(ms_export("scores", path, run = "Run 1"), "overwrite", class = "mavescape_error")
  without <- structure(list(url = url, token = "", client = "R", timeout = 60), class = "mavescape")
  refused <- tryCatch(ms_export("scores", file.path(out, "r-other.csv"), ms = without), mavescape_error = function(e) e)
  expect_equal(refused$status, 401)
})

test_that("errors carry MaveScape's reason", {
  live()
  expect_error(ms_call("no_such_action"), "Unknown action", class = "mavescape_error")
  wrong <- tryCatch(ms_scores(run = "Run 9"), mavescape_error = function(e) e)
  expect_match(conditionMessage(wrong), 'No score run "Run 9"', fixed = TRUE)
  expect_equal(wrong$action, "scores")
  gone <- tryCatch(ms_connect("http://127.0.0.1:9", ""), mavescape_error = function(e) e)
  expect_equal(gone$status, 0)
})

test_that("the connection file and the environment, without MaveScape", {
  folder <- tempfile()
  dir.create(folder)
  saved <- Sys.getenv(c("MAVESCAPE_URL", "MAVESCAPE_TOKEN"), unset = NA)
  Sys.unsetenv(c("MAVESCAPE_URL", "MAVESCAPE_TOKEN"))
  on.exit(for (k in names(saved)) if (!is.na(saved[[k]])) do.call(Sys.setenv, stats::setNames(list(saved[[k]]), k)), add = TRUE)
  expect_equal(mavescape:::.ms_find(folder)$url, "http://127.0.0.1:8820")
  writeLines('{"url": "http://127.0.0.1:8899", "token": "abc", "version": "x", "pid": 1}', file.path(folder, "remote.json"))
  found <- mavescape:::.ms_find(folder)
  expect_equal(found$url, "http://127.0.0.1:8899")
  expect_equal(found$token, "abc")
})

test_that("pictures in a result, without MaveScape", {
  result <- structure(list(action = "figures", message = "", data = list(figures = data.frame(name = c("A", "B"), image = c("data:image/png;base64,iVBORw0KGgo=", "data:image/png;base64,iVBORw0KGgo=")))), class = "mavescape_result")
  found <- ms_images(result)
  expect_length(found, 2)
  expect_equal(found[[1]], png)
  expect_equal(names(found), c("A", "B"))
  expect_error(ms_save_image(result, tempfile()), "2 pictures", class = "mavescape_error")
  file <- tempfile(fileext = ".png")
  ms_save_image(result, file, index = 2)
  expect_equal(readBin(file, "raw", 8), png)
})
