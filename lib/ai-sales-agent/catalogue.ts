import {
  collectIndexWords,
  expandSearchTerm,
  normalizeSearchText,
  type ParsedProductSearch,
  type SearchEntityMatch,
} from "@/lib/products/search";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { isProductAvailable } from "@/lib/products/stock-policy";

/**
 * The agent's view of the catalogue — the pure half.
 *
 * Everything here is a function over plain product rows, so the retrieval
 * behaviour the agent relies on is pinned by `tests/ai-sales-agent-catalogue.test.ts`
 * without a database or a model call. `tools.ts` is the thin layer that
 * fetches rows and hands them here.
 *
 * Three concerns:
 *
 * - **The search ladder.** The model writes the query, and a model writes
 *   sentences: "samsung phone 256gb blue". The storefront engine requires
 *   every word, so one word too many is zero results — and zero results made
 *   the agent tell the customer the store does not sell phones. The ladder
 *   retries with one word dropped at a time, then with each word alone, and
 *   reports HOW WELL the results matched so the agent can say "no blue one,
 *   but here are the 256 GB Samsungs" instead.
 * - **Match grading.** A hit is not always the thing asked for. The engine
 *   matched "apple iphone" to an Apple Watch — its spec sheet says
 *   "compatible with iPhone" — and the agent told a customer the store had no
 *   iPhones while five sat in the iPhone category. `gradeProductMatch` reads
 *   each product's identity fields itself, so the tool knows a strong match
 *   from a stray one and keeps searching when it only has the latter.
 * - **Variant selection.** A customer says "the red one in XL"; the model
 *   never sees variant ids unless it asks for details. `resolveVariantSelection`
 *   turns option words into a variant, or into the exact question to ask.
 * - **What the model gets to see.** A compact summary per product — price,
 *   stock, options, variants, category, a line of description — so it can
 *   compare and answer without a second round of tool calls.
 */

export type AgentVariant = {
  _id?: unknown;
  name?: string;
  sku?: string;
  price?: number;
  comparePrice?: number;
  stock?: number;
  image?: string;
  mediaId?: string;
  optionValues?: unknown;
};

export type AgentProduct = {
  _id?: unknown;
  name?: string;
  slug?: string;
  handle?: string;
  description?: string;
  shortDescription?: string;
  price?: number;
  comparePrice?: number;
  priceRange?: { min?: number; max?: number } | null;
  priceOnRequest?: boolean;
  stock?: number;
  rating?: number;
  reviewCount?: number;
  images?: string[];
  media?: { _id?: unknown; url?: string }[];
  category?: { name?: string; slug?: string } | null;
  brand?: { name?: string; slug?: string } | null;
  productType?: string;
  tags?: string[];
  options?: { name?: string; values?: unknown }[];
  variants?: AgentVariant[];
  shipping?: { isPhysicalProduct?: boolean } | null;
  inventory?: {
    tracked?: boolean;
    continueSellingWhenOutOfStock?: boolean;
  } | null;
};

function unique<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

function productKey(product: { _id?: unknown }): string {
  return String(product._id);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntity(entity: string): string {
  if (entity.startsWith("#")) {
    const code =
      entity[1]?.toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : " ";
  }
  return NAMED_ENTITIES[entity.toLowerCase()] ?? " ";
}

/**
 * Plain text for the model and the cards: tags stripped, entities decoded
 * ("Soft &amp; warm" stays "Soft & warm"), whitespace folded, capped.
 */
export function plainText(value: unknown, max = 240): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity: string) =>
      decodeEntity(entity),
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// The search ladder
// ---------------------------------------------------------------------------

/** Beyond this the leave-one-out set grows past what is worth running. */
const MAX_LADDER_GROUPS = 5;

export type LadderQuery = {
  /** The query string to hand to the storefront search. */
  query: string;
  /** The ranking tokens that query requires — what a hit "matched". */
  tokens: string[];
};

type SearchLadder = {
  full: LadderQuery;
  /** Every query with exactly one group left out. Empty for a one-word query. */
  leaveOneOut: LadderQuery[];
  /** Every group alone. Empty below three groups, where it equals leave-one-out. */
  singles: LadderQuery[];
};

/**
 * The queries the agent tries, in order, until one answers. Groups are the
 * parser's own (a chunk with its joined and split forms), re-issued by their
 * source chunk so "t-shirt" keeps meaning "shirt or tshirt" at every rung.
 */
