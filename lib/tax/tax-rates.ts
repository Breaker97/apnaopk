import "server-only";

import { unstable_cache } from "next/cache";
import { Types } from "mongoose";
import { Category, Product } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { connectDB } from "@/lib/db";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import type { TaxLine } from "@/lib/tax/tax-engine";
import {
  STANDARD_TAX_CLASS,
  classComponentsAt,
  classRatesAt,
  isUntaxedClass,
  type StoredTaxSettings,
  type TaxRateComponent,
} from "@/lib/tax/tax-settings";

/**
 * Which rate each product is taxed at.
 *
 * A product with "Charge tax" switched off is tax-free. Otherwise its own
 * custom rate wins, then its tax class; without either, its category's custom
 * rate or class, then the nearest parent category's; without any, the store's
 * rate — the standard class's in Settings → Tax. 0 anywhere on that path, or
 * the zero-rated or exempt class, sells the product tax-free.
 *
 * A class is charged at its rate in the store's region now
 * (lib/tax/tax-settings.ts). The standard class, or a class with no rate
 * there, is the store's rate: null here, as before classes existed.
 *
 * Custom rates are kept in percent on products and categories (what a person
 * types) and handed out here as fractions, like `settings.orders.taxRate`.
 */

const MAX_CATEGORY_DEPTH = 5;

/** Percent as stored → fraction; null for "not set". */
export function storedRateToFraction(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const percent = Number(value);
  if (!Number.isFinite(percent)) return null;
  return Math.min(100, Math.max(0, percent)) / 100;
}

const asId = (value: unknown) => {
  const id = String((value as { _id?: unknown } | null)?._id ?? value ?? "");
  return Types.ObjectId.isValid(id) ? id : null;
};

type CategoryTaxNode = {
  id: string;
  rate: number | null;
  /** The category's tax class, when it sets one rather than a rate. */
  taxClass?: string | null;
  parent: string | null;
};

/** Each class's rate (fraction) now, in the store's region. */
export type TaxClassRates = ReadonlyMap<string, number>;

/**
 * Every category's rate or class, and the class rates of the moment, so one
 * read answers any product of the basket.
 */
export type CategoryTaxTree = Map<string, CategoryTaxNode> & {
  classRates?: TaxClassRates;
  /** The parts (state, county) a product is charged at now (lib/tax/tax-parts.ts). */
  partsOf?: (product: TaxedProduct) => TaxRateComponent[];
};

/** Without Settings → Tax read, only the untaxed classes are known. */
const UNTAXED_ONLY: TaxClassRates = classRatesAt(null, 0);

/**
 * A tax class's rate: undefined when none is set (look further), null for the
 * store's rate (the standard class, or one with no rate in the region).
 */
function classRate(key: unknown, rates: TaxClassRates | undefined): number | null | undefined {
  if (typeof key !== "string" || !key) return undefined;
  if (key === STANDARD_TAX_CLASS) return null;
  return (rates ?? UNTAXED_ONLY).get(key) ?? null;
}

/**
 * Every category's rate and parent, cached on the categories tag (a category
 * save expires it). A store has hundreds of categories at most, and the cart
 * and checkout read this on every request, so it is one cached read rather
 * than a walk up the tree per basket.
 */
const readCategoryTaxRows = unstable_cache(
  async (): Promise<CategoryTaxNode[]> => {
    await connectDB();
    const rows = await Category.find({})
      .select("taxRate taxClass parentId")
      .lean<Array<{ _id: unknown; taxRate?: number | null; taxClass?: string | null; parentId?: unknown }>>();
    return rows.map((row) => ({
      id: String(row._id),
      rate: storedRateToFraction(row.taxRate),
      taxClass: typeof row.taxClass === "string" && row.taxClass ? row.taxClass : null,
      parent: asId(row.parentId),
    }));
  },
  ["category-tax-rates-v2"],
  { tags: [CACHE_TAGS.categories], revalidate: 3600 },
);

/**
 * The category tree with the class rates in effect now — or at `at`, for a
 * sale that was made earlier than it is being recorded. The rates are read
 * from settings on every call, outside the cache, so a scheduled rate starts
 * on its date rather than when the cached tree next expires.
 */
export async function loadCategoryTaxTree(at: number = Date.now()): Promise<CategoryTaxTree> {
  const [rows, settings] = await Promise.all([readCategoryTaxRows(), getSettingsLean()]);
  const tax = settings?.tax as StoredTaxSettings;
  const storeRate = Math.max(0, Number(settings?.orders?.taxRate) || 0);
  const tree: CategoryTaxTree = Object.assign(new Map(rows.map((node) => [node.id, node])), {
    classRates: classRatesAt(tax, at),
  });
  tree.partsOf = (product) => productTaxParts(product, tree, tax, storeRate, at);
  return tree;
}

const percentOf = (fraction: number) => Math.round(fraction * 100 * 10_000) / 10_000;

/**
 * The parts a product is charged at: its class's (a state and a county rate, say), the
 * standard class's for the store's rate, one part for a custom rate — named
 * as the standard rate is when that is a single named part — and none when it
 * is not charged.
 */
