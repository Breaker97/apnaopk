import "server-only";

/**
 * Which branch a posted order leaves from.
 *
 * Pickup answers this by itself — the shopper picked a counter, and that is
 * where the goods must be. Delivery has no such signal, so the merchant
 * configures one: an ordered list of the places they dispatch from, tried in
 * turn. Shopify calls the same thing a fulfillment priority list.
 *
 * An ordered list rather than "nearest branch to the delivery address": nearest
 * needs every customer address geocoded, produces a different answer for two
 * orders that look identical to the merchant, and splits an order across
 * branches to satisfy an optimum nobody asked for. "Try the warehouse, then the
 * shop" is one drag-to-reorder control, and a merchant can predict it.
 *
 * **This module is the only place the rule lives.** Two things read it — the
 * stock decrement (`lib/inventory.ts`) and the stamp that records the answer on
 * the order (`lib/order-inventory.ts`) — and they run at different moments, so
 * a second copy of the rule is a guarantee that the ledger and the paperwork
 * eventually disagree about where an order shipped from.
 */

import { connectDB } from "@/lib/db";
import { InventoryLocation } from "@/models/inventory-location.model";
import {
  rankFulfillmentCandidates,
  type FulfillmentCandidate,
  type RankableLocation,
} from "@/lib/locations/dispatch-order";

// Re-exported so server callers have one import for "where does this dispatch
// from", while the ranking itself stays client-safe for the locations screen —
// which has to show the merchant the same sequence the checkout will use.
export type { FulfillmentCandidate } from "@/lib/locations/dispatch-order";

/**
 * The branches this vendor dispatches delivery orders from, in order.
 *
 * An empty answer is normal and must stay harmless — a store that never
 * configured a location has none of these, and its orders fall back to the
 * single-bucket stock they always used.
 */
export async function fulfillmentCandidatesForVendor(
  vendorId: string,
): Promise<FulfillmentCandidate[]> {
  if (!vendorId) return [];

  await connectDB();

  const rows = await InventoryLocation.find({
    vendorId,
    isActive: { $ne: false },
    // `$ne: false` rather than `true`: rows written before the field existed
    // have neither, and a store's whole catalogue must not stop dispatching
    // because a migration has not run yet.
    fulfillsOnlineOrders: { $ne: false },
  })
    .select("_id name isDefault fulfillmentPriority")
    .lean<RankableLocation[]>();

  return rankFulfillmentCandidates(rows);
}

/**
 * The single branch a vendor's delivery order should be recorded against.
 *
 * Deliberately **not** stock-aware. The decrement that runs moments earlier is
 * — it prefers this branch and falls back to the fullest one when this branch
 * cannot cover a line — but this answer has to be reproducible from
 * configuration alone, because it is computed again after the decrement has
 * already moved the numbers it would otherwise read. A rule that consulted
 * stock would return one branch before the sale and a different one after, and
 * the order would be stamped with a place the units did not leave.
 *
 * So the recorded branch is a statement of the merchant's dispatch policy. When
 * it and the ledger disagree, that is itself the useful signal: the first-choice
 * branch is short, and something needs transferring.
 */
export async function resolveFulfillmentLocation(
  vendorId: string,
): Promise<FulfillmentCandidate | null> {
  const candidates = await fulfillmentCandidatesForVendor(vendorId);
  return candidates[0] ?? null;
}
