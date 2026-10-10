// Delimited text tables (CSV, TSV and their relatives), read in parts as they stream from a file
// (requirement D1). The reader detects the encoding (BOM, UTF-8, else Windows-1252), the
// delimiter (comma, tab, semicolon or bar), RFC 4180 quoting (doubled quotes, line breaks inside
// quotes), line ends (CRLF, as MaveDB writes them; LF; and CR alone, as old Mac files and DiMSum's
// demo design have them), a header row, and leading comment lines (#). It never coerces silently:
// a column of text keeps its text, a column whose every value is a number is kept as a
// Float64Array (missing values NaN, never 0; its text is not kept, which halves a large table's
// memory), and every irregular row or value is a diagnostic naming its line.
//
//   const parser = createTableParser(); parser.push(text1); parser.push(text2); const table = parser.finish();
//   table = { columns: [{ name, index, values: string[] | null (null for a column of numbers),
//             numeric: Float64Array | null, type, missing, nonNumeric: [{ line, value }],
//             nonNumericCount, integer, missingTokens }],
//             rows, lines, delimiter, lineEnd, header, diagnostics: [{ level, code, message, line?, column? }] }

// Cells read as missing. Spelled out in the table's diagnostics (missingTokens) so nothing is
// treated as missing without saying so.
export const MISSING_TOKENS = ['', 'NA', 'N/A', 'NaN', 'nan', 'null', 'NULL', 'None'];
const MISSING = new Set(MISSING_TOKENS);
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const DECIMAL_COMMA = /^[+-]?\d+(?:,\d+)?$/;
const DELIMITERS = [',', '\t', ';', '|'];
const MAX_EXAMPLES = 10;

export function isMissing(cell) {
  return MISSING.has(cell);
}

// A number from a cell, strictly: NaN for anything that is not written as a plain decimal number
// (no hexadecimal, Infinity, thousands separators or spaces).
export function parseNumber(cell) {
  return NUMBER.test(cell) ? Number(cell) : Number.NaN;
}

// Text from bytes: { text, encoding, bom, diagnostics }.
export function decodeBytes(bytes) {
  const diagnostics = [];
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8', bom: true, diagnostics };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le', bom: true, diagnostics };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be', bom: true, diagnostics };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8', bom: false, diagnostics };
  } catch {
    diagnostics.push({ level: 'warning', code: 'encoding', message: 'The file is not UTF-8; it was read as Windows-1252 (Latin-1). Check accented names.' });
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252', bom: false, diagnostics };
  }
}

// Splits sample lines on a delimiter, honoring quotes; for sniffing only.
function splitSample(line, delimiter) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

// The delimiter and line end of a sample of the text's start. The delimiter is the one that
// splits the most lines into the same number (more than one) of fields; a name hint (.tsv) breaks
// ties.
export function sniff(sample, options = {}) {
  const lineEnd = /\r\n/.test(sample) ? 'crlf' : /\n/.test(sample) ? 'lf' : /\r/.test(sample) ? 'cr' : 'lf';
  const lines = sample.split(/\r\n|\n|\r/).filter((line) => line.length && !line.startsWith('#')).slice(0, 50);
  if (lines.length && sample.length >= 65536 && !/\r\n|\n|\r$/.test(sample)) lines.pop(); // the last line may be cut
  let best = { delimiter: options.delimiter ?? (options.fileName && /\.tsv(\.gz)?$|\.tab$/i.test(options.fileName) ? '\t' : ','), score: -1 };
  if (!options.delimiter) {
    for (const delimiter of DELIMITERS) {
      const counts = lines.map((line) => splitSample(line, delimiter).length);
      if (!counts.length || counts[0] < 2) continue;
      const consistent = counts.filter((n) => n === counts[0]).length;
      const score = consistent * 1000 + counts[0];
      const hinted = options.fileName && /\.tsv(\.gz)?$|\.tab$/i.test(options.fileName) && delimiter === '\t';
      if (score > best.score || (score === best.score && hinted)) best = { delimiter, score };
    }
  }
  return { delimiter: best.delimiter, lineEnd };
}