function productTaxParts(
  product: TaxedProduct,
  tree: CategoryTaxTree,
  tax: StoredTaxSettings,
  storeRate: number,
  at: number,
): TaxRateComponent[] {
  const standard = classComponentsAt(tax, STANDARD_TAX_CLASS, at);
  const storeParts = standard.length ? standard : [{ name: "", rate: percentOf(storeRate) }];
  const source = productTaxSource(product, tree);
  if (source.kind === "untaxed") return [];
  if (source.kind === "custom") {
    return [{ name: standard.length === 1 ? standard[0].name : "", rate: percentOf(source.rate) }];
  }
  if (source.kind === "class") {
    if (isUntaxedClass(source.key)) return [];
    const parts = classComponentsAt(tax, source.key, at);
    return parts.length ? parts : storeParts;
  }
  return storeParts;
}

/** A product's own rate (fraction): its own, else its categories'; null for the store's. */
export function productTaxRate(
  product: TaxedProduct,
  tree: CategoryTaxTree,
): number | null {
  const source = productTaxSource(product, tree);
  if (source.kind === "untaxed") return 0;
  if (source.kind === "custom") return source.rate;
  if (source.kind === "store") return null;
  return classRate(source.key, tree.classRates) ?? null;
}

type TaxedProduct = {
  taxRate?: number | null;
  taxClass?: string | null;
  category?: unknown;
  chargeTax?: boolean | null;
};

/**
 * Where a product's tax comes from: not charged, a custom rate (fraction), a
 * class other than the standard one, or the store's rate. What the rate
 * resolves to is `productTaxRate`; which parts it is made of (state, county) is the
 * class's (lib/tax/tax-parts.ts).
 */
export type ProductTaxSource =
  | { kind: "untaxed" }
  | { kind: "custom"; rate: number }
  | { kind: "class"; key: string }
  | { kind: "store" };

export function productTaxSource(product: TaxedProduct, tree: CategoryTaxTree): ProductTaxSource {
  if (product.chargeTax === false) return { kind: "untaxed" };
  const own = storedRateToFraction(product.taxRate);
  if (own !== null) return { kind: "custom", rate: own };
  const ownClass = classSource(product.taxClass);
  if (ownClass) return ownClass;
  let id = asId(product.category);
  for (let depth = 0; id && depth < MAX_CATEGORY_DEPTH; depth += 1) {
    const node = tree.get(id);
    if (!node) break;
    if (node.rate !== null) return { kind: "custom", rate: node.rate };
    const nodeClass = classSource(node.taxClass);
    if (nodeClass) return nodeClass;
    id = node.parent;
  }
  return { kind: "store" };
}

function classSource(key: unknown): ProductTaxSource | undefined {
  if (typeof key !== "string" || !key) return undefined;
  return key === STANDARD_TAX_CLASS ? { kind: "store" } : { kind: "class", key };
}

/**
 * Each product's own rate (fraction), or null where it takes the store's —
 * and, alongside, the parts each is charged at and the store rate's parts.
 */
export type ProductTaxRates = Map<string, number | null> & {
  parts?: Map<string, TaxRateComponent[]>;
  storeParts?: TaxRateComponent[];
};

/** Each product's own rate (fraction), or null where it takes the store's. */
export async function resolveProductTaxRates(productIds: Iterable<unknown>): Promise<ProductTaxRates> {
  const ids = [...new Set([...productIds].map(asId).filter((id): id is string => Boolean(id)))];
  const result: ProductTaxRates = new Map<string, number | null>();
  if (!ids.length) return result;
  const [products, tree] = await Promise.all([
    Product.find({ _id: { $in: ids } })
      .select("taxRate taxClass category chargeTax")
      .lean<
        Array<{ _id: unknown; taxRate?: number | null; taxClass?: string | null; category?: unknown; chargeTax?: boolean }>
      >(),
    loadCategoryTaxTree(),
  ]);
  for (const product of products) result.set(String(product._id), productTaxRate(product, tree));
  if (tree.partsOf) {
    result.parts = new Map(products.map((product) => [String(product._id), tree.partsOf!(product)]));
    result.storeParts = tree.partsOf({});
  }
  return result;
}

/**
 * A basket's lines with their rates — or null when every line is taxed at the
 * store's one rate, so that path stays exactly what it always was.
 */
export async function basketTaxLines(params: {
  items: Array<{ productId: unknown; amount: number; discount?: number }>;
  /** `settings.orders.taxRate`, a fraction. */
  storeRate: number;
  /** Rates already resolved by the caller, by product id. */
  rates?: Map<string, number | null>;
}): Promise<TaxLine[] | null> {
  if (!params.items.length) return null;
  const rates = params.rates ?? (await resolveProductTaxRates(params.items.map((item) => item.productId)));
  const own = params.items.map((item) => rates.get(String(asId(item.productId))) ?? null);
  if (own.every((rate) => rate === null)) return null;
  return params.items.map((item, index) => ({
    amount: item.amount,
    rate: own[index] ?? Math.max(0, Number(params.storeRate) || 0),
    ...(typeof item.discount === "number" ? { discount: item.discount } : {}),
  }));
}
