/**
 * What the variant on an order line was when it was sold, frozen onto the line.
 *
 * An order line kept the product's name and SKU and nothing else about the
 * variant: online checkout wrote the product name alone, and the other
 * channels folded "Product - Variant" into `name`. A printed invoice or
 * courier sticker that wants a Colour column, a Size column, the variant's
 * own SKU or the struck-through price had nowhere to read them from but the
 * product as it stands today — which can have been renamed, re-priced or
 * deleted since (docs/INVOICE_TEMPLATE_BUILDER.md, D-04). So they are copied
 * at the sale, as `cost` and the customs snapshot already are.
 *
 * Every field is optional and only written when there is something to say.
 * Orders placed before this existed have none of them and print without them.
 *
 * Plain function, no model import: every order-creation path calls it with
 * the product it has already read.
 */
import {
  resolveVariantOptions,
  type CartVariantOption,
} from "@/lib/cart/variant-options";

export type OrderLineVariantSnapshot = {
  /** The variant as one label, "White / M". Absent for the placeholder variant. */
  variantLabel?: string;
  /** Each option with its name, `[{ name: "Color", value: "White" }]`. */
  variantOptions?: CartVariantOption[];
  /** The variant's own SKU, when it has one. */
  variantSku?: string;
  /** The catalogue's "was" price, only when it was above the unit price. */
  compareAtPrice?: number;
  /** Set when `compareAtPrice` was taken net of tax (`netOfTaxVariantSnapshot`). */
  compareAtPriceNet?: true;
};

/** The variant fields the snapshot reads, for a product read to select. */
export type OrderLineVariantSource = NonNullable<Parameters<typeof resolveVariantOptions>[0]> & {
  _id?: unknown;
  sku?: string | null;
  price?: number | null;
  comparePrice?: number | null;
};

/** The product fields the snapshot reads: `price comparePrice options variants`. */
export type OrderLineProductSource = {
  price?: number | null;
  comparePrice?: number | null;
  options?: Parameters<typeof resolveVariantOptions>[1];
  variants?: ReadonlyArray<OrderLineVariantSource | null | undefined> | null;
};

/** Mirrors the single-variant placeholder `resolveVariantOptions` never shows. */
const PLACEHOLDER_VARIANT_NAME = "default title";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finitePrice(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A compare-at price worth keeping: the storefront strikes one through only
 * when it is above the price, so that is the only case the shopper saw one.
 */
function compareAtPriceOf(
  comparePrice: unknown,
  catalogPrice: number | undefined,
): number | undefined {
  const compare = finitePrice(comparePrice);
  if (compare === undefined || compare <= 0) return undefined;
  if (catalogPrice !== undefined && compare <= catalogPrice) return undefined;
  return compare;
}

/**
 * The snapshot for one line: the product as the creating path read it, and
 * the line's variant id. A product with variants takes the compare-at price
 * from the variant alone — the product's own figure is the highest of its
 * variants', not this one's.
 */
export function orderLineVariantSnapshot(
  product: OrderLineProductSource | null | undefined,
  variantId?: unknown,
): OrderLineVariantSnapshot {
  if (!product) return {};

  const id = variantId ? String(variantId) : "";
  const variant = id
    ? product.variants?.find((candidate) => candidate && String(candidate._id) === id)
    : undefined;

  if (!variant) {
    if (id || (product.variants?.length ?? 0) > 0) return {};
    const compareAtPrice = compareAtPriceOf(product.comparePrice, finitePrice(product.price));
    return compareAtPrice === undefined ? {} : { compareAtPrice };
  }

  const snapshot: OrderLineVariantSnapshot = {};
  const options = resolveVariantOptions(variant, product.options);
  const name = clean(variant.name);
  const label =
    name && name.toLowerCase() !== PLACEHOLDER_VARIANT_NAME
      ? name
      : options.map((option) => option.value).join(" / ");
  if (label) snapshot.variantLabel = label;
  if (options.length > 0) snapshot.variantOptions = options;
  const sku = clean(variant.sku);
  if (sku) snapshot.variantSku = sku;
  const compareAtPrice = compareAtPriceOf(
    variant.comparePrice,
    finitePrice(variant.price) ?? finitePrice(product.price),
  );
  if (compareAtPrice !== undefined) snapshot.compareAtPrice = compareAtPrice;
  return snapshot;
}

/**
 * The snapshot for a line whose price is stored net of tax — a POS sale at
 * tax-inclusive shelf prices (`posStoredSale`): the compare-at price comes off
 * by the same rate (a fraction, 0.15) and rounding, so the "was" price and the
 * price say the same thing. Otherwise a shelf 1150 incl. 15 % with a "was"
 * 1380 stored `price: 1000, compareAtPrice: 1380`, a saving of 380 instead of
 * 230 (200 net). The line is marked `compareAtPriceNet`, so a print can tell
 * it from one stored before this, which keeps its gross figure.
 */
export function netOfTaxVariantSnapshot(
  snapshot: OrderLineVariantSnapshot,
  rate: number,
): OrderLineVariantSnapshot {
  if (snapshot.compareAtPrice === undefined || !(rate > 0)) return snapshot;
  const net = Math.round((snapshot.compareAtPrice / (1 + rate)) * 1e6) / 1e6;
  return { ...snapshot, compareAtPrice: net, compareAtPriceNet: true };
}