// A streaming parser. push(text) with consecutive parts of the decoded text; finish() returns the
// table. options: { delimiter, header: 'auto' | true | false, fileName }.
//
// Fields go straight into columns (no array per row), and an unquoted field is one slice of its
// part: a million rows of eight columns are read in about a second and held in about 110 MB
// (requirement D9).
export function createTableParser(options = {}) {
  const diagnostics = [];
  let delimiter = options.delimiter ?? null;
  let lineEnd = null;
  let pending = ''; // text kept until the delimiter is known
  let started = false;
  let field = '';
  const row = [];
  let quoted = false;
  let afterQuote = false; // a quoted field has closed; only a delimiter or line end may follow
  let crPending = false;
  let line = 1;
  let rowLine = 1;
  // The table by column, the header row (when there is one) included; the line of each row; the
  // rows whose number of fields differs from the first's, as [row, fields] pairs.
  const columns = [];
  const rowLines = [];
  const odd = [];
  let rows = 0;
  let firstWidth = 0;
  let comments = 0;
  let blank = 0;
  let strayQuotes = 0;
  let firstStray = 0;

  const endField = () => {
    row.push(field);
    field = '';
    afterQuote = false;
  };
  const endRow = () => {
    endField();
    if (row.length === 1 && row[0] === '') blank += 1;
    else if (!rows && row[0].startsWith('#')) comments += 1;
    else {
      if (!rows) firstWidth = row.length;
      if (row.length !== firstWidth) odd.push([rows, row.length]);
      while (columns.length < row.length) columns.push(new Array(rows).fill(''));
      for (let j = 0; j < columns.length; j += 1) columns[j].push(j < row.length ? row[j] : '');
      rowLines.push(rowLine);
      rows += 1;
    }
    row.length = 0;
  };

  function consume(text) {
    const d = delimiter.charCodeAt(0);
    const n = text.length;
    let run = -1; // where the current field's unquoted characters not yet in `field` start
    for (let i = 0; i < n; i += 1) {
      const ch = text.charCodeAt(i);
      if (crPending) {
        crPending = false;
        if (ch === 10) continue;
      }
      if (quoted) {
        if (ch === 34) {
          if (text.charCodeAt(i + 1) === 34) {
            field += '"';
            i += 1;
          } else if (i + 1 === n) {
            // A quote at the end of a part: decided by the next part.
            quoted = false;
            afterQuote = 'maybe';
          } else {
            quoted = false;
            afterQuote = true;
          }
        } else {
          if (ch === 10 || ch === 13) line += 1;
          if (ch === 13 && text.charCodeAt(i + 1) === 10) {
            field += '\r\n';
            i += 1;
          } else field += text[i];
        }
        continue;
      }
      if (afterQuote === 'maybe') {
        afterQuote = true;
        if (ch === 34) {
          field += '"';
          quoted = true;
          afterQuote = false;
          continue;
        }
      }
      if (ch === d) {
        if (run >= 0) field += text.slice(run, i);
        run = -1;
        endField();
      } else if (ch === 10 || ch === 13) {
        if (run >= 0) field += text.slice(run, i);
        run = -1;
        endRow();
        line += 1;
        rowLine = line;
        if (ch === 13) crPending = true;
      } else if (ch === 34 && field === '' && run < 0 && !afterQuote) {
        quoted = true;
      } else {
        if (ch === 34 || afterQuote) {
          strayQuotes += 1;
          if (!firstStray) firstStray = line;
        }
        if (run < 0) run = i;
        afterQuote = false;
      }
    }
    if (run >= 0) field += text.slice(run);
  }

  return {
    push(text) {
      if (!started) {
        pending += text;
        if (pending.length < 65536) return;
        start();
        return;
      }
      consume(text);
    },
    finish() {
      if (!started) start();
      if (quoted) diagnostics.push({ level: 'error', code: 'unclosed-quote', message: `A quoted field opened on line ${rowLine} is never closed.`, line: rowLine });
      if (afterQuote === 'maybe') afterQuote = true;
      if (field !== '' || row.length) endRow();
      return build();
    },
  };

  function start() {
    started = true;
    const sniffed = sniff(pending, { delimiter, fileName: options.fileName });
    delimiter = sniffed.delimiter;
    lineEnd = sniffed.lineEnd;
    const text = pending;
    pending = '';
    consume(text);
  }

  // Row r's fields (the first rows only: the header's decision).
  function fieldsOf(r) {
    const width = odd.find(([x]) => x === r)?.[1] ?? firstWidth;
    return columns.slice(0, width).map((c) => c[r]);
  }

  function build() {
    if (comments) diagnostics.push({ level: 'info', code: 'comments', message: `${comments} comment line${comments > 1 ? 's' : ''} (starting with #) before the table ${comments > 1 ? 'were' : 'was'} skipped.` });
    if (strayQuotes) diagnostics.push({ level: 'warning', code: 'stray-quote', message: `${strayQuotes} quote character${strayQuotes > 1 ? 's' : ''} inside unquoted fields were kept as text (first on line ${firstStray}).`, line: firstStray });
    if (!rows) {
      diagnostics.push({ level: 'error', code: 'empty', message: 'The file holds no table.' });
      return { columns: [], rows: 0, lines: line, delimiter, lineEnd, header: false, diagnostics };
    }
    const first = fieldsOf(0);
    const looksNumeric = (cells) => cells.filter((c) => NUMBER.test(c)).length;
    let header = options.header ?? 'auto';
    if (header === 'auto') {
      // A header names columns: no number in the first row where the rows below hold numbers.
      const below = [];
      for (let r = 1; r < Math.min(rows, 21); r += 1) below.push(fieldsOf(r));
      header = !(looksNumeric(first) > 0 && below.length && looksNumeric(first) >= Math.max(...below.map(looksNumeric)));
    }
    const width = Math.max(firstWidth, ...odd.filter(([r]) => r < 1000).map(([, w]) => w));
    let names = header ? first.map((name) => name.trim()) : Array.from({ length: first.length }, (_, i) => `Column ${i + 1}`);
    if (!header) diagnostics.push({ level: 'warning', code: 'no-header', message: 'The first row holds numbers, so it was read as data; columns are named Column 1, Column 2…' });
    // Unnamed and repeated column names are made unique, and said.
    const seen = new Map();
    names = names.map((name, i) => {
      let unique = name || `Column ${i + 1}`;
      if (!name && header) diagnostics.push({ level: 'warning', code: 'unnamed-column', message: `Column ${i + 1} has no name; it is called "${unique}".`, column: unique });
      if (seen.has(unique)) {
        let k = 2;
        while (seen.has(`${unique} (${k})`)) k += 1;
        diagnostics.push({ level: 'warning', code: 'duplicate-column', message: `Two columns are named "${unique}"; the second is called "${unique} (${k})".`, column: unique });
        unique = `${unique} (${k})`;
      }
      seen.set(unique, i);
      return unique;
    });
    const skip = header ? 1 : 0;
    const n = rows - skip;
    const lines = header ? rowLines.slice(1) : rowLines;
    const ragged = odd.map(([r, w]) => [r - skip, w]);
    if (ragged.length) {
      const shown = ragged.slice(0, 5).map(([r, w]) => `line ${lines[r]} (${w})`).join(', ');
      diagnostics.push({ level: 'error', code: 'ragged-rows', message: `${ragged.length} row${ragged.length > 1 ? 's have' : ' has'} a different number of fields than the header's ${names.length}: ${shown}${ragged.length > 5 ? ', …' : ''}. Missing fields are read as empty.`, line: lines[ragged[0][0]], rows: ragged.slice(0, 100).map(([r]) => lines[r]) });
    }
    if (width > names.length) diagnostics.push({ level: 'error', code: 'extra-fields', message: `Some rows have ${width} fields but the header names ${names.length}; the extra fields are not read.` });
    const typed = names.map((name, index) => {
      const values = columns[index];
      if (header) values.shift();
      columns[index] = null;
      return typeColumn({ name, index, values }, lines, delimiter, diagnostics);
    });
    columns.length = 0;
    return { columns: typed, rows: n, lines: line, delimiter, lineEnd, header: Boolean(header), diagnostics, lineOfRow: Int32Array.from(lines) };
  }
}

