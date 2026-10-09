import "server-only";

import type { AuditContext } from "@/lib/audit";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { applyStockChangeAtomic } from "@/lib/inventory/inventory";
import { markForMetaCatalog } from "@/lib/meta-catalog/mark-later";
import {
  auditStockEdits,
  readStockBeforeEdit,
  type AppliedStockEdit,
} from "@/lib/inventory/stock-edit-audit";

/**
 * A manual stock edit, from the website's inventory screens (the vendor and
 * admin inventory PATCH) and the business app's stock adjustment alike: the
 * location checked against the caller's reach, the guarded write, then one
 * Activity Log row per figure that moved and the storefront's cache.
 *
 * An edit either sets a figure (`adjustment: false`, `quantity` is the new
 * count) or moves it (`adjustment: true`, `quantity` is the signed change), at
 * one location or, without one, on the product's or variant's total. Stock
 * never goes below zero. No low-stock alert is sent from here, as none is for
 * an edit on the website: alerts follow sales (lib/inventory/inventory.ts).
 */

/** Where a caller may edit stock. */
export interface StockEditScope {
  /** The locations they may write to (`allowedLocationIds` of their location scope). */
  locationIds: ReadonlySet<string>;
  /** A staff member's own location assignment, refused with its own message; empty when none. */
  staffLocationIds?: readonly string[];
  /** Pins every product to their reach: `{ vendorId }`, a staff member's product scope. */
  productFilter: Record<string, unknown>;
}

export interface StockEdit {
  receipt?: { key: string; hash: string };
  productId: string;
  variantId?: string;
  locationId?: string;
  /** The signed change when `adjustment`, else the figure to set. */
  quantity: number;
  adjustment: boolean;
  /** Why, for the Activity Log (the business app's adjustments). */
  reason?: string;
  note?: string;
}

/**
 * Why an edit did not go through:
 * - `LOCATION_NOT_ALLOWED`: not a location of the caller's store;
 * - `LOCATION_OUT_OF_SCOPE`: the store's, but not one the staff member is assigned to;
 * - `NOT_APPLIED`: the guarded write refused it (no such product or variant in
 *   reach, a quantity that is not a number, stock that kept moving) or failed.
 */
export type StockEditRefusal = "LOCATION_NOT_ALLOWED" | "LOCATION_OUT_OF_SCOPE" | "NOT_APPLIED";

export type StockEditOutcome =
  | { success: true; applied: AppliedStockEdit; replayed?: boolean }
  | { success: false; refusal: StockEditRefusal; error: string };

/** One edit: the location's reach, the figure it replaces, the guarded write. Nothing is logged yet. */
export async function applyStockEdit(edit: StockEdit, scope: StockEditScope): Promise<StockEditOutcome> {
  const { locationId } = edit;
  // `locationId` is a bare string with no ownership of its own: unchecked, a
  // crafted request could write a quantity into another merchant's warehouse.
  if (locationId && !scope.locationIds.has(locationId)) {
    return { success: false, refusal: "LOCATION_NOT_ALLOWED", error: "Location does not belong to this store" };
  }
  if (locationId && scope.staffLocationIds?.length && !scope.staffLocationIds.includes(locationId)) {
    return {
      success: false,
      refusal: "LOCATION_OUT_OF_SCOPE",
      error: "Location is outside this staff member's assigned scope",
    };
  }

  try {
    const target = { productId: edit.productId, variantId: edit.variantId, locationId };
    // What the edit replaces, read first: the guarded write says whether it
    // worked, not what it overwrote.
    const before = await readStockBeforeEdit(target, scope.productFilter);
    // A compare-and-swap update, never a document save(): a save would
    // clobber a sale landing in between (its $inc overwritten by a stale $set).
    const outcome = await applyStockChangeAtomic({
      ...target,
      quantity: edit.quantity,
      adjustment: edit.adjustment,
      scopeFilter: scope.productFilter,
      receipt: edit.receipt,
    });
    if (!outcome.success) {
      return { success: false, refusal: "NOT_APPLIED", error: outcome.error ?? "Unknown error" };
    }
    return {
      success: true,
      ...(outcome.replayed ? { replayed: true } : {}),
      applied: {
        ...target,
        before,
        quantity: edit.quantity,
        adjustment: edit.adjustment,
        ...(edit.reason ? { reason: edit.reason } : {}),
        ...(edit.note ? { note: edit.note } : {}),
      },
    };
  } catch (err) {
    return {
      success: false,
      refusal: "NOT_APPLIED",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * After the edits of one request: the Activity Log's rows, and the
 * storefront's cached products once when any went through
 * (`applyStockChangeAtomic`, unlike the order paths, does not expire them:
 * left alone, a sold-out badge would stay stale for the cache's window).
 */
export async function finishStockEdits(audit: AuditContext, applied: AppliedStockEdit[]): Promise<void> {
  await auditStockEdits(audit, applied);
  if (applied.length > 0) {
    revalidateProductContent();
    await markForMetaCatalog(applied.map((edit) => edit.productId));
  }
}

/** One row of the website's bulk edit, as its inventory screens send it. */
export interface StockEditRequest {
  productId?: string;
  variantId?: string;
  locationId?: string;
  quantity?: number | string;
  adjustment?: boolean;
}

export interface StockEditResult {
  success: boolean;
  productId: string;
  variantId?: string;
  error?: string;
}

/** The website's bulk edit: each row in turn, then the log and the cache once. */
export async function applyStockEdits(
  updates: StockEditRequest[],
  scope: StockEditScope,
  audit: AuditContext,
): Promise<{ results: StockEditResult[]; summary: { total: number; success: number; failed: number } }> {
  const results: StockEditResult[] = [];
  const applied: AppliedStockEdit[] = [];

  for (const update of updates) {
    const { productId, variantId, quantity, locationId, adjustment } = update;
    if (!productId) {
      results.push({ success: false, productId: "", error: "productId is required" });
      continue;
    }
    const outcome = await applyStockEdit(
      {
        productId: String(productId),
        variantId: variantId ? String(variantId) : undefined,
        locationId: locationId ? String(locationId) : undefined,
        quantity: Number(quantity),
        adjustment: Boolean(adjustment),
      },
      scope,
    );
    if (outcome.success) applied.push(outcome.applied);
    results.push({
      success: outcome.success,
      productId,
      variantId,
      ...(outcome.success ? {} : { error: outcome.error }),
    });
  }

  await finishStockEdits(audit, applied);

  const success = results.filter((result) => result.success).length;
  return { results, summary: { total: results.length, success, failed: results.length - success } };
}