export function planSearchLadder(parsed: ParsedProductSearch): SearchLadder {
  const groups = parsed.groups.slice(0, MAX_LADDER_GROUPS);
  const queryOf = (selected: typeof groups): LadderQuery => ({
    query: selected.map((group) => group.chunk).join(" "),
    tokens: unique(selected.flatMap((group) => group.tokens)),
  });

  return {
    full: queryOf(groups),
    leaveOneOut:
      groups.length >= 2
        ? groups.map((_, index) =>
            queryOf(groups.filter((_, other) => other !== index)),
          )
        : [],
    singles: groups.length >= 3 ? groups.map((group) => queryOf([group])) : [],
  };
}

type LadderResult<T> = { tokens: string[]; products: T[] };

type MergedLadder<T> = {
  products: T[];
  /** Product id → the query tokens the product is known to have matched. */
  matched: Map<string, string[]>;
};

type MergeEntry<T> = {
  product: T;
  matched: Set<string>;
  bestRank: number;
  hits: number;
  order: number;
};

function collect<T extends { _id?: unknown }>(
  results: LadderResult<T>[],
): Map<string, MergeEntry<T>> {
  const entries = new Map<string, MergeEntry<T>>();
  let order = 0;
  for (const result of results) {
    result.products.forEach((product, rank) => {
      const key = productKey(product);
      const entry = entries.get(key);
      if (entry) {
        for (const token of result.tokens) entry.matched.add(token);
        entry.bestRank = Math.min(entry.bestRank, rank);
        entry.hits += 1;
        return;
      }
      entries.set(key, {
        product,
        matched: new Set(result.tokens),
        bestRank: rank,
        hits: 1,
        order: order++,
      });
    });
  }
  return entries;
}

function finish<T>(
  entries: Iterable<MergeEntry<T>>,
  limit: number,
): MergedLadder<T> {
  const products: T[] = [];
  const matched = new Map<string, string[]>();
  for (const entry of entries) {
    if (products.length >= limit) break;
    products.push(entry.product);
    matched.set(
      productKey(entry.product as { _id?: unknown }),
      [...entry.matched],
    );
  }
  return { products, matched };
}

/**
 * Leave-one-out results are equals — each dropped a different word — so the
 * merge takes rank 0 of every result before any rank 1. A product found by
 * several of them matched more words, and that union is what the summary
 * reports.
 */
export function mergeRoundRobin<T extends { _id?: unknown }>(
  results: LadderResult<T>[],
  limit: number,
): MergedLadder<T> {
  const entries = collect(results);
  const ordered = [...entries.values()].sort(
    (a, b) => a.bestRank - b.bestRank || b.hits - a.hits || a.order - b.order,
  );
  return finish(ordered, limit);
}

/**
 * Single-word results are not equals: a product two of them found matched
 * two words of the query, and belongs above one that matched one.
 */
export function mergeByCoverage<T extends { _id?: unknown }>(
  results: LadderResult<T>[],
  limit: number,
): MergedLadder<T> {
  const entries = collect(results);
  const ordered = [...entries.values()].sort(
    (a, b) =>
      b.matched.size - a.matched.size ||
      a.bestRank - b.bestRank ||
      a.order - b.order,
  );
  return finish(ordered, limit);
}

// ---------------------------------------------------------------------------
// Options and variants
// ---------------------------------------------------------------------------

function optionValueText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const record = value as { value?: unknown };
    return typeof record.value === "string" ? record.value.trim() : "";
  }
  return "";
}

function optionValueName(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as { optionName?: unknown };
    return typeof record.optionName === "string" ? record.optionName.trim() : "";
  }
  return "";
}

function variantOptionValues(variant: AgentVariant): string[] {
  return Array.isArray(variant.optionValues)
    ? variant.optionValues.map(optionValueText).filter(Boolean)
    : [];
}

function variantIsAvailable(product: AgentProduct, variant: AgentVariant) {
  return isProductAvailable(product, variant.stock);
}

type ProductOptionSummary = {
  name: string;
  values: string[];
  /** Values no purchasable variant carries — sold out sizes, colours. */
  unavailable?: string[];
};

/**
 * The choices a product offers, in the merchant's own words: from the
 * product's option list when it has one, otherwise reconstructed from the
 * variants' option values (products imported before options existed).
 */
