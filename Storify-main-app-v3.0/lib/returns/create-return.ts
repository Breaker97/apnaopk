import "server-only";

import { Types } from "mongoose";
import { Order, ReturnRequest } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { RETURN_REFUND_STATUS, RETURN_STATUS } from "@/lib/returns/returns";
import { getNextReturnNumber } from "@/lib/returns/return-number";
import {
  assertReturnEligible,
  nonReturnableItemIndexes,
  nonReturnableItemIndexesOf,
  openReturnQuantitiesByIndex,
  openReturnQuantitiesByOrder,
  planReturnRequest,
  refundedQuantitiesByIndex,
  refundedQuantitiesByOrder,
  returnWindowClosedItemIndexes,
} from "@/lib/returns/return-plan";
import {
  refundSettlesOutOfBand,
  validateRefundDestination,
  type RefundDestinationInput,
} from "@/lib/returns/refund-settlement";
import { resolveReturnDestination } from "@/lib/returns/return-destination";
import {
  customReturnInstructions,
  isReturnLabelUrl,
  isReturnMethod,
  type ReturnMethod,
} from "@/lib/returns/return-shipping";
import { isSubOrderPaid } from "@/lib/orders/order-payment-status";
import {
  notifyReturnOpenedOnBehalf,
  notifyReturnRequestCustomer,
  notifyReturnRequestSubmitted,
} from "@/lib/notifications/notifications";
import type { ISettings } from "@/models/settings.model";

/**
 * Opening a return, whoever opens it.
 *
 * The shopper opens one from their account; the store or a seller opens one
 * on the shopper's behalf, for a return asked for by phone, email or chat —
 * which until now could not be recorded as a return at all, so the store
 * refunded without one and lost the count of what came back, the restock and
 * the seller's payout hold with it. Every path runs this, so the store's
 * return and the shopper's are priced and checked the same way.
 *
 * A return the store or a seller opens is approved at once, with how the
 * parcel comes back: Shopify's merchant-created returns open the same way,
 * because the merchant creating one has already decided to take it back.
 */

type ReturnOpener = "customer" | "staff" | "vendor";

/** The lean order a return is opened on. */
type ReturnOrder = Parameters<typeof planReturnRequest>[0]["order"] & {
  _id: unknown;
  orderNumber?: string;
  customerId?: unknown;
  guestEmail?: string | null;
};

type PlanSettings = Parameters<typeof planReturnRequest>[0]["settings"];

