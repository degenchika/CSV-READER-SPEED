// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly what readCsv returns
// for {text, header} -> {columns, rows, errors}, but without the reference's
// character-at-a-time loop. Same semantics, including every error code, the line
// reset on an unterminated quote, and the "line held only stray CRs" rule.
//
// Two paths:
//  - Unquoted fields are found with indexOf (one C++ scan per delimiter
//    kind) and materialised with a single slice; quoted fields find their
//    closing quote with indexOf and slice when there is no doubling or CR.
//    The only per-character work is the rare path (doubled quotes or CRs
//    inside a quoted field).
// The positions of the next LF and CR are cached lazily: they only move
// forward as the scan does, so they are re-found only when the scan passes
// them (a cached position computed from p stays the first such character at
// or after any later p, and after the one backward move the parser makes —
// an unterminated quote re-read — the same argument holds, or the cache is
// behind the new position and is recomputed).

const COMMA = 44; // ,
const QUOTE = 34; // "
const LF = 10; // \n
const CR = 13; // \r
const FEFF = 0xfeff;

// How a field ended: 0 comma, 1 line break, 2 end of text.
const END_COMMA = 0;
const END_BREAK = 1;
const END_TEXT = 2;

// Not yet computed (as opposed to -1: computed, none left).
const UNKNOWN = -2;

export function run(input) {
  const text = typeof input.text === 'string' ? input.text : String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === FEFF ? 1 : 0;
  let line = 1;

  // Record context every error of the current record carries.
  let recordLine = 1;
  let recordRow = null;

  // Cached first LF / CR at or after the scan position (UNKNOWN: not computed;
  // -1: computed, none left — sticky, since the scan never moves backward past
  // a position it already passed, except the unterminated-quote re-read, where
  // the cached position is still the first such character at or after the new
  // position, or behind it and recomputed).
  let nextLF = UNKNOWN;
  let nextCR = UNKNOWN;

  // Field-reader out-params.
  let fValue = '';
  let fEnded = END_TEXT;
  let fAdded = 0;

  // Read an unquoted field starting at pos, appending to `start` ('' normally,
  // the quoted value for junk after a closing quote, '"' for a re-read after an
  // unterminated quote). Sets fValue, fEnded, fAdded (chars kept).
  function readUnquoted(start) {
    let value = start;
    let added = 0;
    let p = pos;
    for (;;) {
      if (nextLF === UNKNOWN || (nextLF !== -1 && nextLF < p)) nextLF = text.indexOf('\n', p);
      if (nextCR === UNKNOWN || (nextCR !== -1 && nextCR < p)) nextCR = text.indexOf('\r', p);
      const ci = text.indexOf(',', p);
      let end = -1;
      let kind = -1;
      if (ci !== -1) {
        end = ci;
        kind = 0;
      }
      if (nextLF !== -1 && (end === -1 || nextLF < end)) {
        end = nextLF;
        kind = 1;
      }
      if (nextCR !== -1 && (end === -1 || nextCR < end)) {
        end = nextCR;
        kind = 2;
      }
      if (end === -1) {
        if (p < n) {
          value += text.slice(p);
          added += n - p;
        }
        pos = n;
        fEnded = END_TEXT;
        break;
      }
      if (kind === 2) {
        if (end + 1 < n && text.charCodeAt(end + 1) === LF) {
          if (end > p) {
            value += text.slice(p, end);
            added += end - p;
          }
          pos = end + 2;
          line++;
          fEnded = END_BREAK;
          break;
        }
        // Stray CR: dropped, recorded, the field goes on.
        if (end > p) {
          value += text.slice(p, end);
          added += end - p;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        p = end + 1;
        continue;
      }
      if (end > p) {
        value += text.slice(p, end);
        added += end - p;
      }
      if (kind === 0) {
        pos = end + 1;
        fEnded = END_COMMA;
      } else {
        pos = end + 1;
        line++;
        fEnded = END_BREAK;
      }
      break;
    }
    fValue = value;
    fAdded = added;
  }

  // Read a quoted field whose opening quote is at pos. Sets fValue, fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos++;
    // The closing quote is the first quote not doubled ("").
    let q = text.indexOf('"', pos);
    let doubled = false;
    while (q !== -1 && q + 1 < n && text.charCodeAt(q + 1) === QUOTE) {
      doubled = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted. The line count inside the failed scan
      // is undone, exactly as the reference does.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    const segStart = pos;
    const segEnd = q;
    // Does the segment hold a CR (then it needs CR -> LF normalisation)?
    if (nextCR === UNKNOWN || (nextCR !== -1 && nextCR < segStart)) nextCR = text.indexOf('\r', segStart);
    const hasCR = nextCR !== -1 && nextCR < segEnd;
    let value;
    if (!doubled && !hasCR) {
      // Plain quoted content: one slice, and count its LFs for the line.
      value = text.slice(segStart, segEnd);
      if (nextLF === UNKNOWN || (nextLF !== -1 && nextLF < segStart)) nextLF = text.indexOf('\n', segStart);
      let nl = nextLF;
      while (nl !== -1 && nl < segEnd) {
        line++;
        nl = text.indexOf('\n', nl + 1);
      }
    } else {
      // Rare path: doubled quotes and/or CRs inside the quotes. Build it
      // in one pass over the segment, normalising CR/CRLF to LF.
      let built = '';
      let p = segStart;
      let runStart = p;
      while (p < segEnd) {
        const ch = text.charCodeAt(p);
        if (ch === QUOTE) {
          if (p > runStart) built += text.slice(runStart, p);
          built += '"';
          p += 2;
          runStart = p;
          continue;
        }
        if (ch === CR) {
          if (p > runStart) built += text.slice(runStart, p);
          built += '\n';
          line++;
          p += p + 1 < n && text.charCodeAt(p + 1) === LF ? 2 : 1;
          runStart = p;
          continue;
        }
        if (ch === LF) line++;
        p++;
      }
      if (segEnd > runStart) built += text.slice(runStart, segEnd);
      value = built;
    }
    pos = q + 1;
    if (pos >= n) {
      fValue = value;
      fEnded = END_TEXT;
      fAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      pos++;
      fValue = value;
      fEnded = END_COMMA;
      fAdded = 0;
      return;
    }
    if (c === LF) {
      pos++;
      line++;
      fValue = value;
      fEnded = END_BREAK;
      fAdded = 0;
      return;
    }
    if (c === CR && pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line++;
      fValue = value;
      fEnded = END_BREAK;
      fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands.
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos++;
        line++;
      } else if (c === CR && pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Parse the record field by field.
    let fields = [];
    let quoted = false;
    do {
      quoted = pos < n && text.charCodeAt(pos) === QUOTE;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === END_COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
