import {
  expandSearchTerm,
  type ParsedProductSearch,
  type SearchTokenGroup,
} from "@/lib/products/search";

/**
 * Typo tolerance — the pure half.
 *
 * The storefront search matches every word as a prefix of an indexed term,
 * so a word that is merely unfinished ("ipho") already works. What it cannot
 * do is forgive a wrong letter: "ipone", "samsng", "labtop" match nothing.
 *
 * The rule, the one the big hosted engines ship by default:
 *
 * - Only a word that matches NOTHING in the catalogue is corrected. A real
 *   word is never "fixed" into a different one — "case" stays "case" even
 *   though "cash" is one letter away.
 * - Short words are left alone: 0 typos below 4 letters, 1 from 4, 2 from 8.
 *   A three-letter word has too many one-letter neighbours to guess from.
 * - Only Latin-script words. A code ("sku-1042", "s24") is never corrected —
 *   the nearest SKU to a mistyped one is somebody else's product — and other
 *   scripts need rules of their own.
 * - A correction may be the START of a longer word, because the shopper may
 *   not have finished typing: "iphn" is one edit from "ipho", the start of
 *   "iphone".
 * - An adjacent swap counts as one edit ("iphnoe" → "iphone").
 *
 * The correction does not add a new kind of clause. It adds alternatives to
 * the parsed query — "ipone" becomes "ipone OR iphone" — so the corrected
 * words go through the same indexed prefix match as any other search.
 */

/** The catalogue's words, for typo correction. Built once, read many times. */
export type SearchVocabulary = {
  /** Sorted, unique, lower-case Latin words. */
  terms: readonly string[];
  /** Parallel to `terms`: how many live products carry the word. */
  counts: readonly number[];
};

/** A word below this length is never corrected, and never a correction. */
const MIN_TERM_LENGTH = 3;
/** Longer "words" are joined codes or glued runs, not something to correct to. */
const MAX_TERM_LENGTH = 32;
/** Candidates kept per corrected word. */
const MAX_CORRECTIONS = 3;
/** Alternatives one group may grow to once corrections are added. */
const MAX_ALTERNATIVES_PER_GROUP = 8;

const LATIN_WORD = /^\p{Script=Latin}+$/u;

/** How many typos a word may carry and still be corrected. */
export function typoBudget(word: string): number {
  if (!LATIN_WORD.test(word)) return 0;
  if (word.length >= 8) return 2;
  if (word.length >= 4) return 1;
  return 0;
}

/**
 * A vocabulary from `{ term, count }` rows — the catalogue's indexed search
 * terms. Anything that is not a plain Latin word of a sensible length is
 * dropped: codes, numbers and other scripts are never corrected to.
 */
export function buildSearchVocabulary(
  rows: Iterable<{ term: string; count: number }>,
): SearchVocabulary {
  const merged = new Map<string, number>();
  for (const { term, count } of rows) {
    if (
      typeof term !== "string" ||
      term.length < MIN_TERM_LENGTH ||
      term.length > MAX_TERM_LENGTH ||
      !LATIN_WORD.test(term)
    ) {
      continue;
    }
    merged.set(term, (merged.get(term) ?? 0) + (Number(count) || 0));
  }
  const terms = [...merged.keys()].sort();
  return { terms, counts: terms.map((term) => merged.get(term) ?? 0) };
}

