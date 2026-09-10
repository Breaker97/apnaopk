import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { isPurchaseClaimStale } from "@/lib/shipping/carrier-config";
import type { ICarrierAutomationSettings } from "@/models/settings.model";
import type { IShipment } from "@/models/shipment.model";
import type { IOrder, SubOrder } from "@/types";
import {
  isSubOrderPaid,
  resolveSubOrderPaymentStatus,
} from "@/lib/orders/order-payment-status";

/**
 * When a shipment is created without anyone clicking anything.
 *
 * Pure and exhaustively testable, and it returns *why* it declined rather than
 * a bare boolean — a sweep that silently skips an order is impossible to
 * diagnose, and "why did this not ship?" is the first question a merchant asks.
 */

type AutoShipSkipReason =
  | "carriers_disabled"
  | "automation_disabled"
  | "sub_order_not_processing"
  | "not_paid"
  | "digital_only"
  | "pickup"
  | "nothing_shippable"
  | "below_min_value"
  | "above_max_value"
  | "country_not_allowed"
  | "already_shipped"
  | "cancelled";

interface AutoShipDecision {
  eligible: boolean;
  reason?: AutoShipSkipReason;
}

type OrderForAutomation = Pick<
  IOrder,
  | "status"
  | "paymentStatus"
  | "paymentMethod"
  | "digitalOnly"
  | "total"
  | "shippingAddress"
  | "fulfillment"
>;

type SubOrderForAutomation = Pick<
  SubOrder,
  "status" | "fulfillment" | "items" | "trackingNumber" | "paymentStatus"
>;

export function isAutoShipEligible(params: {
  order: OrderForAutomation;
  subOrder: SubOrderForAutomation;
  automation?: ICarrierAutomationSettings;
  carriersEnabled: boolean;
  /**
   * Only the purchase state and its clock are read, so callers are not made to
   * fetch (or fabricate) a whole shipment just to answer "is one already in
   * flight?". The clock is not optional decoration: without it an abandoned
   * claim is indistinguishable from a live one.
   */
  existingShipment?: {
    purchase?: Pick<NonNullable<IShipment["purchase"]>, "state" | "startedAt">;
  } | null;
}): AutoShipDecision {
  const { order, subOrder, automation } = params;

  if (!params.carriersEnabled) {
    return { eligible: false, reason: "carriers_disabled" };
  }
  if (!automation?.enabled) {
    return { eligible: false, reason: "automation_disabled" };
  }

  if (
    order.status === ORDER_STATUS.CANCELLED ||
    subOrder.status === ORDER_STATUS.CANCELLED
  ) {
    return { eligible: false, reason: "cancelled" };
  }

  // The sub-order, not the order: on a split order one vendor may already have
  // shipped while another has not, and the sub-order is what a parcel maps to.
  if (subOrder.status !== ORDER_STATUS.PROCESSING) {
    return { eligible: false, reason: "sub_order_not_processing" };
  }

  const isCod = String(order.paymentMethod || "").toLowerCase() === "cod";
  // Per consignment, like every other check in this function: on a split order
  // one vendor's collection says nothing about whether another's parcel has
  // been paid for.
  const paid = isSubOrderPaid(order, subOrder);
  // A COD order is unpaid by definition, so without this branch COD would
  // never auto-ship at all.
  const codShippable =
    Boolean(automation.includeCod) &&
    isCod &&
    resolveSubOrderPaymentStatus(order, subOrder) === PAYMENT_STATUS.PENDING;
  if (!paid && !codShippable) {
    return { eligible: false, reason: "not_paid" };
  }

  if (order.digitalOnly === true) {
    return { eligible: false, reason: "digital_only" };
  }
  if (
    order.fulfillment?.method === "pickup" ||
    subOrder.fulfillment?.method === "pickup"
  ) {
    return { eligible: false, reason: "pickup" };
  }

  // The customs snapshot is absent for digital lines by construction, so its
  // presence is the definition of "this line goes in a box".
  const hasShippableItem = (subOrder.items || []).some(
    (item) => item.customs?.weight !== undefined,
  );
  if (!hasShippableItem) {
    return { eligible: false, reason: "nothing_shippable" };
  }

  const total = Number(order.total) || 0;
  if (
    typeof automation.minOrderValue === "number" &&
    automation.minOrderValue > 0 &&
    total < automation.minOrderValue
  ) {
    return { eligible: false, reason: "below_min_value" };
  }
  if (
    typeof automation.maxOrderValue === "number" &&
    automation.maxOrderValue > 0 &&
    total > automation.maxOrderValue
  ) {
    return { eligible: false, reason: "above_max_value" };
  }

  const restrict = automation.restrictToCountries || [];
  if (restrict.length > 0) {
    const country = String(order.shippingAddress?.country || "")
      .trim()
      .toUpperCase();
    if (!restrict.map((code) => code.toUpperCase()).includes(country)) {
      return { eligible: false, reason: "country_not_allowed" };
    }
  }

  // Already handled — by a human, an earlier sweep, or a worker currently
  // holding it. Re-queueing would buy a second label for one parcel.
  if (subOrder.trackingNumber) {
    return { eligible: false, reason: "already_shipped" };
  }
  const purchase = params.existingShipment?.purchase;
  // A `purchasing` claim whose worker died is not work in flight — it is a
  // parcel nobody is holding. Treating it as held is how one killed function
  // took a sub-order out of automation permanently.
  if (
    purchase?.state === "purchased" ||
    (purchase?.state === "purchasing" && !isPurchaseClaimStale(purchase))
  ) {
    return { eligible: false, reason: "already_shipped" };
  }

  return { eligible: true };
}