// Types a column: numeric when every present value is a number (or, with a delimiter other than
// the comma, every value a number with a decimal comma, said in a diagnostic). A column of
// numbers keeps them as a Float64Array alone, not their text.
function typeColumn(column, lines, delimiter, diagnostics) {
  const { values } = column;
  const n = values.length;
  let missing = 0;
  const missingTokens = new Set();
  const nonNumeric = [];
  let nonNumericCount = 0;
  let integer = true;
  let commaDecimals = 0;
  const numeric = new Float64Array(n);
  for (let r = 0; r < n; r += 1) {
    const raw = values[r];
    const cell = raw.trim();
    if (MISSING.has(cell)) {
      missing += 1;
      missingTokens.add(cell);
      numeric[r] = Number.NaN;
      continue;
    }
    if (NUMBER.test(cell)) {
      const x = Number(cell);
      numeric[r] = x;
      if (!Number.isInteger(x)) integer = false;
      continue;
    }
    if (delimiter !== ',' && DECIMAL_COMMA.test(cell)) {
      numeric[r] = Number(cell.replace(',', '.'));
      commaDecimals += 1;
      if (!Number.isInteger(numeric[r])) integer = false;
      continue;
    }
    numeric[r] = Number.NaN;
    nonNumericCount += 1;
    if (nonNumeric.length < MAX_EXAMPLES) nonNumeric.push({ line: lines[r], value: raw });
  }
  const present = n - missing;
  let type;
  if (!present) type = 'empty';
  else if (!nonNumericCount) type = 'number';
  else if (nonNumericCount < present) type = 'mixed';
  else type = 'text';
  if (type === 'number' && commaDecimals) diagnostics.push({ level: 'warning', code: 'decimal-comma', message: `Column "${column.name}" writes ${commaDecimals} number${commaDecimals > 1 ? 's' : ''} with a decimal comma; read as decimals.`, column: column.name });
  return {
    ...column,
    // A column of numbers keeps its numbers only (cellText gives a cell's text back).
    values: type === 'number' ? null : values,
    type,
    numeric: type === 'number' ? numeric : null,
    integer: type === 'number' && integer,
    missing,
    missingTokens: [...missingTokens],
    nonNumeric,
    nonNumericCount: type === 'text' ? 0 : nonNumericCount,
  };
}

// A whole table from text or bytes at once (tests, small files).
export function parseTable(input, options = {}) {
  let text = input;
  const extra = [];
  let encoding = 'utf-16';
  if (input instanceof Uint8Array) {
    const decoded = decodeBytes(input);
    text = decoded.text;
    encoding = decoded.encoding;
    extra.push(...decoded.diagnostics);
  } else if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const parser = createTableParser(options);
  parser.push(text);
  const table = parser.finish();
  return { ...table, encoding, diagnostics: [...extra, ...table.diagnostics] };
}

// A cell's text: as written in a column of text; in a column of numbers (whose text is not kept),
// the number in JavaScript's shortest form, and '' where missing.
export function cellText(column, row) {
  if (column.values) return column.values[row];
  const x = column.numeric[row];
  return Number.isNaN(x) ? '' : String(x);
}

// A column's cells as text (cellText), for the few readers that need them all.
export function columnText(column) {
  return column.values ?? Array.from(column.numeric, (x) => (Number.isNaN(x) ? '' : String(x)));
}

export function columnByName(table, name) {
  return table.columns.find((c) => c.name === name) ?? null;
}
