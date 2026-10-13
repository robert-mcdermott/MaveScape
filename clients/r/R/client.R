# Remote control of a running MaveScape: the connection, any action by its name, results as data
# frames and pictures as files. The help pages are in man/; NAMESPACE and the action functions
# (tools.R) are written by clients/generate.mjs. After CytoWeave 0.8.0's R client.

.ms <- new.env(parent = emptyenv())
.png <- "data:image/png;base64,"

# Connect to a running MaveScape
#
# MaveScape started with --remote-control accepts actions from programs on this computer.
# Without arguments, the connection is found in the environment (MAVESCAPE_URL,
# MAVESCAPE_TOKEN) or in the remote.json file MaveScape writes to its data folder
# (data_dir, MAVESCAPE_DATA_DIR or the default folder).
ms_connect <- function(url = NULL, token = NULL, client = "R", timeout = 3600, data_dir = NULL) {
  if (is.null(url) || is.null(token)) {
    found <- .ms_find(data_dir)
    if (is.null(url)) url <- found$url
    if (is.null(token)) token <- found$token
  }
  ms <- structure(list(url = sub("/+$", "", url), token = token, client = client, timeout = timeout), class = "mavescape")
  info <- .ms_request(ms, "GET", "/api/remote/tools")
  ms$version <- info$version
  .ms$default <- ms
  ms
}

# The connection the functions use by default: the last one ms_connect() made.
ms_default <- function() {
  if (is.null(.ms$default)) ms_connect() else .ms$default
}

# Perform any MaveScape action by its name
#
# Arguments are named as MaveScape names them; NULL arguments are left out. The action is .action,
# so that no argument's name (compare's a) is taken for it by R's partial matching.
ms_call <- function(.action, ..., .args = list(), ms = ms_default()) {
  action <- .action
  args <- c(list(...), .args)
  args <- args[!vapply(args, is.null, logical(1))]
  if (!length(args)) args <- structure(list(), names = character(0))
  body <- jsonlite::toJSON(list(action = action, args = args, client = ms$client), auto_unbox = TRUE, null = "null", digits = NA)
  answer <- .ms_request(ms, "POST", "/api/remote/action", body, action)
  if (!isTRUE(answer$ok)) {
    stop(.ms_error(if (!is.null(answer$message)) answer$message else paste(action, "failed"), 200, action))
  }
  structure(list(action = action, message = answer$message, data = answer$data), class = "mavescape_result")
}

# The actions this MaveScape performs
ms_tools <- function(ms = ms_default()) {
  info <- .ms_request(ms, "GET", "/api/remote/tools", simplify = TRUE)
  info$tools[, c("name", "title", "description")]
}

# The pictures in a result (render_map with image, render_structure, figures with image), in
# order: a list of raw vectors (PNG), named by their captions where the data gives them.
ms_images <- function(result) {
  found <- list()
  captions <- character(0)
  walk <- function(value, caption) {
    if (is.data.frame(value)) {
      for (i in seq_len(nrow(value))) walk(as.list(value[i, , drop = FALSE]), caption)
    } else if (is.list(value)) {
      own <- caption
      for (key in c("caption", "title", "name")) {
        if (!is.null(names(value)) && is.character(value[[key]]) && length(value[[key]]) == 1 && nzchar(value[[key]])) {
          own <- value[[key]]
          break
        }
      }
      for (item in value) walk(item, own)
    } else if (is.character(value)) {
      for (text in value) {
        if (!is.na(text) && startsWith(text, .png)) {
          found[[length(found) + 1]] <<- jsonlite::base64_dec(substring(text, nchar(.png) + 1))
          captions[[length(captions) + 1]] <<- caption
        }
      }
    }
  }
  walk(result$data, "")
  names(found) <- captions
  found
}

# Save a picture of a result as a PNG file
ms_save_image <- function(result, file, index = NULL) {
  found <- ms_images(result)
  if (!length(found)) stop(.ms_error(paste(result$action, "returned no picture (render_map and figures give one with image = TRUE)"), 0, result$action))
  if (is.null(index) && length(found) > 1) stop(.ms_error(paste0(result$action, " returned ", length(found), " pictures: give index (from 1), or name one figure"), 0, result$action))
  writeBin(found[[if (is.null(index)) 1 else index]], file)
  invisible(file)
}

