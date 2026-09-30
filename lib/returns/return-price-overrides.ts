import "server-only";

import { ValidationError } from "@/lib/api/errors";
import type { ReturnPriceOverrides } from "@/lib/returns/return-estimate";
import {
  priceReturnAsItStands,
  returnDeliveryCeiling,
} from "@/lib/returns/return-plan";

/**
 * The fees and delivery a store sets on a return by hand as it processes it
 * (R5a, R5d) — what it may set, and what a request leaves in place.
 *
 * A fee can only come down: the shopper saw the estimate before they asked,
 * and charging more than it said is a different return from the one they
 * agreed to. Delivery can be handed back in full, the part a policy keeps
 * back included — the carrier was paid, so it is the store's own money — but
 * never beyond what the parcel charged and no refund has returned.
 */

type FeeOverrideInput = {
  restockingFee?: number | null;
  returnShippingFee?: number | null;
};

type StoredOverrides = {
  feeOverride?: FeeOverrideInput | null;
  deliveryOverride?: { amount?: number | null } | null;
};

type OverrideRequest = {
  feeOverride?: FeeOverrideInput;
  deliveryRefund?: number | null;
};

const FEES = [
  ["restockingFee", "restocking fee"],
  ["returnShippingFee", "return shipping fee"],
] as const;

/** Whether a request changes what the store set by hand. */
export function changesReturnOverrides(body: OverrideRequest): boolean {
  return body.feeOverride !== undefined || body.deliveryRefund !== undefined;
}

/**
 * What a return is priced with once this request is in: what it had, changed
 * only where the request says. `null` puts a figure back to the policy's.
 */
export function mergeReturnOverrides(
  before: StoredOverrides,
  body: OverrideRequest,
): ReturnPriceOverrides {
  const fee = (key: (typeof FEES)[number][0]) => {
    const asked = body.feeOverride?.[key];
    const value = asked !== undefined ? asked : before.feeOverride?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const restockingFee = fee("restockingFee");
  const returnShippingFee = fee("returnShippingFee");
  const delivery =
    body.deliveryRefund !== undefined
      ? body.deliveryRefund
      : before.deliveryOverride?.amount;
  return {
    feeOverride:
      restockingFee === null && returnShippingFee === null
        ? null
        : { restockingFee, returnShippingFee },
    deliveryOverride:
      typeof delivery === "number" && Number.isFinite(delivery)
        ? { amount: delivery }
        : null,
  };
}

/**
 * Refuse a fee above what the policy charges on this return, or delivery
 * beyond what its parcel has left to hand back.
 */
export async function assertReturnOverrides(params: {
  /** The return as this request leaves it — counts and approvals included. */
  returnRequest: Parameters<typeof priceReturnAsItStands>[0]["returnRequest"] &
    Parameters<typeof returnDeliveryCeiling>[0]["returnRequest"];
  order: Parameters<typeof priceReturnAsItStands>[0]["order"];
  settings: Parameters<typeof priceReturnAsItStands>[0]["settings"];
  priorUnitsByIndex?: ReadonlyMap<number, number> | null;
  body: OverrideRequest;
  overrides: ReturnPriceOverrides;
}): Promise<void> {
  const { body } = params;
  if (body.feeOverride) {
    // The fees as the policy charges them, the store's own left out.
    const policy = priceReturnAsItStands({
      returnRequest: params.returnRequest,
      order: params.order,
      settings: params.settings,
      priorUnitsByIndex: params.priorUnitsByIndex,
      overrides: { deliveryOverride: params.overrides.deliveryOverride },
    });
    for (const [key, label] of FEES) {
      const asked = body.feeOverride[key];
      if (typeof asked === "number" && asked > Number(policy[key] || 0) + 0.005) {
        throw new ValidationError(
          `The ${label} can only be lowered or waived: on this return it is at most ${Number(
            policy[key] || 0,
          ).toFixed(2)}.`,
        );
      }
    }
  }
  if (typeof body.deliveryRefund === "number") {
    const ceiling = await returnDeliveryCeiling({
      order: params.order,
      returnRequest: params.returnRequest,
    });
    if (body.deliveryRefund > ceiling + 0.005) {
      throw new ValidationError(
        ceiling > 0
          ? `Only ${ceiling.toFixed(2)} of this parcel's delivery is left to refund.`
          : "No delivery is left to refund on this parcel: it was free, or has already been refunded.",
      );
    }
  }
}
