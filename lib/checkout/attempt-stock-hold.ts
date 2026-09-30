import "server-only";

import { CheckoutAttempt, CHECKOUT_ATTEMPT_STATUS } from "@/models";
import {
  decrementInventory,
  restoreInventory,
  InsufficientStockError,
  type InventoryAdjustmentOptions,
} from "@/lib/inventory/inventory";

/**
 * Holding the goods for as long as a shopper is at the gateway, and not a
 * minute longer.
 *
 * Shopify's rule, and the reason this is the last thing built rather than the
 * first: **a cart reserves nothing**. The items are yours when the checkout
 * completes — but for the few minutes between "pay" and the gateway's answer,
 * they are held, because the alternative is the one failure a redirect gateway
 * cannot undo gracefully. Two shoppers press pay on the last unit, both pay,
 * and the second is refunded after their money has moved, with an apology.
 *
 * Why the hold is short and the attempt is long: an attempt stays worth
 * returning to for a day (`ATTEMPT_WINDOW_MS`), because a shopper who comes
 * back tomorrow should land on the same gateway session. Holding stock for a
 * day would be a shop whose shelves are emptied by people who never paid. So
 * the hold has its own, much shorter clock, and when it runs out the goods go
 * back while the attempt stays open. A shopper who pays afterwards is settled
 * exactly as an untracked checkout is today: the capture path takes the stock,
 * and if it has gone, `settleCapturedOrder` drops those sellers and refunds
 * them — the old behaviour, unchanged, now only the uncommon case.
 *
 * Nothing here runs for a gateway that is not on the attempt path, which today
 * is every gateway: the hold arrives with the attempt, and both are switched on
 * per gateway (`settings.payment.attemptGateways`).
 */

/** How long the goods are held while the shopper is at the gateway. */
const DEFAULT_STOCK_HOLD_MINUTES = 15;

type StockHoldLine = {
  productId: string;
  variantId?: string;
  quantity: number;
};

type HoldableLine = {
  productId: { _id?: unknown } | unknown;
  variantId?: unknown;
  quantity: number;
  purchaseType?: string;
};

function lineProductId(line: HoldableLine): string {
  const product = line.productId as { _id?: unknown } | null;
  return String(
    product && typeof product === "object" && "_id" in product
      ? product._id
      : line.productId,
  );
}

/** The standard lines of a checkout — a pre-order holds quota, not stock. */
function holdableLines(items: HoldableLine[]): StockHoldLine[] {
  return items
    .filter((item) => (item.purchaseType || "standard") === "standard")
    .map((item) => ({
      productId: lineProductId(item),
      variantId: item.variantId ? String(item.variantId) : undefined,
      quantity: Number(item.quantity || 0),
    }))
    .filter((line) => line.quantity > 0);
}

/**
 * Take the goods off the shelf for this attempt.
 *
 * Returns the product that ran out when there was not enough, having put back
 * whatever it had already taken (`decrementInventory` rolls its own partial
 * work back). The caller turns that into the shopper's error: this module has
 * no business deciding how a checkout refuses.
 *
 * The lines are written onto the attempt before nothing and after everything —
 * they are what a release reads back, so a hold the database does not know
 * about is stock nobody will ever return.
 */
export async function holdAttemptStock(params: {
  attemptId: unknown;
  items: HoldableLine[];
  minutes?: number;
  /** Pickup counter the shopper chose, when the order is collected. */
  inventoryOpts?: InventoryAdjustmentOptions;
}): Promise<{ soldOutProductId: string } | null> {
  const lines = holdableLines(params.items);
  if (lines.length === 0) return null;

  const minutes = Number(params.minutes ?? DEFAULT_STOCK_HOLD_MINUTES);
  if (!(minutes > 0)) return null;

  try {
    await decrementInventory(lines, params.inventoryOpts || {});
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return { soldOutProductId: String(error.line?.productId ?? "") };
    }
    throw error;
  }

  await CheckoutAttempt.updateOne(
    { _id: params.attemptId },
    {
      $set: {
        stockHold: {
          heldAt: new Date(),
          expiresAt: new Date(Date.now() + minutes * 60 * 1000),
          lines,
          locationId: params.inventoryOpts?.locationId,
        },
      },
    },
  ).catch(async (error) => {
    // The goods are off the shelf and nothing records it. Put them straight
    // back rather than leaving a hold that nothing can release.
    console.error("Failed to record a checkout stock hold; releasing it:", error);
    await restoreInventory(lines, params.inventoryOpts || {}).catch((err) =>
      console.error("Failed to release an unrecorded stock hold:", err),
    );
    throw error;
  });

  return null;
}

