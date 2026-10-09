import { Types } from "mongoose";
import { escapeRegExp } from "@/lib/strings";
import type { ProductSearchIndex } from "@/types";

/**
 * Product search — the pure half.
 *
 * Every product carries a `search` block the model derives on write (see
 * `buildProductSearchIndex`):
 *
 * - `terms`    — the words a shopper could reasonably type to find the
 *                product: its name, SKUs and barcodes, tags, type, option
 *                values, attributes and variant names. Each word is stored
 *                alongside its singular ("pants" → "pant"), its joined form
 *                for separators ("t-shirt" → "tshirt") and its letter/digit
 *                runs ("iphone15" → "iphone", "15"). A multikey index on this
 *                array turns an anchored prefix regex into an index range
 *                scan, which is what keeps a search fast at tens of thousands
 *                of products.
 * - `name`     — the normalized name, for ranking in the aggregation.
 * - `text`     — `terms` plus the words of the descriptions, one string, so a
 *                search that matches NOTHING by its primary fields can still
 *                fall back to "the word appears somewhere". Unindexed on
 *                purpose: it is only consulted when the precise pass is empty.
 *
 * Category and brand names are deliberately NOT copied into `terms`. They are
 * resolved at query time (`matchSearchEntities`) so renaming a category never
 * leaves stale words on a thousand products.
 *
 * A query is split into groups — one per whitespace-separated chunk — and
 * every group must match (AND); inside a group, the chunk's alternatives are
 * ORed: "sku-1042" is satisfied by the parts "sku" AND "1042", or by the
 * joined "sku1042". Every word is a prefix, so a search-as-you-type "ipho"
 * already finds iPhones, and a description that merely mentions "iPhone"
 * never does — that mention is what made "track pants" return the whole
 * catalogue of a store whose every description said "track your order".
 */

/** Bump when the index builder's output changes; the backfill rebuilds stale rows. */
export const PRODUCT_SEARCH_INDEX_VERSION = 1;

/**
 * Every field `buildProductSearchIndex` reads. Whole top-level paths, never
 * `variants.name` style sub-paths: mixing `variants` with `variants.name` in
 * one projection is a MongoDB path collision.
 */
export const PRODUCT_SEARCH_SOURCE_SELECT =
  "name title slug handle sku barcode productType tags attributes options variants shortDescription description seo";

const MAX_QUERY_LENGTH = 100;
const MAX_QUERY_GROUPS = 8;
const MAX_QUERY_TOKENS = 12;
const MAX_INDEX_TERMS = 500;
const MAX_INDEX_TEXT_LENGTH = 6000;
/** CJK words get every suffix indexed (no word boundaries to prefix from). */
const MAX_SUFFIXED_WORD_LENGTH = 24;

/**
 * Latin combining marks only: "café" → "cafe". Deliberately not every mark —
 * Bengali, Hindi and Arabic vowel signs are combining marks too, and
 * stripping those would fold distinct words together.
 */
const LATIN_COMBINING_MARKS = /[\u0300-\u036f]/g;
/**
 * Letters, digits and combining marks are word characters. The marks matter:
 * a Bengali or Hindi vowel sign is a combining mark, and treating it as
 * punctuation would cut "জামা" into "জ ম". (Latin accents were already
 * stripped above, so they never reach this.)
 */
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/gu;
const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER_DIGIT_BOUNDARY = /(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u;
const HTML_TAG = /<[^>]*>/g;
const HTML_ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi;

/**
 * Dropped from queries and from the index. Small on purpose: "case for
 * iphone" must not demand a product whose fields contain "for", but a word
 * like "pro" or "max" is a real product token.
 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "for",
  "with",
  "of",
  "in",
  "on",
  "to",
  "by",
  "or",
  "from",
  "at",
  "is",
  "are",
  "it",
  "its",
]);

/**
 * Bidirectional synonym groups, in singular form (queries are singularized
 * before lookup). Kept small and high-signal — a broad group dilutes every
 * search that touches it.
 */
const SYNONYM_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["shoe", "sneaker", "trainer", "footwear"],
  ["phone", "mobile", "smartphone", "cellphone"],
  ["laptop", "notebook", "ultrabook"],
  ["tv", "television"],
  ["headphone", "earphone", "earbud", "headset"],
  ["tshirt", "tee"],
  ["hoodie", "sweatshirt"],
  ["jacket", "coat"],
  ["bag", "backpack", "rucksack"],
  ["watch", "smartwatch"],
  ["sofa", "couch"],
  ["fridge", "refrigerator"],
  ["bike", "bicycle", "cycle"],
  ["pant", "trouser"],
];

