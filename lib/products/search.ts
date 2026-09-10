const PRODUCT_SEARCH_FIELDS = [
  "name",
  "title",
  "slug",
  "handle",
  "sku",
  "barcode",
  "productType",
  "tags",
  "shortDescription",
  "description",
  "attributes.name",
  "attributes.value",
  "variants.name",
  "variants.sku",
  "variants.barcode",
  "variants.attributes.name",
  "variants.attributes.value",
  "variants.optionValues.value",
  "options.name",
  "options.values.value",
  "seo.pageTitle",
  "seo.metaDescription",
  "seo.handle",
] as const;

const MAX_SEARCH_LENGTH = 100;
const MAX_SEARCH_TOKENS = 8;

// Bidirectional synonym groups. Tokens are normalized lower-case; each token in a group
// expands to all sibling tokens (joined by space) so MongoDB $text widens the OR-match.
// Keep groups small and high-signal — overly broad groups dilute relevance.
const SYNONYM_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["shoe", "shoes", "sneaker", "sneakers", "trainer", "trainers", "footwear"],
  ["phone", "phones", "mobile", "smartphone", "smartphones", "cellphone"],
  ["laptop", "laptops", "notebook", "notebooks", "ultrabook"],
  ["tv", "television", "televisions"],
  ["headphone", "headphones", "earphone", "earphones", "earbuds", "earbud"],
  ["tshirt", "t-shirt", "tee", "tees"],
  ["hoodie", "hoodies", "sweatshirt", "sweatshirts"],
  ["jacket", "jackets", "coat", "coats"],
  ["bag", "bags", "backpack", "backpacks", "rucksack"],
  ["watch", "watches", "smartwatch", "smartwatches"],
  ["sofa", "couch", "couches", "sofas"],
  ["fridge", "refrigerator", "refrigerators"],
  ["bike", "bikes", "bicycle", "bicycles", "cycle"],
  ["pant", "pants", "trouser", "trousers"],
];

const SYNONYM_MAP: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const group of SYNONYM_GROUPS) {
    for (const token of group) {
      const siblings = group.filter((sibling) => sibling !== token);
      map.set(token, siblings);
    }
  }
  return map;
})();

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeProductSearchInput(search?: string | null): string {
  return (search || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_SEARCH_LENGTH);
}