/** Index of the first term >= `word`. */
function lowerBound(terms: readonly string[], word: string): number {
  let lo = 0;
  let hi = terms.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (terms[mid]! < word) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** True when some vocabulary term begins with `word`. */
export function vocabularyHasPrefix(
  vocabulary: SearchVocabulary,
  word: string,
): boolean {
  const index = lowerBound(vocabulary.terms, word);
  return index < vocabulary.terms.length && vocabulary.terms[index]!.startsWith(word);
}

// Scratch rows for the distance, reused across calls: the correction scans
// the whole vocabulary, and allocating three arrays per term would dominate.
const ROW_SIZE = MAX_TERM_LENGTH + 2;
const rowA = new Int32Array(ROW_SIZE);
const rowB = new Int32Array(ROW_SIZE);
const rowC = new Int32Array(ROW_SIZE);

/**
 * Edits from `query` to the closest START of `term` — the whole term
 * included — counting insertions, deletions, substitutions and adjacent
 * swaps as one each (optimal string alignment). Null once the answer
 * provably exceeds `max`; `whole` says the best alignment used the entire
 * term, which ranks above a match on its start.
 *
 * Banded: only cells within `max` of the diagonal can hold an answer within
 * `max`, so the work per term is `query.length × (2·max + 1)`.
 */
export function prefixTypoDistance(
  query: string,
  term: string,
  max: number,
): { distance: number; whole: boolean } | null {
  const m = query.length;
  const n = term.length;
  if (m === 0 || n > MAX_TERM_LENGTH || n < m - max) return null;
  const OUT = max + 1;

  let prev2 = rowA; // row i-2
  let prev = rowB; // row i-1
  let cur = rowC; // row i
  for (let j = 0; j <= n; j += 1) prev[j] = j <= max ? j : OUT;

  for (let i = 1; i <= m; i += 1) {
    const lo = Math.max(1, i - max);
    const hi = Math.min(n, i + max);
    cur[0] = i <= max ? i : OUT;
    if (lo > 1) cur[lo - 1] = OUT;
    let rowMin = cur[0]!;
    const qi = query.charCodeAt(i - 1);
    for (let j = lo; j <= hi; j += 1) {
      const tj = term.charCodeAt(j - 1);
      let best = prev[j - 1]! + (qi === tj ? 0 : 1);
      const del = prev[j]! + 1;
      if (del < best) best = del;
      const ins = cur[j - 1]! + 1;
      if (ins < best) best = ins;
      if (
        i > 1 &&
        j > 1 &&
        qi === term.charCodeAt(j - 2) &&
        query.charCodeAt(i - 2) === tj
      ) {
        const swap = prev2[j - 2]! + 1;
        if (swap < best) best = swap;
      }
      cur[j] = best > OUT ? OUT : best;
      if (cur[j]! < rowMin) rowMin = cur[j]!;
    }
    if (hi < n) cur[hi + 1] = OUT;
    // A row's minimum never decreases further down, so once every cell is
    // past the budget no alignment can come back under it.
    if (rowMin > max) return null;
    const recycled = prev2;
    prev2 = prev;
    prev = cur;
    cur = recycled;
  }

  // `prev` holds the last row: query fully consumed against each prefix.
  const lo = Math.max(0, m - max);
  const hi = Math.min(n, m + max);
  let distance = OUT;
  for (let j = lo; j <= hi; j += 1) {
    if (prev[j]! < distance) distance = prev[j]!;
  }
  if (distance > max) return null;
  return { distance, whole: hi === n && prev[n]! === distance };
}

type Candidate = { term: string; distance: number; whole: boolean; count: number };

/**
 * The vocabulary terms `word` most plausibly meant, best first: fewest
 * edits, then whole-word over word-start, then the more common word. Only
 * the closest distance found is kept — a one-letter fix makes every
 * two-letter fix noise — and a candidate that merely extends one already
 * chosen is dropped, since the prefix match reaches it anyway.
 */
export function suggestCorrections(
  vocabulary: SearchVocabulary,
  word: string,
  limit = MAX_CORRECTIONS,
): string[] {
  const max = typoBudget(word);
  if (max === 0) return [];

  const candidates: Candidate[] = [];
  let closest = max;
  const { terms, counts } = vocabulary;
  for (let index = 0; index < terms.length; index += 1) {
    const term = terms[index]!;
    const match = prefixTypoDistance(word, term, closest);
    if (!match || match.distance === 0) continue;
    if (match.distance < closest) {
      closest = match.distance;
      candidates.length = 0;
    }
    candidates.push({ term, ...match, count: counts[index] ?? 0 });
  }

  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      Number(b.whole) - Number(a.whole) ||
      b.count - a.count ||
      a.term.length - b.term.length ||
      (a.term < b.term ? -1 : a.term > b.term ? 1 : 0),
  );

  const chosen: string[] = [];
  for (const candidate of candidates) {
    if (chosen.some((term) => candidate.term.startsWith(term))) continue;
    chosen.push(candidate.term);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

export type SearchCorrection = {
  /** The query as the shopper typed it (canonical form). */
  from: string;
  /** The same query with each corrected word replaced by its best fix. */
  to: string;
  /** Word → the vocabulary terms it was corrected to, best first. */
  words: Record<string, string[]>;
};

/** A word is known when it, its singular or a synonym starts some term. */
function isKnownWord(word: string, vocabulary: SearchVocabulary): boolean {
  return expandSearchTerm(word).some((form) =>
    vocabularyHasPrefix(vocabulary, form),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A chunk as the shopper typed it with each corrected word swapped for its
 * best fix — at word boundaries only, so a fix for "ipone" never rewrites
 * the inside of some longer word.
 */
function correctChunk(chunk: string, words: Record<string, string[]>): string {
  let out = chunk;
  for (const [word, fixes] of Object.entries(words)) {
    const fix = fixes[0];
    if (!fix) continue;
    out = out.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}(?=$|[^\\p{L}\\p{N}])`, "gu"),
      (_, lead: string) => `${lead}${fix}`,
    );
  }
  return out;
}

function withCorrections(
  group: SearchTokenGroup,
  words: Record<string, string[]>,
): SearchTokenGroup {
  const alternatives = [...group.alternatives];
  for (const alternative of group.alternatives) {
    // Each corrected part is swapped for each of its fixes in turn — one
    // alternative per fix, the others left as typed.
    alternative.forEach((part, index) => {
      for (const fix of words[part] ?? []) {
        if (alternatives.length >= MAX_ALTERNATIVES_PER_GROUP) return;
        const next = [...alternative];
        next[index] = fix;
        alternatives.push(next);
      }
    });
  }
  return {
    ...group,
    alternatives,
    tokens: group.tokens.map((token) => words[token]?.[0] ?? token),
  };
}

/**
 * The query with its misspelt words corrected, or null when nothing in it
 * needed — or admitted — a correction.
 *
 * The vocabulary is expected to hold the words of the store's category and
 * brand names as well as the products' own terms: a word naming a brand is
 * not a typo, and "samsng" should reach the Samsung brand even though brand
 * names are resolved at query time rather than stored on products.
 */
export function correctProductSearch(
  parsed: ParsedProductSearch,
  vocabulary: SearchVocabulary,
): { parsed: ParsedProductSearch; correction: SearchCorrection } | null {
  if (vocabulary.terms.length === 0) return null;

  const words: Record<string, string[]> = {};
  const parts = new Set(
    parsed.groups.flatMap((group) => group.alternatives.flat()),
  );
  for (const part of parts) {
    if (typoBudget(part) === 0) continue;
    if (isKnownWord(part, vocabulary)) continue;
    const fixes = suggestCorrections(vocabulary, part);
    if (fixes.length > 0) words[part] = fixes;
  }
  if (Object.keys(words).length === 0) return null;

  const groups = parsed.groups.map((group) => withCorrections(group, words));
  const tokens = [...new Set(groups.flatMap((group) => group.tokens))];
  const chunks = parsed.groups.map((group) => group.chunk);

  return {
    parsed: { phrase: tokens.join(" "), tokens, groups },
    correction: {
      from: chunks.join(" "),
      to: chunks.map((chunk) => correctChunk(chunk, words)).join(" "),
      words,
    },
  };
}