type HeldAttempt = {
  _id: unknown;
  stockHold?: {
    releasedAt?: Date | null;
    lines?: StockHoldLine[];
    locationId?: string;
  } | null;
};

/**
 * Put back what an attempt was holding.
 *
 * Claim-based: the release is stamped on the attempt first, conditional on it
 * not being stamped already, and only the caller that wins that write puts the
 * stock back. Two sweeps, or a sweep racing the shopper's own cancellation,
 * therefore restore it once — the bug this shape exists to prevent is a shop
 * whose stock climbs every time a job runs twice.
 */
export async function releaseAttemptStock(attemptId: unknown): Promise<boolean> {
  const claimed = (await CheckoutAttempt.findOneAndUpdate(
    {
      _id: attemptId,
      "stockHold.lines.0": { $exists: true },
      "stockHold.releasedAt": { $in: [null, undefined] },
    },
    { $set: { "stockHold.releasedAt": new Date() } },
    { returnDocument: "before" },
  )) as HeldAttempt | null;
  if (!claimed?.stockHold?.lines?.length) return false;

  // Copied out line by line rather than handed on whole: what comes back may
  // be a document with subdocuments, and the inventory writer takes plain
  // figures.
  const lines = claimed.stockHold.lines.map((line) => ({
    productId: String(line.productId),
    ...(line.variantId ? { variantId: String(line.variantId) } : {}),
    quantity: Number(line.quantity || 0),
  }));

  try {
    await restoreInventory(
      lines,
      claimed.stockHold.locationId
        ? { locationId: claimed.stockHold.locationId }
        : {},
    );
    return true;
  } catch (error) {
    // Stamped but not restored: say so loudly, because the shop is now short
    // of stock it actually has, and no later run will try again.
    console.error(
      `Failed to release the stock held by checkout attempt ${String(attemptId)}:`,
      error,
    );
    return false;
  }
}

/**
 * The hold became an order's stock: close it without putting anything back.
 *
 * Stamped exactly as a release is, and by the same claim, so a sweep that
 * arrives afterwards finds it already settled and restores nothing — which
 * would otherwise mean inventing units the order is about to ship.
 */
export async function markAttemptHoldTaken(
  attemptId: unknown,
): Promise<boolean> {
  const result = await CheckoutAttempt.updateOne(
    {
      _id: attemptId,
      "stockHold.lines.0": { $exists: true },
      "stockHold.releasedAt": { $in: [null, undefined] },
    },
    {
      $set: {
        "stockHold.releasedAt": new Date(),
        "stockHold.takenByOrder": true,
      },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Give back everything held past its window, leaving the attempts open.
 *
 * Run from the checkout-expiry cron. Deliberately separate from the attempt
 * sweep beside it: that one asks gateways whether an attempt is dead, which is
 * slow and rate-limited, while this is a local clock and must not wait behind
 * it. A shopper whose hold has lapsed can still pay — see the note at the top.
 */
export async function releaseExpiredStockHolds(params: {
  limit?: number;
  now?: Date;
} = {}): Promise<{ released: number }> {
  const now = params.now ?? new Date();
  const expired = await CheckoutAttempt.find({
    status: CHECKOUT_ATTEMPT_STATUS.OPEN,
    "stockHold.expiresAt": { $lte: now },
    "stockHold.releasedAt": { $in: [null, undefined] },
  })
    .select("_id")
    .limit(params.limit ?? 200)
    .lean<Array<{ _id: unknown }>>();

  let released = 0;
  for (const attempt of expired) {
    if (await releaseAttemptStock(attempt._id)) released += 1;
  }
  return { released };
}
