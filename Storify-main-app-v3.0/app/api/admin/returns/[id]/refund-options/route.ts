import { withApi } from "@/lib/api/handler";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { connectDB } from "@/lib/db";
import { canIssueRefunds } from "@/lib/access/rbac";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { loadReturnForRoute } from "@/lib/returns/return-route-access";
import {
  loadPriorReturnUnits,
  priceReturnAsItStands,
  returnDeliveryCeiling,
} from "@/lib/returns/return-plan";
import { storeCreditRefundProblem } from "@/lib/store-credit/refund-to-credit";

/**
 * How far the store may go on this return's fees and delivery, for the
 * approve and refund dialogs (R5a, R5d): each fee as the policy charges it —
 * the most it can be — and the delivery the parcel still has to hand back.
 * The same figures the update route holds a change to. And whether the refund
 * can go to the shopper as store credit (R8), with why not when it can't.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "admin:returns:refund-options", preset: "lenient" },
  },
  async ({ params, session }) => {
    if (!canIssueRefunds(session.user)) {
      throw new AuthorizationError("Only admins can change what a return refunds");
    }
    await connectDB();
    const returnRequest = await loadReturnForRoute({
      scope: "admin",
      user: session.user,
      id: params.id,
      mode: "read",
    });
    if (!returnRequest) return notFoundResponse("Return request");

    const order = await Order.findById(returnRequest.orderId).lean();
    if (!order) throw new ValidationError("Order not found for this return");
    const settings = await getSettings();
    const prior = await loadPriorReturnUnits({
      orderId: returnRequest.orderId,
      before: (returnRequest as { createdAt?: Date }).createdAt,
      excludeReturnId: returnRequest._id,
    });
    const asItStands = returnRequest as Parameters<
      typeof priceReturnAsItStands
    >[0]["returnRequest"] & {
      feeOverride?: { restockingFee?: number | null; returnShippingFee?: number | null } | null;
      deliveryOverride?: { amount?: number | null } | null;
    };
    const priceWith = (overrides: Parameters<typeof priceReturnAsItStands>[0]["overrides"]) =>
      priceReturnAsItStands({
        returnRequest: asItStands,
        order: order as Parameters<typeof priceReturnAsItStands>[0]["order"],
        settings,
        priorUnitsByIndex: prior,
        overrides,
      });
    // The fees without the store's own, and the delivery without its own.
    const policyFees = priceWith({ deliveryOverride: asItStands.deliveryOverride });
    const policyDelivery = priceWith({ feeOverride: asItStands.feeOverride });
    const current = priceWith({
      feeOverride: asItStands.feeOverride,
      deliveryOverride: asItStands.deliveryOverride,
    });

    const creditProblem = await storeCreditRefundProblem({
      order: order as { customerId?: unknown; guestEmail?: string | null },
      refundPayer: (returnRequest as { refundPayer?: string | null }).refundPayer,
    });

    return successResponse({
      currency: current.currency,
      fees: {
        restockingFee: {
          policy: policyFees.restockingFee,
          current: current.restockingFee,
        },
        returnShippingFee: {
          policy: policyFees.returnShippingFee,
          current: current.returnShippingFee,
        },
      },
      delivery: {
        policy: policyDelivery.shipping,
        current: current.shipping,
        max: await returnDeliveryCeiling({
          order: order as Parameters<typeof returnDeliveryCeiling>[0]["order"],
          returnRequest: returnRequest as Parameters<
            typeof returnDeliveryCeiling
          >[0]["returnRequest"],
        }),
      },
      refunded: Number(
        (returnRequest as { actualRefund?: { amount?: number } }).actualRefund?.amount || 0,
      ),
      storeCredit: { available: !creditProblem, reason: creditProblem },
    });
  },
);
