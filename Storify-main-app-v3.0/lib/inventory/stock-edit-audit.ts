import "server-only";
import { audit, type AuditContext } from "@/lib/audit";
import { Product } from "@/models";
import { InventoryLocation } from "@/models/inventory-location.model";

/**
 * The Activity Log's record of a manual stock edit, written for the admin and
 * vendor inventory screens and the business app's adjustments alike
 * (./stock-adjust.ts) so all three leave the same row.
 *
 * `applyStockChangeAtomic` swaps the figure it read for the new one and says
 * only whether that worked, never what it replaced. So the figure is read
 * here, just before the edit, and the row is written once the edit has gone
 * through. A sale landing between this read and the guarded write's own moves
 * the recorded "before" by what it sold; the request's own figure is kept in
 * the row's metadata, so what the editor asked for is never in doubt.
 *
 * Nothing here may fail an edit: the stock is already changed by the time a row
 * is written, so a read that fails costs the row, not the response.
 */

type StockTarget = {
  productId: string;
  variantId?: string;
  /** Absent when the edit is to the store-wide total rather than one location. */
  locationId?: string;
};

/** A stock figure as it stood just before an edit. */
export type StockBeforeEdit = {
  /** `Blue mug`, or `Blue mug - Large` when the edit is to one variant. */
  name: string;
  quantity: number;
};

/** An edit `applyStockChangeAtomic` accepted. */
export type AppliedStockEdit = StockTarget & {
  /** Null when the figure could not be read, which leaves nothing to compare. */
  before: StockBeforeEdit | null;
  /** The request's figure: a signed change when `adjustment`, else the target. */
  quantity: number;
  adjustment: boolean;
  /** Why the units were counted in or out (`received`, `damaged`…), when the editor said. */
  reason?: string;
  /** The editor's own words about it. */
  note?: string;
};

type LocationQuantities = Array<{ locationId?: unknown; quantity?: number }>;

type StockDocument = {
  name?: string;
  title?: string;
  stock?: number;
  locationInventory?: LocationQuantities;
  variants?: Array<{
    name?: string;
    stock?: number;
    locationInventory?: LocationQuantities;
  }>;
};

/** A product with no options has one variant, which carries this placeholder name. */
const DEFAULT_VARIANT_NAME = "Default Title";

/**
 * The figure an edit is about to replace, read the way `applyStockChangeAtomic`
 * reads it: one location's quantity, or the variant's or product's total.
 */
export async function readStockBeforeEdit(
  target: StockTarget,
  scopeFilter: Record<string, unknown> = {},
): Promise<StockBeforeEdit | null> {
  try {
    const doc = await Product.findOne(
      { _id: target.productId, ...scopeFilter },
      target.variantId
        ? { name: 1, title: 1, variants: { $elemMatch: { _id: target.variantId } } }
        : { name: 1, title: 1, stock: 1, locationInventory: 1 },
    ).lean<StockDocument | null>();
    if (!doc) return null;

    const variant = target.variantId ? doc.variants?.[0] : undefined;
    if (target.variantId && !variant) return null;

    const holder = variant ?? doc;
    const quantity = target.locationId
      ? Number(
          holder.locationInventory?.find(
            (entry) => String(entry.locationId) === target.locationId,
          )?.quantity || 0,
        )
      : Number(holder.stock || 0);

    const productName = doc.title || doc.name || "Product";
    const variantName =
      variant?.name && variant.name !== DEFAULT_VARIANT_NAME ? variant.name : "";
    return {
      name: variantName ? `${productName} - ${variantName}` : productName,
      quantity,
    };
  } catch (error) {
    console.error("[Audit] Failed to read stock before an edit:", error);
    return null;
  }
}

async function locationNamesOf(ids: Array<string | undefined>) {
  const wanted = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const names = new Map<string, string>();
  if (wanted.length === 0) return names;
  try {
    const rows = await InventoryLocation.find({ _id: { $in: wanted } })
      .select("name")
      .lean<Array<{ _id: unknown; name?: string }>>();
    for (const row of rows) {
      if (row.name) names.set(String(row._id), row.name);
    }
  } catch (error) {
    console.error("[Audit] Failed to read location names for a stock edit:", error);
  }
  return names;
}

/**
 * One row per edit that actually moved a figure. An edit that left the quantity
 * where it was (an adjustment of zero, a target already held, a reduction of
 * stock that was already at nothing) writes none.
 *
 * The "after" is worked out the way the guarded write works it out, floor at
 * zero included, from the figure read before the edit.
 */
export async function auditStockEdits(
  context: AuditContext,
  edits: AppliedStockEdit[],
): Promise<void> {
  const moved = edits.flatMap((edit) => {
    if (!edit.before) return [];
    const from = edit.before.quantity;
    const to = Math.max(0, edit.adjustment ? from + edit.quantity : edit.quantity);
    if (!Number.isFinite(to) || to === from) return [];
    return [{ edit, name: edit.before.name, from, to }];
  });
  if (moved.length === 0) return;

  const locationNames = await locationNamesOf(moved.map(({ edit }) => edit.locationId));

  await Promise.all(
    moved.map(({ edit, name, from, to }) => {
      const delta = Number((to - from).toFixed(6));
      const locationName = edit.locationId ? locationNames.get(edit.locationId) : undefined;
      const at = edit.locationId ? ` at ${locationName ?? `location ${edit.locationId}`}` : "";
      const subject = edit.locationId ? "Stock" : "Total stock";
      const why = [edit.reason, edit.note ? `"${edit.note}"` : ""].filter(Boolean).join(": ");
      const change = `${delta > 0 ? "+" : ""}${delta}${why ? `, ${why}` : ""}`;
      return audit(context, {
        action: "UPDATE",
        resource: "inventory",
        resourceId: edit.productId,
        resourceName: name,
        changes: {
          before: { quantity: from },
          after: { quantity: to },
          fields: ["quantity"],
          // A vendor reads the summary and the changed fields and nothing of
          // the metadata, so the product, the variant and the shelf are named
          // here rather than left to it.
          summary: `${subject} of ${name}${at} changed from ${from} to ${to} (${change}) — product ${edit.productId}${
            edit.variantId ? `, variant ${edit.variantId}` : ""
          }`,
        },
        metadata: {
          productId: edit.productId,
          ...(edit.variantId ? { variantId: edit.variantId } : {}),
          ...(edit.locationId ? { locationId: edit.locationId } : {}),
          ...(locationName ? { locationName } : {}),
          adjustment: edit.adjustment,
          requested: edit.quantity,
          ...(edit.reason ? { reason: edit.reason } : {}),
          ...(edit.note ? { note: edit.note } : {}),
        },
      });
    }),
  );
}