export function describeProductOptions(
  product: AgentProduct,
): ProductOptionSummary[] {
  const valuesByName = new Map<string, string[]>();
  const add = (name: string, value: string) => {
    if (!name || !value) return;
    const values = valuesByName.get(name) || [];
    if (!values.includes(value)) values.push(value);
    valuesByName.set(name, values);
  };

  for (const option of product.options || []) {
    const name = typeof option?.name === "string" ? option.name.trim() : "";
    if (!name) continue;
    if (!valuesByName.has(name)) valuesByName.set(name, []);
    for (const value of Array.isArray(option.values) ? option.values : []) {
      add(name, optionValueText(value));
    }
  }

  const variants = product.variants || [];
  for (const variant of variants) {
    for (const value of Array.isArray(variant.optionValues)
      ? variant.optionValues
      : []) {
      add(optionValueName(value), optionValueText(value));
    }
  }

  const carriedByAvailable = new Set<string>();
  for (const variant of variants) {
    if (!variantIsAvailable(product, variant)) continue;
    for (const value of variantOptionValues(variant)) {
      carriedByAvailable.add(normalizeSearchText(value));
    }
  }

  return [...valuesByName.entries()]
    .filter(([, values]) => values.length > 0)
    .map(([name, values]) => {
      const unavailable =
        variants.length > 0
          ? values.filter(
              (value) => !carriedByAvailable.has(normalizeSearchText(value)),
            )
          : [];
      return unavailable.length > 0
        ? { name, values, unavailable }
        : { name, values };
    });
}

type VariantSelection = {
  variantId?: string;
  /** Option name → the customer's choice, e.g. { Size: "XL", Color: "Red" }. */
  options?: Record<string, string>;
  /** The choice as free text, e.g. "red / xl" or "256GB blue". */
  variant?: string;
};

type VariantResolution =
  | { kind: "none" }
  | { kind: "selected"; variant: AgentVariant }
  | { kind: "ambiguous"; candidates: AgentVariant[] }
  | { kind: "not_found" };

/** A requirement is one phrase; it is met by a value that is, contains or begins with it. */
function valueMeets(value: string, requirement: string): boolean {
  if (value === requirement) return true;
  if (value.split(" ").includes(requirement)) return true;
  return requirement.length >= 2 && value.startsWith(requirement);
}

function variantMeets(values: string[], requirement: string): boolean {
  if (values.some((value) => valueMeets(value, requirement))) return true;
  // "red xl" as one phrase matches nothing; as two words it is a fine request.
  const words = requirement.split(" ").filter(Boolean);
  return (
    words.length > 1 &&
    words.every((word) => values.some((value) => valueMeets(value, word)))
  );
}

function selectionRequirements(selection: VariantSelection): string[] {
  const requirements: string[] = [];
  for (const value of Object.values(selection.options || {})) {
    if (typeof value === "string") requirements.push(normalizeSearchText(value));
  }
  if (typeof selection.variant === "string") {
    for (const piece of selection.variant.split(/[/,|]+/)) {
      requirements.push(normalizeSearchText(piece));
    }
  }
  return unique(requirements.filter(Boolean));
}

/**
 * Which variant the customer means. Exact id wins; otherwise every option
 * word they gave must be carried by the variant, comparing the merchant's
 * values case- and accent-insensitively and allowing a prefix ("256" for
 * "256GB"). With nothing given, a product with one variant — or one that is
 * still purchasable — needs no question; anything else is `ambiguous`, and
 * the caller asks, listing the candidates.
 */
export function resolveVariantSelection(
  product: AgentProduct,
  selection: VariantSelection,
): VariantResolution {
  const variants = product.variants || [];
  if (variants.length === 0) return { kind: "none" };

  if (selection.variantId) {
    const variant = variants.find(
      (candidate) => String(candidate._id) === selection.variantId,
    );
    return variant ? { kind: "selected", variant } : { kind: "not_found" };
  }

  const requirements = selectionRequirements(selection);
  const available = variants.filter((variant) =>
    variantIsAvailable(product, variant),
  );

  if (requirements.length === 0) {
    if (variants.length === 1) return { kind: "selected", variant: variants[0]! };
    if (available.length === 1) return { kind: "selected", variant: available[0]! };
    return { kind: "ambiguous", candidates: available.length > 0 ? available : variants };
  }

  const candidates = variants.filter((variant) => {
    const values = [
      ...variantOptionValues(variant),
      ...(typeof variant.name === "string" ? variant.name.split("/") : []),
    ]
      .map(normalizeSearchText)
      .filter(Boolean);
    return requirements.every((requirement) => variantMeets(values, requirement));
  });

  if (candidates.length === 0) return { kind: "not_found" };
  if (candidates.length === 1) return { kind: "selected", variant: candidates[0]! };

  const purchasable = candidates.filter((variant) =>
    variantIsAvailable(product, variant),
  );
  if (purchasable.length === 1) return { kind: "selected", variant: purchasable[0]! };
  return {
    kind: "ambiguous",
    candidates: purchasable.length > 0 ? purchasable : candidates,
  };
}

