import "server-only";

import { Product } from "@/models";
import {
  buildOrderItemCustomsSnapshot,
  type ProductShippingData,
  type VariantShippingData,
} from "@/lib/catalog/product-shipping";
import { isShippableLine } from "@/lib/shipping/packing";

/**
 * Which order lines a courier actually carries, and what they weigh.
 *
 * The customs snapshot on a line is proof it is physical — checkout writes one
 * for every line that requires shipping. Its ABSENCE proves nothing: a bank
 * transfer, a manual payment, a till sale and every order older than the
 * snapshot all carry none, physical goods included. Reading "no snapshot" as
 * "digital" refused a courier to exactly those orders, kept them out of
 * automatic shipping, weighed their parcels at the minimum and sent them
 * abroad with no customs lines.
 *
 * So a line without one is given the snapshot checkout WOULD have written,
 * built from its product now (`buildOrderItemCustomsSnapshot`, the same call).
 * Everything downstream keeps asking the snapshot — packing, customs, the
 * carrier's item list, the automation predicate — and gets the right answer.
 * A product that no longer exists is taken as physical with no known weight:
 * refusing a real parcel is the worse mistake.
 */

type LineProduct = {
  _id: unknown;
  shipping?: ProductShippingData;
  variants?: Array<VariantShippingData & { _id?: unknown }>;
};

type Customs = NonNullable<ReturnType<typeof buildOrderItemCustomsSnapshot>>;

type Line = {
  productId?: unknown;
  variantId?: unknown;
  customs?: Customs;
};

/** Stands in for a line whose product is gone: physical, weight unknown. */
const UNKNOWN_PHYSICAL: Customs = { weight: 0, weightUnit: "kg" };

/**
 * The snapshot a line should be read with, given its product; undefined means
 * it is not shipped. Pure and exported for tests: this is the decision that
 * either spends money on an empty box or refuses a real one.
 */
export function effectiveCustoms(
  line: Line,
  product: LineProduct | null | undefined,
): Customs | undefined {
  if (isShippableLine(line)) return line.customs;
  if (!product) return UNKNOWN_PHYSICAL;
  const variant = line.variantId
    ? product.variants?.find(
        (candidate) => String(candidate?._id) === String(line.variantId),
      )
    : undefined;
  return buildOrderItemCustomsSnapshot({
    productShipping: product.shipping,
    variantShipping: variant,
  });
}

export function lineIsPhysical(
  line: Line,
  product: LineProduct | null | undefined,
): boolean {
  return effectiveCustoms(line, product) !== undefined;
}

/**
 * The lines with their effective snapshots filled in, looking up only the
 * products it must. Lines that already carry one come back untouched.
 */
export async function withEffectiveCustoms<T extends Line>(
  lines: T[],
): Promise<T[]> {
  const unknownIds = Array.from(
    new Set(
      lines
        .filter((line) => !isShippableLine(line) && line.productId)
        .map((line) => String(line.productId)),
    ),
  );
  if (unknownIds.length === 0 && lines.every(isShippableLine)) return lines;

  const products = unknownIds.length
    ? await Product.find({ _id: { $in: unknownIds } })
        .select(
          "shipping variants._id variants.requiresShipping variants.weight variants.weightUnit",
        )
        .lean<LineProduct[]>()
    : [];
  const byId = new Map(products.map((product) => [String(product._id), product]));

  return lines.map((line) => {
    if (isShippableLine(line)) return line;
    const customs = effectiveCustoms(
      line,
      line.productId ? byId.get(String(line.productId)) : null,
    );
    return customs ? { ...line, customs } : line;
  });
}

/** Physical flags for many lines. */
export async function physicalLineFlags(lines: Line[]): Promise<boolean[]> {
  return (await withEffectiveCustoms(lines)).map(isShippableLine);
}

/**
 * Whether a consignment has anything a courier would carry.
 *
 * `digitalOnly` is checkout's own verdict on the whole order, so it settles
 * the question without a lookup.
 */
export async function consignmentHasPhysicalItems(
  order: { digitalOnly?: boolean },
  items: Line[] | undefined,
): Promise<boolean> {
  if (order.digitalOnly === true) return false;
  if (!items?.length) return false;
  return (await physicalLineFlags(items)).some(Boolean);
}