print.mavescape <- function(x, ...) {
  cat("<MaveScape ", x$version, " at ", x$url, if (is.null(x$token) || !nzchar(x$token)) " (no token)", ">\n", sep = "")
  invisible(x)
}

print.mavescape_result <- function(x, ...) {
  cat(x$action, ": ", x$message, "\n", sep = "")
  invisible(x)
}

# A list of records in a result's data as a data frame: data[[key]], or the first one found (the
# rows of ms_scores: its variants)
as.data.frame.mavescape_result <- function(x, row.names = NULL, optional = FALSE, key = NULL, ...) {
  value <- if (!is.null(key)) x$data[[key]] else if (is.data.frame(x$data)) x$data else Find(is.data.frame, x$data)
  if (is.null(value)) stop(paste0(x$action, " returned no table; its data has ", paste(names(x$data), collapse = ", ")))
  as.data.frame(value, row.names = row.names, optional = optional, ...)
}

# --- Internals ------------------------------------------------------------------------------------

# Arrays stay arrays in JSON, even of one element.
.ms_array <- function(x) if (is.null(x)) NULL else as.list(x)

.ms_error <- function(message, status, action) {
  structure(class = c("mavescape_error", "error", "condition"), list(message = message, call = NULL, status = status, action = action))
}

.ms_default_data_dir <- function() {
  home <- path.expand("~")
  if (.Platform$OS.type == "windows") {
    base <- Sys.getenv("APPDATA")
    return(if (nzchar(base)) file.path(base, "MaveScape") else file.path(home, ".mavescape"))
  }
  if (Sys.info()[["sysname"]] == "Darwin") return(file.path(home, "Library", "Application Support", "MaveScape"))
  base <- Sys.getenv("XDG_CONFIG_HOME")
  file.path(if (nzchar(base)) base else file.path(home, ".config"), "MaveScape")
}

.ms_find <- function(data_dir = NULL) {
  url <- Sys.getenv("MAVESCAPE_URL")
  token <- Sys.getenv("MAVESCAPE_TOKEN")
  token <- if (nzchar(token)) token else NULL
  if (nzchar(url)) return(list(url = url, token = token))
  folder <- if (!is.null(data_dir)) data_dir else if (nzchar(Sys.getenv("MAVESCAPE_DATA_DIR"))) Sys.getenv("MAVESCAPE_DATA_DIR") else .ms_default_data_dir()
  path <- file.path(folder, "remote.json")
  info <- tryCatch(jsonlite::fromJSON(path), error = function(e) NULL, warning = function(w) NULL)
  if (is.null(info$url)) return(list(url = "http://127.0.0.1:8820", token = token))
  list(url = info$url, token = if (!is.null(token)) token else info$token)
}

.ms_request <- function(ms, method, path, body = NULL, action = NULL, simplify = TRUE) {
  handle <- curl::new_handle(timeout = ms$timeout)
  headers <- c(Accept = "application/json")
  if (!is.null(ms$token) && nzchar(ms$token)) headers[["X-MaveScape-Token"]] <- ms$token
  if (!is.null(body)) {
    headers[["Content-Type"]] <- "application/json"
    curl::handle_setopt(handle, customrequest = method, postfields = enc2utf8(as.character(body)))
  }
  do.call(curl::handle_setheaders, c(list(handle), as.list(headers)))
  response <- tryCatch(curl::curl_fetch_memory(paste0(ms$url, path), handle = handle), error = function(e) {
    stop(.ms_error(paste0("MaveScape is not running at ", ms$url, " (", conditionMessage(e), "). Start it with: mavescape --remote-control"), 0, action))
  })
  text <- rawToChar(response$content)
  Encoding(text) <- "UTF-8"
  answer <- tryCatch(jsonlite::fromJSON(text, simplifyVector = simplify), error = function(e) NULL)
  if (response$status_code >= 400) {
    message <- if (!is.null(answer$error)) answer$error else text
    if (response$status_code == 404 && startsWith(path, "/api/remote/")) message <- paste0(ms$url, " does not accept actions: start MaveScape with --remote-control.")
    stop(.ms_error(message, response$status_code, action))
  }
  if (is.null(answer)) stop(.ms_error(paste("MaveScape answered with something other than JSON:", substr(text, 1, 200)), response$status_code, action))
  answer
}