export async function createReturnRequests(params: {
  order: ReturnOrder;
  items: Array<{ orderItemIndex: number; quantity: number }>;
  reason: string;
  customerNote?: string;
  refundDestination?: RefundDestinationInput;
  settings: ISettings;
  userId: string;
  openedBy: ReturnOpener;
  /** How the parcel comes back — for a return the store or a seller opens. */
  approval?: { method: string; labelUrl?: string };
  /** A seller opening one: only their own goods. */
  onlyVendorId?: string;
  /** The store opening one the rules refuse (past the window, final sale), and why. */
  eligibilityOverride?: { note: string };
}) {
  const { order, settings } = params;
  const planSettings = settings as unknown as PlanSettings;
  // Past the window or on a final-sale line: only with a reason given.
  const override = Boolean(params.eligibilityOverride);

  assertReturnEligible(order, planSettings, { override });

  if (params.approval) {
    if (!isReturnMethod(params.approval.method)) {
      throw new ValidationError("Choose how the parcel comes back");
    }
    // A label file can only be added to a return that exists, so opening one
    // with a label needs its link; the file can be added afterwards.
    if (
      params.approval.method === "label" &&
      !isReturnLabelUrl(params.approval.labelUrl)
    ) {
      throw new ValidationError(
        "Give the label's link, or open the return and add the label file to it afterwards.",
      );
    }
  }

  // Serialise return creation per order: the returnable-quantity check the
  // planner makes is read-then-create, so two concurrent submissions — the
  // shopper's and the store's included — could both pass it and together
  // exceed the ordered quantity. The claim self-expires after 15s in case a
  // request crashes before releasing it.
  const lockStaleBefore = new Date(Date.now() - 15_000);
  const returnLock = await Order.findOneAndUpdate(
    {
      _id: order._id,
      $or: [
        { returnRequestLockAt: null },
        { returnRequestLockAt: { $exists: false } },
        { returnRequestLockAt: { $lt: lockStaleBefore } },
      ],
    },
    { $set: { returnRequestLockAt: new Date() } },
  )
    .select("_id")
    .lean();
  if (!returnLock) {
    throw new ValidationError(
      "Another return for this order is being opened. Please try again in a moment.",
    );
  }
  const releaseReturnLock = () =>
    Order.updateOne(
      { _id: order._id },
      { $unset: { returnRequestLockAt: "" } },
    ).catch((err) => console.error("Failed to release return lock:", err));

  const created: Array<Record<string, unknown>> = [];
  try {
    // "Other" is the reason that says nothing, so it has to be written down:
    // the note is what anyone deciding whose failure it was reads.
    if (params.reason === "other" && !String(params.customerNote || "").trim()) {
      throw new ValidationError(
        "Tell us what went wrong, so we can sort the right refund out",
      );
    }

    const plan = await planReturnRequest({
      order,
      items: params.items,
      reason: params.reason,
      settings: planSettings,
      override,
    });

    if (params.onlyVendorId) {
      const foreign = plan.groups.some(
        (group) =>
          group.ownerType !== "vendor" ||
          String(group.ownerVendorId || "") !== params.onlyVendorId,
      );
      if (foreign) {
        throw new ValidationError("Only your own items can be returned from here");
      }
    }

    // A refund no gateway can carry needs somewhere to go. The shopper is
    // asked at submission; the store or a seller opening one may not have the
    // details to hand, and records the payment when it goes.
    const destinationGiven = Boolean(params.refundDestination?.method);
    if (plan.settlesOutOfBand && (params.openedBy === "customer" || destinationGiven)) {
      const problems = validateRefundDestination(params.refundDestination);
      if (problems.length > 0) throw new ValidationError(problems.join(". "));
    }
    const refundDestination =
      plan.settlesOutOfBand && destinationGiven
        ? { ...params.refundDestination, providedAt: new Date() }
        : undefined;

    const now = new Date();
    const approval = params.approval;
    const guestEmail = String(order.guestEmail || "").trim().toLowerCase() || undefined;

    for (const group of plan.groups) {
      const owner = {
        orderId: order._id,
        ownerType: group.ownerType,
        ownerVendorId: group.ownerVendorId,
        vendorIds: group.vendorIds,
      };
      const method = approval?.method as ReturnMethod | undefined;
      const shipping =
        method && method !== "no_shipping"
          ? {
              returnTo: await resolveReturnDestination(owner, settings),
              returnInstructions: customReturnInstructions(settings) ?? null,
            }
          : method === "no_shipping"
            ? { returnTo: null, returnInstructions: null }
            : {};

      const returnRequest = await ReturnRequest.create({
        returnNumber: await getNextReturnNumber(),
        orderId: order._id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        guestEmail,
        ownerType: group.ownerType,
        ownerVendorId: group.ownerVendorId
          ? new Types.ObjectId(group.ownerVendorId)
          : undefined,
        vendorIds: group.vendorIds.map((id) => new Types.ObjectId(id)),
        status: approval ? RETURN_STATUS.APPROVED : RETURN_STATUS.REQUESTED,
        refundStatus: RETURN_REFUND_STATUS.PENDING,
        reason: params.reason,
        customerNote: params.customerNote,
        requestedAt: now,
        ...(approval ? { approvedAt: now, returnMethod: method } : {}),
        ...shipping,
        ...(method === "label" && approval?.labelUrl
          ? {
              shipment: {
                labelUrl: approval.labelUrl.trim(),
                labelAddedAt: now,
              },
            }
          : {}),
        openedBy: params.openedBy,
        ...(params.eligibilityOverride
          ? {
              eligibilityOverride: {
                note: params.eligibilityOverride.note,
                by: params.userId,
                at: now,
              },
            }
          : {}),
        createdBy: params.userId,
        items: group.items,
        estimatedRefund: group.estimatedRefund,
        // The fees and delivery rule it was quoted under, so approving it
        // later does not charge a fee the store added in between.
        policyApplied: group.policyApplied,
        // Whose cash this parcel's refund comes out of — see
        // `resolveRefundPayer`.
        refundPayer: group.refundPayer,
        refundDestination,
      });
      created.push(returnRequest.toObject());
    }
  } finally {
    await releaseReturnLock();
  }

  const jobs: Promise<unknown>[] = [];
  for (const returnRequest of created) {
    if (params.openedBy === "customer") {
      jobs.push(notifyReturnRequestSubmitted(returnRequest, settings));
      continue;
    }
    jobs.push(
      notifyReturnRequestCustomer(
        returnRequest,
        String(returnRequest.status),
        settings,
        { openedForShopper: true },
      ),
      notifyReturnOpenedOnBehalf(returnRequest, settings, params.openedBy),
    );
  }
  await Promise.allSettled(jobs);

  return created;
}

