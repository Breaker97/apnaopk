import { PAYMENT_METHODS } from "@/lib/constants";
import {
  normalizeSearchText,
  productSearchTokens,
  singularizeSearchWord,
} from "@/lib/products/search";
import {
  fillContentPlaceholders,
  type ContentPagesSettings,
  type ContentPlaceholders,
} from "@/lib/site-config/content-pages-config";
import { plainText } from "./catalogue";

/**
 * What the agent knows about the store beyond its products — the pure half.
 *
 * Three things, each built from plain settings data so the tests can pin
 * them without a database:
 *
 * - **The category directory.** A compact list of the store's categories for
 *   the session state, so a need with no product word in it ("a gift for a
 *   gamer") can become a category browse, and so the model sees what the
 *   store sells and in which language.
 * - **The store context.** The real configuration a customer asks about —
 *   which payment methods checkout offers, what shipping costs and how long
 *   it takes, where the store is and when it answers — projected to exactly
 *   the fields the model may see. Nothing here is a credential.
 * - **The knowledge base.** The merchant's FAQ and policy pages cut into
 *   paragraphs the FAQ tool can rank, so a return window written on the
 *   Returns page is found without the merchant re-typing it as agent FAQ.
 */

function unique<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type CategoryNode = {
  name: string;
  slug: string;
  productCount: number;
  children: CategoryNode[];
};

export type AgentCategoryChild = { name: string; slug: string; products: number };

export type AgentCategory = AgentCategoryChild & {
  children?: AgentCategory[];
};

/** Entries the session state carries, every level together. */
const MAX_DIRECTORY_ENTRIES = 40;

/**
 * The store's live categories, every level, biggest first within a level,
 * bounded. A category with nothing in it is left out: the model must never
 * steer a customer into an empty aisle.
 *
 * Every level is listed because the model names the most specific one it
 * can — "iphone" under Mobile Phones → Phones → iPhone — and a name it
 * cannot find in the directory it treats as one the store lacks. The cap is
 * spent a level at a time, top-level aisles first: a store with more
 * categories than the cap still shows the model everything it sells, and
 * loses only the finer branches (which the search tool falls back to
 * searching by name).
 */
export function flattenCategoryDirectory(
  roots: CategoryNode[],
  cap = MAX_DIRECTORY_ENTRIES,
): AgentCategory[] {
  const live = (nodes: CategoryNode[]) =>
    nodes
      .filter((node) => node.productCount > 0)
      .sort((a, b) => b.productCount - a.productCount);

  const directory: AgentCategory[] = [];
  let entries = 0;
  let level = live(roots).map((node) => ({ node, parent: null as AgentCategory | null }));
  while (level.length > 0 && entries < cap) {
    const next: typeof level = [];
    for (const { node, parent } of level) {
      if (entries >= cap) break;
      const entry: AgentCategory = {
        name: node.name,
        slug: node.slug,
        products: node.productCount,
      };
      entries += 1;
      if (parent) (parent.children ??= []).push(entry);
      else directory.push(entry);
      for (const child of live(node.children)) next.push({ node: child, parent: entry });
    }
    level = next;
  }
  return directory;
}

function directoryEntries(directory: AgentCategory[]): AgentCategoryChild[] {
  return directory.flatMap((entry) => [
    { name: entry.name, slug: entry.slug, products: entry.products },
    ...directoryEntries(entry.children || []),
  ]);
}

/**
 * Slug → the names of that category and every ancestor above it, for
 * grading a product's match: a product filed under Samsung is a "phone"
 * too, because Samsung sits under Mobile Phones → Phones.
 */
export function categoryLineage(directory: AgentCategory[]): Map<string, string[]> {
  const lineage = new Map<string, string[]>();
  const walk = (entries: AgentCategory[], ancestors: string[]) => {
    for (const entry of entries) {
      const names = [...ancestors, entry.name];
      lineage.set(entry.slug, names);
      if (entry.children) walk(entry.children, names);
    }
  };
  walk(directory, []);
  return lineage;
}