/**
 * The "Add to cart" pill a search result may carry. A product with several
 * variants gets none — the cart refuses a variant product without a variant,
 * and the agent asks for the choice instead.
 */
export function cartPillFor(
  product: AgentProduct,
): { variantId?: string } | null {
  if (isQuoteOnlyProduct(product)) return null;
  const variants = product.variants || [];
  if (variants.length === 0) {
    return isProductAvailable(product, product.stock) ? {} : null;
  }
  if (variants.length === 1) {
    const only = variants[0]!;
    return variantIsAvailable(product, only)
      ? { variantId: String(only._id) }
      : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Match grading
// ---------------------------------------------------------------------------

/**
 * What a query word names, decided against the store's own categories and
 * brands (the storefront's entity index). The kind sets how strictly a
 * product must carry the word before it counts as the thing asked for:
 *
 * - `category` — the word names a category the store has ("iphone",
 *   "phone"). Only a product's identity — name, category branch, brand,
 *   tags — may satisfy it; a spec sheet or a description that mentions the
 *   word does not make a watch an iPhone.
 * - `brand` — the word names a brand the store has. Brands are often left
 *   unset on the product rows, so any match the engine found is accepted.
 * - `other` — a model, colour, size or storage: the identity fields, or the
 *   product's own options and variants.
 */
export type QueryTokenKind = "category" | "brand" | "other";

export type GradedQuery = {
  tokens: string[];
  kinds: Map<string, QueryTokenKind>;
};

const KIND_STRICTNESS: Record<QueryTokenKind, number> = {
  category: 2,
  brand: 1,
  other: 0,
};

/**
 * Each query token's kind, from what its group resolved to in the entity
 * index. A token that sits in two groups takes the stricter kind.
 */
export function classifyQueryTokens(
  parsed: ParsedProductSearch,
  entities: SearchEntityMatch[],
): GradedQuery {
  const kinds = new Map<string, QueryTokenKind>();
  parsed.groups.forEach((group, index) => {
    const match = entities[index];
    const kind: QueryTokenKind =
      match && match.categoryIds.length > 0
        ? "category"
        : match && match.brandIds.length > 0
          ? "brand"
          : "other";
    for (const token of group.tokens) {
      const current = kinds.get(token);
      if (!current || KIND_STRICTNESS[kind] > KIND_STRICTNESS[current]) {
        kinds.set(token, kind);
      }
    }
  });
  return { tokens: parsed.tokens, kinds };
}

export type MatchGrade = {
  /** The query words the product carries, or the engine matched it on. */
  matchedTerms: string[];
  /** Every query word is carried where its kind demands: the thing asked for. */
  strong: boolean;
  /**
   * How many words the row itself satisfies, brand words aside — the order
   * among products that are not the thing asked for. Brand words stay out
   * because brand data is the unreliable part: an iPhone row without its
   * brand must still outrank a watch that merely says "Apple".
   */
  satisfied: number;
};

/** The indexable words of some text fields, the way the engine indexes them. */
function fieldWords(values: unknown[]): Set<string> {
  const words = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    for (const word of collectIndexWords(value)) words.add(word);
  }
  return words;
}

/** Whether any of `words` starts with the token, its singular or a synonym — the engine's own test. */
function carries(words: Set<string>, token: string): boolean {
  const forms = expandSearchTerm(token);
  for (const word of words) {
    if (forms.some((form) => word.startsWith(form))) return true;
  }
  return false;
}

/**
 * How well one product answers the query, read from the product row itself
 * rather than trusted from the engine's hit. `engineMatched` is what the
 * engine is known to have matched (the ladder rung's tokens); it still
 * counts toward `matchedTerms`, so the model sees a word that matched only
 * in a description, but it never makes the match `strong`. `categoryLineage`
 * is the names of the product's category and its ancestors, so "phone"
 * reaches a product filed under Mobile Phones → Phones → Samsung.
 */
export function gradeProductMatch(
  product: AgentProduct,
  query: GradedQuery,
  engineMatched: readonly string[],
  categoryLineage: readonly string[] = [],
): MatchGrade {
  const identity = fieldWords([
    product.name,
    product.category?.name,
    ...categoryLineage,
    product.brand?.name,
    ...(product.tags || []),
  ]);
  const choices = fieldWords([
    product.productType,
    ...(product.options || []).flatMap((option) => [
      option?.name,
      ...(Array.isArray(option?.values) ? option.values.map(optionValueText) : []),
    ]),
    ...(product.variants || []).flatMap((variant) => [
      variant.name,
      ...variantOptionValues(variant),
    ]),
  ]);
  const engine = new Set(engineMatched);

  const matchedTerms: string[] = [];
  let strong = true;
  let satisfied = 0;
  for (const token of query.tokens) {
    const kind = query.kinds.get(token) ?? "other";
    const inIdentity = carries(identity, token);
    const carried =
      kind === "category"
        ? inIdentity
        : kind === "brand"
          ? inIdentity || carries(choices, token) || engine.has(token)
          : inIdentity || carries(choices, token);
    if (carried || engine.has(token)) matchedTerms.push(token);
    if (!carried) strong = false;
    else if (kind !== "brand") satisfied += 1;
  }
  return { matchedTerms, strong, satisfied };
}

// ---------------------------------------------------------------------------
// What the model sees
// ---------------------------------------------------------------------------

type VariantSummary = {
  id: string;
  name: string;
  price: number;
  inStock: boolean;
};

type ProductSummary = {
  id: string;
  name: string;
  category?: string;
  price?: number;
  priceRange?: { min: number; max: number };
  compareAtPrice?: number;
  priceOnRequest?: true;
  inStock: boolean;
  rating?: number;
  reviews?: number;
  description: string;
  options?: ProductOptionSummary[];
  variants?: VariantSummary[];
  /** Variants beyond the ones listed. */
  moreVariants?: number;
  /** Ladder: the query words this product is known to have matched. */
  matchedTerms?: string[];
};

const SUMMARY_DESCRIPTION_LENGTH = 100;

function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The compact row the model reasons over. Everything a customer might ask
 * next — cheaper? in stock? which sizes? — is answered from here without a
 * second tool call; the full description stays with get_product_details.
 */
export function summarizeProductForModel(
  product: AgentProduct,
  options: { matchedTerms?: string[]; variantLimit?: number } = {},
): ProductSummary {
  const variants = product.variants || [];
  const variantLimit = options.variantLimit ?? 6;
  const inStock =
    variants.length > 0
      ? variants.some((variant) => variantIsAvailable(product, variant))
      : isProductAvailable(product, product.stock);

  const summary: ProductSummary = {
    id: productKey(product),
    name: product.name || "Product",
    inStock,
    description: plainText(
      product.shortDescription || product.description,
      SUMMARY_DESCRIPTION_LENGTH,
    ),
  };

  if (product.category?.name) summary.category = product.category.name;

  if (isQuoteOnlyProduct(product)) {
    summary.priceOnRequest = true;
  } else {
    if (isMoney(product.price)) summary.price = product.price;
    const range = product.priceRange;
    if (
      range &&
      isMoney(range.min) &&
      isMoney(range.max) &&
      range.max > range.min
    ) {
      summary.priceRange = { min: range.min, max: range.max };
    }
    if (
      isMoney(product.comparePrice) &&
      isMoney(product.price) &&
      product.comparePrice > product.price
    ) {
      summary.compareAtPrice = product.comparePrice;
    }
  }

  if (isMoney(product.rating) && product.rating > 0) {
    summary.rating = Math.round(product.rating * 10) / 10;
  }
  if (isMoney(product.reviewCount) && product.reviewCount > 0) {
    summary.reviews = product.reviewCount;
  }

  const optionSummary = describeProductOptions(product);
  if (optionSummary.length > 0) summary.options = optionSummary;

  if (variants.length > 0) {
    summary.variants = variants.slice(0, variantLimit).map((variant) => ({
      id: String(variant._id),
      name: variant.name || variantOptionValues(variant).join(" / ") || "Variant",
      price: isMoney(variant.price) ? variant.price : (product.price ?? 0),
      inStock: variantIsAvailable(product, variant),
    }));
    if (variants.length > variantLimit) {
      summary.moreVariants = variants.length - variantLimit;
    }
  }

  if (options.matchedTerms && options.matchedTerms.length > 0) {
    summary.matchedTerms = options.matchedTerms;
  }

  return summary;
}
