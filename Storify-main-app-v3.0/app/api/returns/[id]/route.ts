/**
 * A shopper calling off their own return.
 *
 * Until now nobody could. A return sat on `requested` for ever if the shopper
 * changed their mind, and its units stayed spoken for the whole time — the
 * planner counts an open return against what is returnable, so the item could
 * not be returned again, by them or by anyone. The only way out was to ask the
 * shop to reject it.
 *
 * Deliberately narrow: only the shopper's own return, only before the store
 * has agreed to take the goods back, and never once money has moved. Anything
 * later is the shop's decision, because by then a parcel is in the post or a
 * refund is on its way.
 */

import * as z from "zod";
import { connectDB } from "@/lib/db";
import { ValidationError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { ReturnRequest } from "@/models";
import {
  NOTHING_REFUNDED_ON_RETURN,
  RETURN_REFUND_STATUS,
  RETURN_STATUS,
  returnStatusForTracking,
} from "@/lib/returns/returns";
import {
  RETURN_SHIPPING_OPEN_STATUSES,
  returnMethodOf,
} from "@/lib/returns/return-shipping";
import { getSettings } from "@/models/settings.model";
import {
  notifyReturnCancelledByShopper,
  notifyReturnRequestCustomer,
  notifyReturnShippedByShopper,
} from "@/lib/notifications/notifications";
import { toCustomerReturn } from "@/lib/returns/return-customer-view";
import { withApi } from "@/lib/api/handler";

/** The states a shopper may still walk away from. */
const CUSTOMER_CANCELLABLE_STATUSES: string[] = [
  RETURN_STATUS.REQUESTED,
  RETURN_STATUS.APPROVED,
  RETURN_STATUS.AWAITING_SHIPMENT,
];

export const DELETE = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "returns:cancel", preset: "moderate" },
  },
  async ({ params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Return request");

    await connectDB();

    const before = await ReturnRequest.findOne({
      _id: id,
      customerId: session.user.id,
    })
      .select("status returnNumber")
      .lean();
    if (!before) return notFoundResponse("Return request");

    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(String(before.status))) {
      throw new ValidationError(
        String(before.status) === RETURN_STATUS.CANCELLED
          ? "This return has already been cancelled"
          : "This return has gone too far to cancel. Contact the store if you no longer want to send the items back.",
      );
    }

    // The status is re-checked in the write, so a return the store approves —
    // or refunds — between the read above and here is not cancelled out from
    // under them. `NOTHING_REFUNDED_ON_RETURN` is the same guard the admin
    // route rejects under: cancelling releases the units, and releasing units
    // somebody has been paid for is how the same goods get refunded twice.
    const cancelled = await ReturnRequest.findOneAndUpdate(
      {
        _id: id,
        customerId: session.user.id,
        status: { $in: CUSTOMER_CANCELLABLE_STATUSES },
        ...NOTHING_REFUNDED_ON_RETURN,
      },
      {
        $set: {
          status: RETURN_STATUS.CANCELLED,
          refundStatus: RETURN_REFUND_STATUS.NOT_REQUIRED,
          closedAt: new Date(),
          updatedBy: session.user.id,
        },
      },
      { returnDocument: "after" },
    ).lean();

    if (!cancelled) {
      throw new ValidationError(
        "This return has moved on since you opened this page. Refresh to see where it is.",
      );
    }

    const settings = await getSettings();
    await notifyReturnRequestCustomer(
      cancelled,
      RETURN_STATUS.CANCELLED,
      settings,
    ).catch((err) =>
      console.error("Failed to create return cancellation notification:", err),
    );
    // And whoever was waiting on the parcel, who was never told.
    await notifyReturnCancelledByShopper(cancelled, settings);

    return successResponse(toCustomerReturn(cancelled), "Return request cancelled");
  },
);

/** What a shopper sends once they have posted their return. */
const ReturnTrackingSchema = z.object({
  carrier: z.string().trim().max(100).optional(),
  trackingNumber: z
    .string()
    .trim()
    .min(1, "Enter the tracking number")
    .max(100),
});

/**
 * A shopper saying they have posted the parcel, with its tracking number.
 *
 * Until now only the store could type one in, so it learnt the number when the
 * shopper wrote to say so. The return moves to "in transit" and whoever is
 * waiting on the parcel is told. Open while the parcel is still the shopper's
 * to send and nothing has been refunded; a return that needs nothing sent back
 * has no parcel to track.
 */
export const PATCH = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "returns:tracking", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Return request");
    const body = await validateBody(request, ReturnTrackingSchema);

    await connectDB();

    const before = await ReturnRequest.findOne({
      _id: id,
      customerId: session.user.id,
    })
      .select("status returnMethod")
      .lean<{ status?: string; returnMethod?: string } | null>();
    if (!before) return notFoundResponse("Return request");

    if (
      !(RETURN_SHIPPING_OPEN_STATUSES as readonly string[]).includes(
        String(before.status || ""),
      )
    ) {
      throw new ValidationError(
        String(before.status) === RETURN_STATUS.REQUESTED
          ? "The store has not approved this return yet. Wait for its instructions before sending anything."
          : "This return is past the point where a tracking number is needed.",
      );
    }
    if (returnMethodOf(before.returnMethod) === "no_shipping") {
      throw new ValidationError("This return needs nothing sent back.");
    }

    const now = new Date();
    // Re-checked in the write: a return the store moved on, or refunded,
    // between the read and here is left as it is.
    const updated = await ReturnRequest.findOneAndUpdate(
      {
        _id: id,
        customerId: session.user.id,
        status: { $in: RETURN_SHIPPING_OPEN_STATUSES },
        returnMethod: { $ne: "no_shipping" },
        ...NOTHING_REFUNDED_ON_RETURN,
      },
      {
        $set: {
          "shipment.carrier": body.carrier || "",
          "shipment.trackingNumber": body.trackingNumber,
          "shipment.trackingAddedBy": "customer",
          "shipment.trackingAddedAt": now,
          status: returnStatusForTracking(before.status) ?? before.status,
          updatedBy: session.user.id,
        },
        // The first time it was posted, kept through later corrections.
        $min: { "shipment.shippedAt": now },
      },
      { returnDocument: "after" },
    ).lean();

    if (!updated) {
      throw new ValidationError(
        "This return has moved on since you opened this page. Refresh to see where it is.",
      );
    }

    await notifyReturnShippedByShopper(updated, await getSettings());

    return successResponse(toCustomerReturn(updated), "Tracking number saved");
  },
);