export function tokenizeProductSearch(search?: string | null): string[] {
  const normalized = normalizeProductSearchInput(search);
  if (!normalized) return [];

  const tokens = normalized
    .split(/[\s,/\\|+._-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const usefulTokens = tokens.filter((token) => token.length >= 2);
  const finalTokens = usefulTokens.length > 0 ? usefulTokens : tokens;

  return Array.from(new Set(finalTokens)).slice(0, MAX_SEARCH_TOKENS);
}

/**
 * How the storefront matches a search (`general.productSearchMode`).
 *
 * - `regex` — every token must appear somewhere in the fields below, as a
 *   substring, case-insensitively. Exact and forgiving ("phon" finds phones),
 *   but an unanchored `$regex` cannot use an index: each token scans every
 *   candidate document, fine at hundreds-to-thousands of products and a cliff
 *   at tens of thousands.
 * - `text` — the Product text index (name/title/description/tags) answers
 *   whole words, with results ranked by relevance. Tokens are still ANDed, so a
 *   search stays as precise as before; what changes is that partial words stop
 *   matching and the index does the work. Code-like tokens (a SKU, a barcode)
 *   are never words, so they go to an anchored prefix match on the indexed
 *   `skuNormalized` / `barcodeNormalized` columns instead.
 */
export type ProductSearchMode = "regex" | "text";

export function normalizeProductSearchMode(value: unknown): ProductSearchMode {
  return value === "text" ? "text" : "regex";
}

/**
 * A token that reads as a product code rather than a word: at least one
 * digit among letters, digits and the separators codes use — "SKU-1042",
 * "8901234567", "ab12". A pure number of three or more digits is a code too
 * (barcodes are digits), which is the honest reading of a shopper typing
 * digits into a product search.
 */
export function isCodeLikeToken(token: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{2,}$/.test(token) && /\d/.test(token);
}

const CODE_SEARCH_FIELDS = ["skuNormalized", "barcodeNormalized"] as const;

function buildCodeTokenQuery(token: string): Record<string, unknown> {
  // The normalized columns are stored upper-case; an anchored, case-insensitive
  // prefix regex stays index-friendly (a leading anchor lets MongoDB bound the
  // scan) and still finds a code typed from memory.
  const anchored = `^${escapeRegexLiteral(token.toUpperCase())}`;
  return {
    $or: [
      ...CODE_SEARCH_FIELDS.map((field) => ({
        [field]: { $regex: anchored },
      })),
      { "variants.sku": { $regex: anchored, $options: "i" } },
      { "variants.barcode": { $regex: anchored, $options: "i" } },
    ],
  };
}

function buildRegexTokenQuery(token: string): Record<string, unknown> {
  const escapedToken = escapeRegexLiteral(token);
  return {
    $or: PRODUCT_SEARCH_FIELDS.map((field) => ({
      [field]: { $regex: escapedToken, $options: "i" },
    })),
  };
}

/**
 * The Mongo filter for a storefront search, or null for an empty one.
 *
 * In `text` mode the result carries a top-level `$text` clause: MongoDB only
 * accepts `$text` at the top level of a query, so callers merge the object
 * into their filter rather than pushing it into an `$and`. Each word is
 * quoted so every token is required (the same AND the regex mode has) — an
 * unquoted `$text` search ORs its terms and would answer "red shoes" with
 * everything red.
 */
export function buildProductSearchQuery(
  search?: string | null,
  mode: ProductSearchMode = "regex",
): Record<string, unknown> | null {
  const tokens = tokenizeProductSearch(search);
  if (tokens.length === 0) return null;

  if (mode === "regex") {
    return { $and: tokens.map(buildRegexTokenQuery) };
  }

  // Codes are judged on what the shopper typed between spaces, not on the
  // tokenizer's pieces: "SKU-1042" must stay one prefix, not become the word
  // "sku" plus the number 1042 (a $text search for "sku" finds nothing).
  const chunks = normalizeProductSearchInput(search)
    .split(/[\s,|]+/)
    .filter(Boolean);
  const codes = chunks.filter(isCodeLikeToken);
  const words = chunks
    .filter((chunk) => !isCodeLikeToken(chunk))
    .flatMap((chunk) => tokenizeProductSearch(chunk));
  const query: Record<string, unknown> = {};
  if (words.length > 0) {
    query.$text = {
      $search: words.map((word) => `"${word.replace(/"/g, "")}"`).join(" "),
    };
  }
  if (codes.length > 0) {
    query.$and = codes.map(buildCodeTokenQuery);
  }
  return query;
}

/** True when a query from buildProductSearchQuery ranks by the text index. */
export function isTextSearchQuery(
  query: Record<string, unknown> | null,
): query is Record<string, unknown> & { $text: unknown } {
  return Boolean(query && "$text" in query);
}

function expandTokenWithSynonyms(token: string): string[] {
  const expanded = new Set<string>([token]);
  const siblings = SYNONYM_MAP.get(token.toLowerCase());
  if (siblings) for (const sibling of siblings) expanded.add(sibling);
  return Array.from(expanded);
}

// Regex-based query used by the sales agent. Each tokenized term is expanded
// with synonyms (shoes ↔ sneaker ↔ trainer ↔ footwear) and OR-matched across
// all searchable product fields. Tokens themselves are AND'd, so "running
// shoes" requires BOTH a running-ish term AND a shoe-ish term to be present.
// Does not depend on a MongoDB text index — works on any collection state.
export function buildProductAgentSearch(
  search?: string | null,
): Record<string, unknown> | null {
  const tokens = tokenizeProductSearch(search);
  if (tokens.length === 0) return null;

  return {
    $and: tokens.map((token) => ({
      $or: expandTokenWithSynonyms(token).flatMap((term) => {
        const escaped = escapeRegexLiteral(term);
        return PRODUCT_SEARCH_FIELDS.map((field) => ({
          [field]: { $regex: escaped, $options: "i" },
        }));
      }),
    })),
  };
}

// Compute a relevance score so callers can rank candidates in-app. Name and
// tag matches weigh heaviest because they're the strongest intent signal;
// description matches are weakest because product descriptions are noisy.
export function scoreProductRelevance(
  product: {
    name?: string;
    title?: string;
    tags?: string[];
    shortDescription?: string;
    description?: string;
    category?: { name?: string };
  },
  search?: string | null,
): number {
  const tokens = tokenizeProductSearch(search);
  if (tokens.length === 0) return 0;

  const name = (product.name || product.title || "").toLowerCase();
  const tags = (product.tags || []).map((tag) => tag.toLowerCase());
  const categoryName = (product.category?.name || "").toLowerCase();
  const short = (product.shortDescription || "").toLowerCase();
  const desc = (product.description || "")
    .replace(/<[^>]*>/g, " ")
    .toLowerCase();

  let score = 0;
  for (const token of tokens) {
    const variants = expandTokenWithSynonyms(token).map((value) =>
      value.toLowerCase(),
    );
    for (const variant of variants) {
      const isOriginal = variant === token.toLowerCase();
      const weight = isOriginal ? 1 : 0.6;
      if (name.includes(variant)) score += 10 * weight;
      if (tags.some((tag) => tag.includes(variant))) score += 6 * weight;
      if (categoryName.includes(variant)) score += 4 * weight;
      if (short.includes(variant)) score += 2 * weight;
      else if (desc.includes(variant)) score += 1 * weight;
    }
  }
  return score;
}