function wordsOf(value: string): string[] {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

function wordForms(word: string): string[] {
  return unique([word, singularizeSearchWord(word)]);
}

/**
 * Whether `word` is the word one of `forms` asks for. BOTH sides are
 * singularized, because either may be the plural: "accessory" has to reach
 * "Accessories" just as "phones" reaches "Mobile Phones".
 */
function wordMatches(word: string, forms: string[]): boolean {
  const candidates = wordForms(word);
  return forms.some((form) =>
    candidates.some((candidate) => candidate.startsWith(form)),
  );
}

/**
 * The category the model means by a slug or a name. Slugs match exactly;
 * names match whole, then by their start, then word by word ("phones" for
 * "Mobile Phones"), plural or singular. Ties go to the bigger category, and
 * a name the store does not have resolves to nothing rather than to a guess.
 */
export function resolveCategoryRequest(
  directory: AgentCategory[],
  requested: string,
): AgentCategoryChild | null {
  const entries = directoryEntries(directory);
  const slug = requested.trim().toLowerCase();
  const bySlug = entries.find((entry) => entry.slug.toLowerCase() === slug);
  if (bySlug) return bySlug;

  const wanted = normalizeSearchText(requested);
  if (!wanted) return null;
  const wantedWords = wordsOf(wanted).filter(
    (word) => word.length >= 2 || word === wanted,
  );

  const tier = (entry: AgentCategoryChild): number => {
    const name = normalizeSearchText(entry.name);
    const nameWords = wordsOf(name);
    if (name === wanted) return 3;
    if (name.startsWith(wanted)) return 2;
    if (
      wantedWords.length > 0 &&
      wantedWords.every((word) =>
        nameWords.some((nameWord) => wordMatches(nameWord, wordForms(word))),
      )
    ) {
      return 1;
    }
    return 0;
  };

  let best: { entry: AgentCategoryChild; tier: number } | null = null;
  for (const entry of entries) {
    const rank = tier(entry);
    if (rank === 0) continue;
    if (
      !best ||
      rank > best.tier ||
      (rank === best.tier && entry.products > best.entry.products)
    ) {
      best = { entry, tier: rank };
    }
  }
  return best?.entry ?? null;
}

// ---------------------------------------------------------------------------
// Store context
// ---------------------------------------------------------------------------

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

type ShippingRateLike = {
  name?: string;
  price?: number;
  freeOver?: number;
  minDays?: number;
  maxDays?: number;
  active?: boolean;
};

type ShippingZoneLike = {
  name?: string;
  countries?: string[];
  rates?: ShippingRateLike[];
  isFallback?: boolean;
};

export type StoreContextInput = {
  store: {
    name: string;
    currency: string;
    email?: string;
    phone?: string;
    address?: string;
    supportHours?: string;
  };
  /** Methods checkout actually offers: switched on AND with credentials. */
  enabledPaymentMethods: PaymentMethodId[];
  cashOnDelivery?: {
    instructions?: string;
    minOrderAmount?: number;
    maxOrderAmount?: number;
  } | null;
  shipping?: {
    enabled?: boolean;
    delivery?: {
      processingDaysMin?: number;
      processingDaysMax?: number;
    } | null;
    zones?: ShippingZoneLike[] | null;
    fallbackRate?: {
      enabled?: boolean;
      name?: string;
      price?: number;
      minDays?: number;
      maxDays?: number;
    } | null;
    vendorShipping?: { enabled?: boolean } | null;
  } | null;
  contentPages: ContentPagesSettings;
};

/**
 * A merchant's copy as a customer would read it: `{storeName}` and
 * `{returnWindow}` filled the way the page views fill them. Without this the
 * agent quotes the raw placeholder back at the customer.
 */
function readable(
  value: unknown,
  vars: ContentPlaceholders,
  max = 240,
): string {
  return plainText(
    typeof value === "string" ? fillContentPlaceholders(value, vars) : value,
    max,
  );
}

export type AgentShippingRate = {
  name: string;
  price: number;
  /** Order subtotal from which this rate is free. */
  freeOver?: number;
  /** "2-5", or "3" when both ends agree. */
  deliveryDays?: string;
};

export type AgentShippingZone = {
  name: string;
  countries: string[];
  rates: AgentShippingRate[];
};

export type AgentStoreContext = {
  store: StoreContextInput["store"];
  payments: {
    /** Labels as checkout shows them. Empty means checkout has no method. */
    methods: string[];
    cashOnDelivery?: {
      instructions?: string;
      minOrderAmount?: number;
      maxOrderAmount?: number;
    };
  };
  shipping: {
    enabled: boolean;
    /** Days before dispatch, e.g. "1-2". */
    processingDays?: string;
    /** The lowest threshold any rate offers free shipping from. */
    freeShippingOver?: number;
    zones: AgentShippingZone[];
    /** Priced when no zone matches the address. */
    restOfWorld?: AgentShippingRate;
    /** In a marketplace, some sellers charge their own rates. */
    sellersMaySetOwnRates?: true;
  };
  policies: {
    returns?: { window?: string; summary: string[]; path: string };
    /** Pages the customer can be pointed to, locale-less paths. */
    pages: { title: string; path: string }[];
  };
};

const MAX_ZONES = 8;
const MAX_RATES_PER_ZONE = 4;
const MAX_COUNTRIES_PER_ZONE = 6;
const MAX_RETURN_SUMMARY_ITEMS = 6;

function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function dayRange(min?: number, max?: number): string | undefined {
  const lo = isMoney(min) ? Math.round(min) : undefined;
  const hi = isMoney(max) ? Math.round(max) : undefined;
  if (lo === undefined && hi === undefined) return undefined;
  if (lo === undefined) return String(hi);
  if (hi === undefined || hi === lo) return String(lo);
  return `${lo}-${hi}`;
}

function summarizeRate(rate: ShippingRateLike): AgentShippingRate | null {
  if (rate.active === false || !isMoney(rate.price)) return null;
  const summary: AgentShippingRate = {
    name: rate.name?.trim() || "Shipping",
    price: rate.price,
  };
  if (isMoney(rate.freeOver) && rate.freeOver > 0) summary.freeOver = rate.freeOver;
  const days = dayRange(rate.minDays, rate.maxDays);
  if (days) summary.deliveryDays = days;
  return summary;
}

function summarizeZone(zone: ShippingZoneLike): AgentShippingZone | null {
  const rates = (zone.rates || [])
    .map(summarizeRate)
    .filter((rate): rate is AgentShippingRate => rate !== null)
    .slice(0, MAX_RATES_PER_ZONE);
  if (rates.length === 0) return null;
  const countries = (zone.countries || []).filter(Boolean);
  const shown = countries.slice(0, MAX_COUNTRIES_PER_ZONE);
  if (countries.length > shown.length) {
    shown.push(`and ${countries.length - shown.length} more`);
  }
  return { name: zone.name?.trim() || "Zone", countries: shown, rates };
}

const POLICY_PAGE_PATHS: Array<{
  key: "faq" | "returns" | "terms" | "privacy" | "contact" | "cookies" | "accessibility";
  path: string;
}> = [
  { key: "faq", path: "/faq" },
  { key: "returns", path: "/returns" },
  { key: "terms", path: "/terms" },
  { key: "privacy", path: "/privacy" },
  { key: "contact", path: "/contact" },
  { key: "cookies", path: "/cookies" },
  { key: "accessibility", path: "/accessibility" },
];

/**
 * The store as the customer will meet it at checkout and after — built from
 * the merchant's configuration, never from the model's assumptions. Bounded
 * everywhere: a store with forty zones is summarised, not dumped.
 */
export function buildAgentStoreContext(input: StoreContextInput): AgentStoreContext {
  const enabled = new Set<string>(input.enabledPaymentMethods);
  const methods = PAYMENT_METHODS.filter((method) => enabled.has(method.id)).map(
    (method) => method.label,
  );
  const payments: AgentStoreContext["payments"] = { methods };
  if (enabled.has("cod") && input.cashOnDelivery) {
    const cod: NonNullable<AgentStoreContext["payments"]["cashOnDelivery"]> = {};
    const instructions = input.cashOnDelivery.instructions?.trim();
    if (instructions) cod.instructions = plainText(instructions, 300);
    if (isMoney(input.cashOnDelivery.minOrderAmount) && input.cashOnDelivery.minOrderAmount > 0) {
      cod.minOrderAmount = input.cashOnDelivery.minOrderAmount;
    }
    if (isMoney(input.cashOnDelivery.maxOrderAmount) && input.cashOnDelivery.maxOrderAmount > 0) {
      cod.maxOrderAmount = input.cashOnDelivery.maxOrderAmount;
    }
    if (Object.keys(cod).length > 0) payments.cashOnDelivery = cod;
  }

  const shippingInput = input.shipping;
  const shipping: AgentStoreContext["shipping"] = {
    enabled: Boolean(shippingInput?.enabled),
    zones: [],
  };
  if (shippingInput?.enabled) {
    const processing = dayRange(
      shippingInput.delivery?.processingDaysMin,
      shippingInput.delivery?.processingDaysMax,
    );
    if (processing) shipping.processingDays = processing;

    const zones = shippingInput.zones || [];
    const fallbackZone = zones.find((zone) => zone.isFallback);
    shipping.zones = zones
      .filter((zone) => !zone.isFallback)
      .map(summarizeZone)
      .filter((zone): zone is AgentShippingZone => zone !== null)
      .slice(0, MAX_ZONES);

    const restOfWorld = fallbackZone
      ? summarizeZone(fallbackZone)?.rates[0]
      : shippingInput.fallbackRate?.enabled
        ? summarizeRate(shippingInput.fallbackRate) ?? undefined
        : undefined;
    if (restOfWorld) shipping.restOfWorld = restOfWorld;

    const thresholds = [
      ...shipping.zones.flatMap((zone) => zone.rates),
      ...(restOfWorld ? [restOfWorld] : []),
    ]
      .map((rate) => rate.freeOver)
      .filter((value): value is number => typeof value === "number");
    if (thresholds.length > 0) shipping.freeShippingOver = Math.min(...thresholds);

    if (shippingInput.vendorShipping?.enabled) shipping.sellersMaySetOwnRates = true;
  }

  const pages = input.contentPages;
  const vars: ContentPlaceholders = {
    storeName: input.store.name,
    returnWindow: pages.returns?.returnWindowValue || "",
  };
  const policies: AgentStoreContext["policies"] = { pages: [] };
  if (pages.returns?.visible) {
    const window = [pages.returns.returnWindowLabel, pages.returns.returnWindowValue]
      .map((value) => readable(value, vars, 120))
      .filter(Boolean)
      .join(": ");
    policies.returns = {
      ...(window ? { window } : {}),
      summary: (pages.returns.summaryItems || [])
        .map((item) => readable(item.text, vars, 200))
        .filter(Boolean)
        .slice(0, MAX_RETURN_SUMMARY_ITEMS),
      path: "/returns",
    };
  }
  for (const { key, path } of POLICY_PAGE_PATHS) {
    const page = pages[key];
    if (!page?.visible) continue;
    policies.pages.push({ title: readable(page.title, vars, 80) || key, path });
  }
  for (const page of pages.customPages || []) {
    if (!page.visible || !page.handle) continue;
    policies.pages.push({
      title: readable(page.title, vars, 80) || page.handle,
      path: `/pages/${page.handle}`,
    });
  }

  return { store: input.store, payments, shipping, policies };
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

export type KnowledgeChunk = {
  /** Where the customer would read it: "FAQ", "Returns policy", a page title. */
  source: string;
  title: string;
  text: string;
  /** Locale-less path of the page, when there is one. */
  path?: string;
  /** Ranking multiplier: a merchant's hand-written answer outranks a paragraph. */
  weight: number;
  /** Extra words that count for matching but are not shown. */
  keywords?: string;
};

const MAX_PAGE_CHUNKS = 40;
const MAX_CHUNK_LENGTH = 600;
const MIN_CHUNK_LENGTH = 20;

/**
 * A page's HTML as readable paragraphs, each carrying the heading it sits
 * under.
 *
 * The heading is a title, not a chunk of its own: "Warranty" alone answers
 * nothing, but it is exactly the word a customer types, and as the title of
 * the paragraph beneath it the ranking finds that paragraph — which does
 * answer. A paragraph too short to be an answer is dropped.
 */
function htmlParagraphs(
  html: string,
  vars: ContentPlaceholders,
): Array<{ title?: string; text: string }> {
  const headings = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  const sections: Array<{ title?: string; body: string }> = [];
  let cursor = 0;
  let title: string | undefined;
  let heading: RegExpExecArray | null;
  while ((heading = headings.exec(html)) !== null) {
    sections.push({ title, body: html.slice(cursor, heading.index) });
    title = readable(heading[1], vars, 120) || undefined;
    cursor = headings.lastIndex;
  }
  sections.push({ title, body: html.slice(cursor) });

  return sections
    .flatMap((section) =>
      section.body
        .split(/<\/(?:p|li|div|blockquote|tr|td)>|<br\s*\/?>|\n{2,}/i)
        .map((part) => readable(part, vars, MAX_CHUNK_LENGTH))
        .filter((part) => part.length >= MIN_CHUNK_LENGTH)
        .map((text) => ({ title: section.title, text })),
    )
    .slice(0, MAX_PAGE_CHUNKS);
}

/** The agent's own FAQ, as configured in Admin → AI Sales Agent. */
export function agentFaqChunks(
  faq: ReadonlyArray<{ question?: string; answer?: string; tags?: string[] }>,
): KnowledgeChunk[] {
  return faq
    .filter((entry) => entry.question?.trim() && entry.answer?.trim())
    .map((entry) => ({
      source: "Store FAQ",
      title: plainText(entry.question, 200),
      text: plainText(entry.answer, MAX_CHUNK_LENGTH),
      weight: 1.5,
      keywords: (entry.tags || []).join(" "),
    }));
}

/**
 * The merchant's pages as rankable chunks. Hidden pages are skipped — what
 * the customer cannot read, the agent must not quote.
 *
 * `storeName` fills the `{storeName}` and `{returnWindow}` placeholders the
 * default copy is written with, exactly as the page views do; the agent's
 * own FAQ above needs none, being typed as prose in the admin.
 */
export function buildKnowledgeChunks(
  pages: ContentPagesSettings,
  storeName = "",
): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const vars: ContentPlaceholders = {
    storeName,
    returnWindow: pages.returns?.returnWindowValue || "",
  };

  if (pages.faq?.visible) {
    for (const item of pages.faq.items || []) {
      const title = readable(item.question, vars, 200);
      const text = readable(item.answer, vars, MAX_CHUNK_LENGTH);
      if (!title || !text) continue;
      chunks.push({ source: "FAQ page", title, text, path: "/faq", weight: 1.2 });
    }
  }

  const returns = pages.returns;
  if (returns?.visible) {
    const add = (title: string, text: string) => {
      const cleanTitle = readable(title, vars, 120);
      const cleanText = readable(text, vars, MAX_CHUNK_LENGTH);
      if (!cleanText) return;
      chunks.push({
        source: "Returns policy",
        title: cleanTitle || "Returns",
        text: cleanText,
        path: "/returns",
        weight: 1,
      });
    };
    add(returns.returnWindowLabel || "Return window", returns.returnWindowValue || "");
    add(returns.title || "Returns", returns.description || "");
    add(
      returns.title || "Returns",
      (returns.summaryItems || []).map((item) => item.text).join(". "),
    );
    for (const step of returns.steps || []) add(step.title, step.description);
    add(
      returns.eligibleTitle || "Eligible for return",
      (returns.eligibleItems || []).map((item) => item.text).join(". "),
    );
    add(
      returns.excludedTitle || "Not eligible for return",
      (returns.excludedItems || []).map((item) => item.text).join(". "),
    );
    add(returns.refundRulesTitle || "Refunds", returns.refundRulesDescription || "");
    for (const rule of returns.refundRules || []) add(rule.title, rule.description);
    for (const status of returns.statuses || []) add(status.label, status.description);
    add(returns.beforeReturnTitle || "Before you return", returns.beforeReturnDescription || "");
  }

  if (pages.contact?.visible) {
    const hours = readable(pages.contact.supportHours, vars, 200);
    if (hours) {
      chunks.push({
        source: "Contact",
        title: readable(pages.contact.hoursTitle, vars, 80) || "Support hours",
        text: hours,
        path: "/contact",
        weight: 1,
      });
    }
  }

  const textPages: Array<{
    key: "terms" | "privacy" | "cookies" | "accessibility";
    path: string;
  }> = [
    { key: "terms", path: "/terms" },
    { key: "privacy", path: "/privacy" },
    { key: "cookies", path: "/cookies" },
    { key: "accessibility", path: "/accessibility" },
  ];
  for (const { key, path } of textPages) {
    const page = pages[key];
    if (!page?.visible) continue;
    const source = readable(page.title, vars, 80) || key;
    for (const paragraph of htmlParagraphs(page.content || "", vars)) {
      chunks.push({
        source,
        title: paragraph.title || source,
        text: paragraph.text,
        path,
        weight: 0.8,
      });
    }
  }

  for (const page of pages.customPages || []) {
    if (!page.visible || !page.handle) continue;
    const source = readable(page.title, vars, 80) || page.handle;
    for (const paragraph of htmlParagraphs(page.content || "", vars)) {
      chunks.push({
        source,
        title: paragraph.title || source,
        text: paragraph.text,
        path: `/pages/${page.handle}`,
        weight: 0.9,
      });
    }
  }

  return chunks;
}

/**
 * The chunks that answer a question, best first. A query word counts when
 * it begins a word of the chunk, plural or singular; a hit in the title
 * counts double; the chunk's weight scales the total. Nothing matching is
 * an empty list, never a random paragraph the model would then quote.
 */
export function rankKnowledge(
  chunks: KnowledgeChunk[],
  query: string,
  limit = 3,
): KnowledgeChunk[] {
  const tokens = productSearchTokens(query);
  if (tokens.length === 0) return [];

  const hits = (words: string[], forms: string[]) =>
    words.some((word) => wordMatches(word, forms));

  return chunks
    .map((chunk) => {
      const titleWords = wordsOf(chunk.title);
      const bodyWords = wordsOf(`${chunk.text} ${chunk.keywords ?? ""}`);
      let score = 0;
      for (const token of tokens) {
        const forms = wordForms(token);
        if (hits(titleWords, forms)) score += 2;
        else if (hits(bodyWords, forms)) score += 1;
      }
      return { chunk, score: score * chunk.weight };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.chunk.weight - a.chunk.weight)
    .slice(0, limit)
    .map((entry) => entry.chunk);
}
