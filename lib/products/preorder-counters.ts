import { Product } from "@/models";

/**
 * Keep a product save from rewriting its pre-order reservation counters.
 *
 * `preorder.reservedQuantity` (and each variant's) is a live counter that only
 * the atomic `$inc`s in `lib/orders/preorders.ts` may move. A save `$set`s the
 * whole `preorder` object and the whole `variants` array, and it used to carry
 * the counter the editor loaded: a form opened at 40 reserved, left open while
 * shoppers reserved ten more, wrote 40 back and sold those ten places twice. A
 * payload could also simply send 0 and reset the limit.
 *
 * So the request's figure is never used. The stored counters are read just
 * before the write and copied into the update, and the returned `updatedAt`
 * pins the write to that read — a reservation landing in between bumps it, the
 * write misses, and the caller reads again. A variant the store does not know
 * yet starts at zero.
 *
 * Returns null when the update touches neither pre-order settings nor variants.
 */
export async function carryPreorderCounters(params: {
  filter: Record<string, unknown>;
  updateSet: Record<string, unknown>;
}): Promise<{ updatedAt: Date } | null> {
  const { filter, updateSet } = params;
  const touchesProduct = isObject(updateSet.preorder);
  const variants = Array.isArray(updateSet.variants)
    ? (updateSet.variants as Array<Record<string, unknown>>)
    : [];
  const touchesVariants = variants.some((variant) => isObject(variant?.preorder));
  if (!touchesProduct && !touchesVariants) return null;

  const current = await Product.findOne(filter)
    .select(
      "updatedAt preorder.reservedQuantity variants._id variants.name variants.preorder.reservedQuantity",
    )
    .lean<{
      updatedAt?: Date;
      preorder?: { reservedQuantity?: number | null } | null;
      variants?: Array<{
        _id?: unknown;
        name?: string;
        preorder?: { reservedQuantity?: number | null } | null;
      }>;
    } | null>();

  if (touchesProduct) {
    (updateSet.preorder as Record<string, unknown>).reservedQuantity = counter(
      current?.preorder?.reservedQuantity,
    );
  }

  if (touchesVariants) {
    const stored = current?.variants || [];
    const byId = new Map(stored.map((variant) => [String(variant._id), variant]));
    for (const variant of variants) {
      if (!isObject(variant?.preorder)) continue;
      // By id, the way the rest of the save matches variants; by name only
      // for a payload that lost its ids, never both.
      const match = variant._id
        ? byId.get(String(variant._id))
        : stored.find(
            (candidate) =>
              typeof variant.name === "string" && candidate.name === variant.name,
          );
      (variant.preorder as Record<string, unknown>).reservedQuantity = counter(
        match?.preorder?.reservedQuantity,
      );
    }
  }

  return current?.updatedAt ? { updatedAt: current.updatedAt } : null;
}

function counter(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