/** Why a line cannot be returned, as the store's dialog shows it. */
type ReturnLineBlock =
  | "not_yours"
  | "digital"
  | "cancelled"
  | "not_delivered"
  | "unpaid";

type ReturnableItem = {
  productId?: unknown;
  variantId?: unknown;
  vendorId?: unknown;
  name?: string;
  image?: string;
  price?: number;
  quantity?: number;
  finalSale?: boolean | null;
};

/** What `describeReturnableLines` reads from the database about one order. */
export interface ReturnableLineFacts {
  /** Units of each line out on an open return. */
  claimed: Map<number, { quantity: number; returnNumber: string }>;
  /** Units of each line already refunded. */
  refunded: Map<number, number>;
  /** The lines that are digital goods. */
  digital: number[];
}

/**
 * The facts `describeReturnableLines` needs of several orders, in three
 * queries whatever their number: a list of orders says which can be returned
 * without asking once per order. By order id.
 */
export async function loadReturnableLineFacts(
  orders: ReadonlyArray<Pick<ReturnOrder, "_id" | "items">>,
): Promise<Map<string, ReturnableLineFacts>> {
  const ids = orders.map((order) => order._id);
  const [claimed, refunded, digital] = await Promise.all([
    openReturnQuantitiesByOrder(ids),
    refundedQuantitiesByOrder(ids),
    nonReturnableItemIndexesOf(orders.map((order) => (order.items || []) as ReturnableItem[])),
  ]);
  return new Map(
    orders.map((order, index) => {
      const id = String(order._id);
      return [
        id,
        {
          claimed: claimed.get(id) ?? new Map(),
          refunded: refunded.get(id) ?? new Map(),
          digital: digital[index] ?? [],
        },
      ];
    }),
  );
}

async function loadOwnFacts(order: ReturnOrder, items: ReturnableItem[]): Promise<ReturnableLineFacts> {
  const [claimed, refunded, digital] = await Promise.all([
    openReturnQuantitiesByIndex(order._id),
    refundedQuantitiesByIndex(order._id),
    nonReturnableItemIndexes(items),
  ]);
  return { claimed, refunded, digital };
}

/**
 * Each line of an order and how much of it may still be returned, for the
 * dialog the store or a seller opens a return from. The same counts the
 * planner will check, so the dialog does not offer what it will refuse.
 */
