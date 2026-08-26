/**
 * Check every `explicit(...)` citation in the game fixtures against the manual.
 *
 * Provenance is only worth carrying if the citations are true. This reads each
 * `sourceQuote` out of the fixture source, normalises it, and looks for it on
 * the page it claims — reporting MISMATCH when the text is on a different page
 * and MISSING when it is nowhere in the document.
 *
 * It found three real errors the first time it ran: the robot sizing constants
 * cited R104 ("Keep it together"), which says nothing about size; the expansion
 * limits cited p.103 for text on p.123; and a `sourceQuote` held a sentence
 * written here rather than one from the manual.
 *
 * ── Why this is a tool and not a test ──────────────────────────────────────
 *
 * It needs the manual, which is a 188-page PDF, and text extraction from it
 * needs poppler. Tests must run headless and fast with no external binary, so
 * the invariant a *test* guards is the citation contract (every explicit value
 * carries a page or rule and a quote); the correspondence to the document is
 * checked here, by a human running it after transcribing.
 *
 * Usage:
 *   pdftotext -layout "Game Manuals/DECODE_Competition_Manual_TU32.pdf" decode.txt
 *   node tools/verify-citations.mjs decode.txt
 *
 * Exits non-zero if any citation fails, so it can gate a transcription commit.
 */

import { readFileSync } from 'node:fs';

const FIXTURES = [
  'src/core/game/fixtures/decode.ts',
  'src/core/game/fixtures/decodeDimensions.ts',
];

/** Total pages, used to recognise the running footer. */
const PAGE_COUNT = 188;

/** Shortest quote worth checking; below this a match means nothing. */
const MIN_QUOTE_LENGTH = 12;

/**
 * Fold everything a PDF extractor mangles.
 *
 * Layout extraction turns column gaps into runs of spaces, en-dashes into
 * replacement characters, and quotes into their typographic forms. Comparing
 * on letters and digits alone makes the check about the words rather than
 * about the extractor.
 */
function normalise(text) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, ' ')
    .trim();
}

/** Split the document into pages using the "N of 188" running footer. */
function readPages(path) {
  const footer = new RegExp(String.raw`\b(\d{1,3}) of ${PAGE_COUNT}\b`);
  const pages = new Map();
  let buffer = [];

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    buffer.push(line);
    const match = footer.exec(line);
    if (match) {
      const page = Number(match[1]);
      pages.set(page, (pages.get(page) ?? '') + '\n' + buffer.join('\n'));
      buffer = [];
    }
  }

  return new Map([...pages].map(([page, text]) => [page, normalise(text)]));
}

/**
 * `explicit(value, page, 'quote')`, with the quote optionally in double quotes.
 *
 * Deliberately a regex over source text rather than an import of the module:
 * importing would report what the values *are*, and the question here is what
 * the source file *claims*, including the citation a reviewer would read.
 */
const CITATION =
  /explicit\(\s*(?:[^,()]+|'[^']*')\s*,\s*(\d+)\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"([^"]*)")/gs;

/**
 * Does the quote appear in the text, allowing "..." to elide?
 *
 * An elided quote is honest — it skips a parenthetical the manual repeats in
 * centimetres — so each fragment must appear, in order, rather than the whole
 * string appearing contiguously.
 */
function appearsIn(text, quote) {
  let at = 0;
  for (const fragment of quote.split('...').map(normalise).filter((f) => f.length >= 4)) {
    at = text.indexOf(fragment, at);
    if (at < 0) return false;
    at += fragment.length;
  }
  return true;
}

const textPath = process.argv[2];
if (textPath === undefined) {
  console.error('Usage: node tools/verify-citations.mjs <extracted-manual.txt>');
  process.exit(2);
}

const pages = readPages(textPath);
const whole = [...pages.values()].join(' ');

let ok = 0;
const failures = [];

for (const fixture of FIXTURES) {
  const source = readFileSync(fixture, 'utf8');

  for (const match of source.matchAll(CITATION)) {
    const page = Number(match[1]);
    const quote = (match[2] ?? match[3]).replace(/\\'/g, "'");
    if (normalise(quote).length < MIN_QUOTE_LENGTH) continue;

    if (appearsIn(pages.get(page) ?? '', quote)) {
      ok += 1;
      continue;
    }

    const elsewhere = [...pages]
      .filter(([, text]) => appearsIn(text, quote))
      .map(([n]) => n);

    if (elsewhere.length > 0) {
      failures.push(`MISMATCH ${fixture}\n  cited p.${page}, found on p.${elsewhere.join(', ')}\n  "${quote}"`);
    } else if (appearsIn(whole, quote)) {
      ok += 1; // Spans a page break.
    } else {
      failures.push(`MISSING  ${fixture}  p.${page}\n  "${quote}"`);
    }
  }
}

for (const failure of failures) console.error(failure);
console.error(`\nchecked ${ok + failures.length}   ok ${ok}   failed ${failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
