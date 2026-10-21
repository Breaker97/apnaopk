import * as z from "zod";
import { getSettingsLean } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { auditOrderPaid } from "@/lib/orders/audit-order";
import { ensureChargeTransaction } from "@/lib/payments/payment-transactions";
import { loadAccessiblePOSOrder } from "@/lib/pos/pos-order-access";
import { collectPOSBalance } from "@/lib/pos/collect-balance";
import { resolvePosOperator } from "@/lib/pos/operator";
import { registerVendorScope, resolveSaleSession } from "@/lib/pos/register-session";
import { POS_CARD_SUB_METHODS, POS_TENDER_METHODS } from "@/lib/pos/tenders";
import type { IOrder } from "@/types";

const BalanceSchema = z.object({
  requestId: z.string().max(100),
  registerSessionId: z.string().max(64).optional(),
  tenders: z
    .array(
      z.object({
        method: z.enum(POS_TENDER_METHODS),
        amount: z.number(),
        tendered: z.number().optional(),
        reference: z.string().max(200).optional(),
        cardSubMethod: z.enum(POS_CARD_SUB_METHODS).optional(),
      }),
    )
    .min(1)
    .max(10),
});

/**
 * POST /api/pos/orders/[id]/balance — take a payment toward a deposit sale.
 * See lib/pos/collect-balance.ts.
 */
export const POST = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "pos:orders", preset: "lenient" } },
  async ({ request, params, session }) => {
    const order = (await loadAccessiblePOSOrder(session.user, params.id)) as unknown as IOrder;
    const body = await validateBody(request, BalanceSchema);
    const settings = await getSettingsLean();

    const sessionId = await resolveSaleSession({
      vendorId: await registerVendorScope(session.user),
      registerSessionId: body.registerSessionId,
      required: settings.pos?.checkout?.requireOpenRegister === true,
      isReplay: false,
    });
    const result = await collectPOSBalance({
      order,
      tenders: body.tenders,
      requestId: body.requestId,
      settings,
      collectedBy: (await resolvePosOperator(session.user, request.cookies)).id,
      sessionId,
    });

    if (result.completed && !result.replayed) {
      const paid = result.order;
      // The sale is whole now: its charge row, and through it the ledger
      // (sale + split-tender moves), are written as for any paid sale.
      await ensureChargeTransaction({
        _id: String(paid._id),
        orderNumber: paid.orderNumber,
        paymentMethod: paid.paymentMethod,
        paymentStatus: paid.paymentStatus,
        paymentId: paid.paymentId,
        subtotal: paid.subtotal,
        shippingCost: paid.shippingCost,
        tax: paid.tax,
        discount: paid.discount,
        total: paid.total,
        currency: paid.currency || settings.general?.defaultCurrency,
        channel: paid.channel,
        posLocationId: paid.posLocationId ? String(paid.posLocationId) : undefined,
        paymentMetadata: { posPayment: { method: paid.paymentMethod, tenders: paid.posTenders } },
        createdAt: paid.createdAt,
      });
      await auditOrderPaid(createAuditContext(request, session), paid, {
        gateway: paid.paymentMethod,
        amount: paid.total,
        currency: paid.currency,
        transactionId: paid.paymentId,
      }).catch((error) => console.error("Failed to audit a POS balance payment:", error));
      const { awardOrderLoyaltyPoints, refreshCustomerStatsForOrder } = await import(
        "@/lib/customers/customer"
      );
      await awardOrderLoyaltyPoints(String(paid._id)).catch((error) =>
        console.error("Failed to award loyalty points on a paid-off POS sale:", error),
      );
      refreshCustomerStatsForOrder(paid).catch((error) =>
        console.error("Failed to refresh customer stats on a paid-off POS sale:", error),
      );
    }

    return successResponse({
      orderId: String(result.order._id),
      orderNumber: result.order.orderNumber,
      balanceDue: Number(result.order.posBalanceDue || 0),
      completed: result.completed,
    });
  },
);