export async function describeReturnableLines(
  order: ReturnOrder,
  settings: ISettings,
  options: {
    onlyVendorId?: string;
    /** What the database says of this order, read for a whole list at once (`loadReturnableLineFacts`). */
    facts?: ReturnableLineFacts;
  } = {},
) {
  const items = (order.items || []) as ReturnableItem[];
  const facts: ReturnableLineFacts = options.facts ?? (await loadOwnFacts(order, items));
  const { claimed, refunded, digital } = facts;
  const windowClosed = new Set(
    returnWindowClosedItemIndexes(order, settings as unknown as PlanSettings),
  );
  const subOrders = order.subOrders || [];
  const split = subOrders.length > 1;

  return items.map((item, index) => {
    const vendorId = String(item.vendorId || "");
    const sub = split
      ? subOrders.find((candidate) => String(candidate?.vendorId || "") === vendorId)
      : undefined;
    let blockedBy: ReturnLineBlock | null = null;
    if (options.onlyVendorId && vendorId !== options.onlyVendorId) {
      blockedBy = "not_yours";
    } else if (digital.includes(index)) {
      blockedBy = "digital";
    } else if (split && sub?.status === "cancelled") {
      blockedBy = "cancelled";
    } else if (split && sub?.status !== "delivered") {
      blockedBy = "not_delivered";
    } else if (split && sub && !isSubOrderPaid(order, sub)) {
      blockedBy = "unpaid";
    }
    const ordered = Math.max(0, Number(item.quantity || 0));
    const returnable = Math.max(
      0,
      ordered - (claimed.get(index)?.quantity || 0) - (refunded.get(index) || 0),
    );
    return {
      orderItemIndex: index,
      name: String(item.name || `Item ${index + 1}`),
      image: item.image,
      price: Number(item.price || 0),
      vendorId,
      ordered,
      returnable,
      blockedBy,
      windowClosed: windowClosed.has(index),
      // Like a closed window, something the store may set aside with a reason.
      finalSale: item.finalSale === true,
    };
  });
}

/**
 * What the "Open a return" dialog needs about an order: each line and how much
 * of it may come back, whether the order can be returned at all, and whether
 * its refund has to be sent by hand.
 */
export async function returnDialogContext(
  order: ReturnOrder & { paymentMethod?: string | null; channel?: string | null },
  settings: ISettings,
  options: { onlyVendorId?: string } = {},
) {
  let problem: string | null = null;
  try {
    // Checked with the window set aside: a line past it is still shown, and
    // the store may open it with a reason.
    assertReturnEligible(order, settings as unknown as PlanSettings, {
      override: true,
    });
  } catch (error) {
    problem = error instanceof Error ? error.message : "This order cannot be returned";
  }
  return {
    problem,
    lines: await describeReturnableLines(order, settings, options),
    settlesOutOfBand: refundSettlesOutOfBand(
      order as Parameters<typeof refundSettlesOutOfBand>[0],
    ),
    currency: String((order as { currency?: string }).currency || settings.general?.defaultCurrency || "USD"),
  };
}

/** A selection priced as it would be opened, with nothing written. */
export async function previewReturn(params: {
  order: ReturnOrder;
  items: Array<{ orderItemIndex: number; quantity: number }>;
  reason: string;
  settings: ISettings;
  onlyVendorId?: string;
  /** Past the window or on a final-sale line — see `createReturnRequests`. */
  override?: boolean;
}) {
  const planSettings = params.settings as unknown as PlanSettings;
  assertReturnEligible(params.order, planSettings, {
    override: params.override,
  });
  const plan = await planReturnRequest({
    order: params.order,
    items: params.items,
    reason: params.reason,
    settings: planSettings,
    override: params.override,
  });
  if (
    params.onlyVendorId &&
    plan.groups.some(
      (group) =>
        group.ownerType !== "vendor" ||
        String(group.ownerVendorId || "") !== params.onlyVendorId,
    )
  ) {
    throw new ValidationError("Only your own items can be returned from here");
  }
  return {
    currency: plan.currency,
    total: plan.total,
    settlesOutOfBand: plan.settlesOutOfBand,
    groups: plan.groups.map((group) => ({
      ownerType: group.ownerType,
      items: group.items.map((item) => ({
        name: item.name,
        quantityRequested: item.quantityRequested,
      })),
      estimatedRefund: group.estimatedRefund,
    })),
  };
}