const SYNONYMS: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      map.set(
        term,
        group.filter((sibling) => sibling !== term),
      );
    }
  }
  return map;
})();

type UnknownRecord = Record<string, unknown>;

function unique<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

/** Case, accents and whitespace folded; punctuation kept. */
function foldText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(LATIN_COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The form a query is stored and cached under: "iPhone 15" and "iphone 15"
 * are one cache entry. Punctuation survives — "t-shirt" still has its joined
 * form to offer — so this is not `normalizeSearchText`.
 */
export function canonicalizeProductSearch(input: unknown): string {
  return foldText(input).slice(0, MAX_QUERY_LENGTH).trim();
}

/** Lower-cased words separated by single spaces; everything else removed. */
export function normalizeSearchText(value: unknown): string {
  return foldText(value).replace(NON_WORD, " ").trim();
}

function chunkParts(chunk: string): string[] {
  return normalizeSearchText(chunk).split(" ").filter(Boolean);
}

/** One Latin letter is noise; one CJK character is a word. */
function isUsefulToken(token: string): boolean {
  return token.length >= 2 || CJK.test(token);
}

/**
 * A conservative English singular. Both sides of a search go through it —
 * the index stores the singular next to the word, the query matches on
 * either — so an imperfect stem ("series" → "sery") costs nothing: the
 * original word is always there too.
 */
export function singularizeSearchWord(word: string): string {
  if (word.length < 4 || !/^[a-z]+$/.test(word)) return word;
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) {
    return word;
  }
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function splitLetterDigitRuns(word: string): string[] {
  return word.split(LETTER_DIGIT_BOUNDARY);
}

/** The word and its singular — the forms a shopper's word takes in the index. */
function expandSearchWord(word: string): string[] {
  return unique([word, singularizeSearchWord(word)]);
}

/** `expandSearchWord` plus the synonyms of the singular form. */
export function expandSearchTerm(word: string): string[] {
  const singular = singularizeSearchWord(word);
  return unique([
    word,
    singular,
    ...(SYNONYMS.get(singular) ?? SYNONYMS.get(word) ?? []),
  ]);
}

function pushWordForms(out: string[], word: string) {
  if (STOP_WORDS.has(word) || !isUsefulToken(word)) return;
  out.push(word);

  const singular = singularizeSearchWord(word);
  if (singular !== word) out.push(singular);

  const runs = splitLetterDigitRuns(word);
  if (runs.length > 1) {
    for (const run of runs) if (isUsefulToken(run)) out.push(run);
  }

  if (CJK.test(word) && word.length <= MAX_SUFFIXED_WORD_LENGTH) {
    for (let index = 1; index < word.length; index += 1) {
      out.push(word.slice(index));
    }
  }
}

/**
 * Every indexable form of the words in `value`: each word, its singular, its
 * letter/digit runs, the suffixes of a CJK word, and the joined form of a
 * chunk that separators split ("t-shirt" → "tshirt", "men's" → "mens").
 */
export function collectIndexWords(value: unknown): string[] {
  const words: string[] = [];
  for (const chunk of foldText(value).split(" ")) {
    const parts = chunkParts(chunk);
    if (parts.length === 0) continue;
    for (const part of parts) pushWordForms(words, part);
    if (parts.length > 1) pushWordForms(words, parts.join(""));
  }
  return unique(words);
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stripHtml(value: unknown): string {
  return String(value ?? "")
    .replace(HTML_TAG, " ")
    .replace(HTML_ENTITY, " ");
}

/** A value that is a string or a number, the only things worth indexing. */
function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** The option-value shape has been a string and an object over the years. */
function optionValueText(value: unknown): string | null {
  return scalarText(value) ?? scalarText(asRecord(value)?.value);
}

/**
 * Loosely typed on purpose: fed by Mongoose documents, `.lean()` rows, raw
 * snapshot JSON and CSV import payloads alike.
 */
export type ProductSearchSource = {
  name?: unknown;
  title?: unknown;
  slug?: unknown;
  handle?: unknown;
  sku?: unknown;
  barcode?: unknown;
  productType?: unknown;
  tags?: unknown;
  attributes?: unknown;
  options?: unknown;
  variants?: unknown;
  shortDescription?: unknown;
  description?: unknown;
  seo?: unknown;
};

/**
 * The `search` block for a product. Sources are added in order of how much
 * they say about the product, so the term cap trims variant codes before it
 * ever trims the name.
 */
export function buildProductSearchIndex(
  source: ProductSearchSource,
): ProductSearchIndex {
  const name = scalarText(source.name) || scalarText(source.title) || "";
  const terms: string[] = [];
  const seen = new Set<string>();

  const addTerms = (value: unknown) => {
    const text = scalarText(value);
    if (text === null || terms.length >= MAX_INDEX_TERMS) return;
    for (const word of collectIndexWords(text)) {
      if (seen.has(word)) continue;
      seen.add(word);
      terms.push(word);
      if (terms.length >= MAX_INDEX_TERMS) return;
    }
  };

  addTerms(name);
  addTerms(source.title);
  addTerms(source.sku);
  addTerms(source.barcode);
  for (const tag of asArray(source.tags)) addTerms(tag);
  addTerms(source.productType);
  const seo = asRecord(source.seo);
  addTerms(seo?.pageTitle);
  addTerms(source.slug);
  addTerms(source.handle);
  for (const option of asArray(source.options)) {
    const record = asRecord(option);
    if (!record) continue;
    addTerms(record.name);
    for (const value of asArray(record.values)) addTerms(optionValueText(value));
  }
  for (const attribute of asArray(source.attributes)) {
    const record = asRecord(attribute);
    if (!record) continue;
    addTerms(record.name);
    addTerms(record.value);
  }
  for (const variant of asArray(source.variants)) {
    const record = asRecord(variant);
    if (!record) continue;
    addTerms(record.name);
    addTerms(record.sku);
    addTerms(record.barcode);
    for (const value of asArray(record.optionValues)) {
      addTerms(optionValueText(value));
    }
    for (const attribute of asArray(record.attributes)) {
      const attributeRecord = asRecord(attribute);
      if (!attributeRecord) continue;
      addTerms(attributeRecord.name);
      addTerms(attributeRecord.value);
    }
  }

  const textWords = [...terms];
  const textSeen = new Set(terms);
  const addText = (value: unknown) => {
    const text = scalarText(value);
    if (text === null) return;
    for (const word of collectIndexWords(text)) {
      if (textSeen.has(word)) continue;
      textSeen.add(word);
      textWords.push(word);
    }
  };
  addText(stripHtml(source.shortDescription));
  addText(stripHtml(source.description));
  addText(seo?.metaDescription);

  let text = textWords.join(" ");
  if (text.length > MAX_INDEX_TEXT_LENGTH) {
    text = text.slice(0, MAX_INDEX_TEXT_LENGTH);
    const cut = text.lastIndexOf(" ");
    if (cut > 0) text = text.slice(0, cut);
  }

  const searchName = normalizeSearchText(name)
    .split(" ")
    .filter((word) => word && !STOP_WORDS.has(word))
    .join(" ");

  return { v: PRODUCT_SEARCH_INDEX_VERSION, name: searchName, terms, text };
}

/**
 * One whitespace-separated chunk of a query. The group matches when ANY
 * alternative has EVERY one of its parts matched by prefix.
 */
export type SearchTokenGroup = {
  /** The canonical chunk the group came from, so a caller can re-issue the query without it. */
  chunk: string;
  alternatives: string[][];
  /** The natural split of the chunk, used for ranking. */
  tokens: string[];
};

export type ParsedProductSearch = {
  /** `tokens` joined by a space — the phrase the ranking looks for in a name. */
  phrase: string;
  tokens: string[];
  groups: SearchTokenGroup[];
};

function buildTokenGroups(chunks: string[], strict: boolean): SearchTokenGroup[] {
  const groups: SearchTokenGroup[] = [];

  for (const chunk of chunks) {
    const rawParts = chunkParts(chunk);
    if (rawParts.length === 0) continue;

    const parts = strict
      ? rawParts.filter((part) => !STOP_WORDS.has(part) && isUsefulToken(part))
      : rawParts;
    const alternatives: string[][] = [];
    if (parts.length > 0) alternatives.push(parts);

    // "t-shirt" as "tshirt", "sku-1042" as "sku1042".
    const joined = rawParts.length > 1 ? rawParts.join("") : null;
    if (joined && (!strict || isUsefulToken(joined))) alternatives.push([joined]);

    // "iphone15" as "iphone" + "15". Only when every run stands on its own:
    // "s24" must not become a search for "24".
    if (parts.length > 0) {
      const runs = parts.flatMap(splitLetterDigitRuns);
      if (
        runs.length > parts.length &&
        runs.every((run) => !strict || isUsefulToken(run))
      ) {
        alternatives.push(runs);
      }
    }

    if (alternatives.length === 0) continue;
    groups.push({
      chunk,
      alternatives,
      tokens: parts.length > 0 ? parts : [joined as string],
    });
  }

  return groups;
}

/**
 * A query as match groups, or null when there is nothing to search for.
 *
 * Stop words and single Latin characters are dropped — unless that would
 * drop everything, in which case the query is taken literally: a shopper who
 * types "the" gets products with "the" rather than the whole catalogue.
 */
export function parseProductSearch(input: unknown): ParsedProductSearch | null {
  const canonical = canonicalizeProductSearch(input);
  if (!canonical) return null;

  const chunks = canonical.split(" ").filter(Boolean);
  let groups = buildTokenGroups(chunks, true);
  if (groups.length === 0) groups = buildTokenGroups(chunks, false);
  if (groups.length === 0) return null;

  groups = groups.slice(0, MAX_QUERY_GROUPS);
  const tokens = unique(groups.flatMap((group) => group.tokens)).slice(
    0,
    MAX_QUERY_TOKENS,
  );

  return { phrase: tokens.join(" "), tokens, groups };
}

/** The ranking tokens of a query — for callers that score text in memory. */
export function productSearchTokens(input: unknown): string[] {
  return parseProductSearch(input)?.tokens ?? [];
}

function toObjectIds(ids: string[]): Types.ObjectId[] {
  return ids.map((id) => new Types.ObjectId(id));
}

function prefixPatterns(word: string): RegExp[] {
  // No `i` flag: the terms are stored lower-case and the query is folded the
  // same way, and a case-insensitive regex cannot use index bounds.
  return expandSearchTerm(word).map((term) => new RegExp(`^${escapeRegExp(term)}`));
}

function termsClause(word: string): UnknownRecord {
  return { "search.terms": { $in: prefixPatterns(word) } };
}

function textClause(word: string): UnknownRecord {
  const alternatives = expandSearchTerm(word).map(escapeRegExp).join("|");
  return { "search.text": { $regex: `(^| )(${alternatives})` } };
}

function allOf(clauses: UnknownRecord[]): UnknownRecord {
  return clauses.length === 1 ? clauses[0]! : { $and: clauses };
}

function anyOf(clauses: UnknownRecord[]): UnknownRecord {
  return clauses.length === 1 ? clauses[0]! : { $or: clauses };
}

export type SearchEntityRecord = {
  id: string;
  /** `collectIndexWords` of the entity's name. */
  words: string[];
  parentId?: string | null;
};

export type ProductSearchEntityIndex = {
  categories: SearchEntityRecord[];
  brands: SearchEntityRecord[];
};

/** The categories (with descendants) and brands one query group names. */
export type SearchEntityMatch = {
  categoryIds: string[];
  brandIds: string[];
};

function entityMatchesGroup(
  entity: SearchEntityRecord,
  group: SearchTokenGroup,
): boolean {
  return group.alternatives.some((alternative) =>
    alternative.every((part) => {
      const forms = expandSearchTerm(part);
      return entity.words.some((word) =>
        forms.some((form) => word.startsWith(form)),
      );
    }),
  );
}

/**
 * Which categories and brands each query group could be naming. "apple
 * watch" resolves "apple" to the Apple brand and "watch" to the Watches
 * category (and everything under it), so a product filed there matches even
 * when its own name says neither.
 */
export function matchSearchEntities(
  parsed: ParsedProductSearch,
  index: ProductSearchEntityIndex,
): SearchEntityMatch[] {
  const childrenOf = new Map<string, string[]>();
  for (const category of index.categories) {
    if (!category.parentId) continue;
    const siblings = childrenOf.get(category.parentId) || [];
    siblings.push(category.id);
    childrenOf.set(category.parentId, siblings);
  }

  const withDescendants = (ids: string[]) => {
    const collected = new Set<string>();
    const queue = [...ids];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (collected.has(id)) continue;
      collected.add(id);
      queue.push(...(childrenOf.get(id) || []));
    }
    return [...collected];
  };

  return parsed.groups.map((group) => ({
    categoryIds: withDescendants(
      index.categories
        .filter((category) => entityMatchesGroup(category, group))
        .map((category) => category.id),
    ),
    brandIds: index.brands
      .filter((brand) => entityMatchesGroup(brand, group))
      .map((brand) => brand.id),
  }));
}

/**
 * `terms` is the precise pass — prefix matches on the indexed terms. `text`
 * is the fallback — the same words anywhere, descriptions included — and is
 * a collection scan, so callers only reach for it when `terms` found nothing.
 */
type ProductSearchStage = "terms" | "text";

/**
 * The `$and` clauses of a search: one per group, each ORing the group's
 * alternatives with the categories and brands it names. Callers append these
 * to their own `$and`.
 */
export function buildProductSearchFilter(
  parsed: ParsedProductSearch,
  entities: SearchEntityMatch[],
  stage: ProductSearchStage,
): UnknownRecord[] {
  const clause = stage === "terms" ? termsClause : textClause;

  return parsed.groups.map((group, index) => {
    const branches = group.alternatives.map((alternative) =>
      allOf(alternative.map(clause)),
    );
    const match = entities[index];
    if (match && match.categoryIds.length > 0) {
      branches.push({ category: { $in: toObjectIds(match.categoryIds) } });
    }
    if (match && match.brandIds.length > 0) {
      branches.push({ brand: { $in: toObjectIds(match.brandIds) } });
    }
    return anyOf(branches);
  });
}

/**
 * The relevance score of a product for this search, as an aggregation
 * expression over `search.name` and `search.terms`. Tiers, highest first:
 * the name IS the query; the name starts with it; the name contains it at a
 * word boundary; each query word starts a word of the name; each word is a
 * term (a tag, a SKU, an option value); the product sits in a category or
 * brand the query named. Pure string operators — no regex compiles per row.
 */
export function buildProductSearchScoreExpr(
  parsed: ParsedProductSearch,
  entities: SearchEntityMatch[],
): UnknownRecord {
  const phrases = unique([
    parsed.tokens.join(" "),
    parsed.tokens.map(singularizeSearchWord).join(" "),
  ]);
  const padded = { $concat: [" ", "$$name", " "] };
  const startsWith = (values: string[]) => ({
    $or: values.map((value) => ({
      $eq: [{ $indexOfCP: ["$$name", value] }, 0],
    })),
  });
  const hasWordStart = (values: string[]) => ({
    $or: values.map((value) => ({
      $gte: [{ $indexOfCP: [padded, ` ${value}`] }, 0],
    })),
  });
  const tier = (condition: unknown, points: number) => ({
    $cond: [condition, points, 0],
  });

  const parts: UnknownRecord[] = [
    tier({ $in: ["$$name", phrases] }, 1000),
    tier(startsWith(phrases), 400),
    tier(hasWordStart(phrases), 250),
    ...parsed.tokens.map((token) => tier(hasWordStart(expandSearchWord(token)), 60)),
    ...parsed.tokens.map((token) =>
      tier(
        {
          $gt: [
            { $size: { $setIntersection: [expandSearchWord(token), "$$terms"] } },
            0,
          ],
        },
        15,
      ),
    ),
  ];

  for (const match of entities) {
    if (match.categoryIds.length > 0) {
      parts.push(
        tier(
          {
            $in: [
              { $ifNull: ["$category", null] },
              toObjectIds(match.categoryIds),
            ],
          },
          30,
        ),
      );
    }
    if (match.brandIds.length > 0) {
      parts.push(
        tier(
          { $in: [{ $ifNull: ["$brand", null] }, toObjectIds(match.brandIds)] },
          30,
        ),
      );
    }
  }
  parts.push(tier({ $eq: ["$featured", true] }, 5));

  return {
    $let: {
      vars: {
        name: { $ifNull: ["$search.name", ""] },
        terms: { $ifNull: ["$search.terms", []] },
      },
      in: { $add: parts },
    },
  };
}

/**
 * The fields the pre-index substring search reads. Only the primary ones —
 * a store that has not run the backfill yet still gets a search that does
 * not answer "pants" with every product whose description says "pants".
 */
const LEGACY_SUBSTRING_FIELDS = [
  "name",
  "title",
  "tags",
  "sku",
  "barcode",
  "productType",
  "variants.name",
  "variants.sku",
  "options.values.value",
  "attributes.value",
] as const;

/**
 * The search a store gets until `pnpm db:migrate product-search` has run:
 * case-insensitive substrings over the primary fields, unindexed. Same group
 * semantics as the indexed filter, no ranking.
 */
export function buildLegacyProductSearchFilter(
  parsed: ParsedProductSearch,
): UnknownRecord[] {
  return parsed.groups.map((group) =>
    anyOf(
      group.alternatives.map((alternative) =>
        allOf(
          alternative.map((word) => ({
            $or: LEGACY_SUBSTRING_FIELDS.map((field) => ({
              [field]: { $regex: escapeRegExp(word), $options: "i" },
            })),
          })),
        ),
      ),
    ),
  );
}
