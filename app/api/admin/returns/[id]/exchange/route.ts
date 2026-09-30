import { withApi } from "@/lib/api/handler";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { connectDB } from "@/lib/db";
import { canIssueRefunds } from "@/lib/access/rbac";
import { ReturnExchangeItemsSchema } from "@/lib/validations";
import { Order, ReturnRequest } from "@/models";
import { getSettings } from "@/models/settings.model";
import { loadReturnForRoute } from "@/lib/returns/return-route-access";
import { quantizeToCurrency } from "@/lib/intl/money";
import { exchangeOverview, hasActiveExchange } from "@/lib/returns/exchange";
import { resolveExchangeItems } from "@/lib/returns/return-exchange";

/**
 * What a return is exchanged for (R7), before it is processed.
 *
 * GET — the items, what the exchange order will cost, what the return pays of
 * it, and anything in the way. PUT — choose the items and the delivery charge.
 * Admins only: an exchange moves the return's money, as a refund does (D3).
 * Processing it is part of the return's own update — `processExchange`.
 */

type ReturnDoc = NonNullable<Awaited<ReturnType<typeof loadReturnForRoute>>>;

async function describe(returnRequest: ReturnDoc) {
  const order = await Order.findById(returnRequest.orderId)
    .select("currency customs subtotal discount tax coupon paymentStatus")
    .lean();
  if (!order) throw new ValidationError("Order not found for this return");
  const settings = await getSettings();
  const overview = exchangeOverview({
    returnRequest: returnRequest as Parameters<typeof exchangeOverview>[0]["returnRequest"],
    order: order as Parameters<typeof exchangeOverview>[0]["order"],
    storeCurrency: settings.general?.defaultCurrency || "USD",
    fallbackTaxPercent: Number(settings.orders?.taxRate || 0) * 100,
  });
  const record = returnRequest as ReturnDoc & {
    exchangeItems?: unknown[];
    exchangeDelivery?: number;
    exchange?: unknown;
  };
  return {
    items: record.exchangeItems || [],
    delivery: Number(record.exchangeDelivery || 0),
    exchange: record.exchange ?? null,
    // Once processed, the exchange order is what stands; its items are fixed.
    editable: !hasActiveExchange(record as Parameters<typeof hasActiveExchange>[0]),
    ...overview,
  };
}

export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "admin:returns:exchange", preset: "lenient" },
  },
  async ({ params, session }) => {
    if (!canIssueRefunds(session.user)) {
      throw new AuthorizationError("Only admins can exchange a return");
    }
    await connectDB();
    const returnRequest = await loadReturnForRoute({
      scope: "admin",
      user: session.user,
      id: params.id,
      mode: "read",
    });
    if (!returnRequest) return notFoundResponse("Return request");
    return successResponse(await describe(returnRequest));
  },
);

export const PUT = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "admin:returns:exchange:update", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    if (!canIssueRefunds(session.user)) {
      throw new AuthorizationError("Only admins can exchange a return");
    }
    const body = await validateBody(request, ReturnExchangeItemsSchema);
    await connectDB();
    const returnRequest = await loadReturnForRoute({
      scope: "admin",
      user: session.user,
      id: params.id,
      mode: "write",
    });
    if (!returnRequest) return notFoundResponse("Return request");
    if (hasActiveExchange(returnRequest as Parameters<typeof hasActiveExchange>[0])) {
      throw new ValidationError(
        "This return has already been exchanged. Cancel the exchange order to change what it sends.",
      );
    }
    if (["rejected", "cancelled", "closed", "refunded"].includes(String(returnRequest.status))) {
      throw new ValidationError("This return is finished, so it can no longer be exchanged.");
    }

    const settings = await getSettings();
    const order = await Order.findById(returnRequest.orderId).select("currency").lean<{
      currency?: string;
    } | null>();
    const currency = String(
      order?.currency || settings.general?.defaultCurrency || "USD",
    ).toUpperCase();
    const items = await resolveExchangeItems({
      returnRequest,
      lines: body.items.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
      settings,
      currency,
    });
    const delivery = quantizeToCurrency(Math.max(0, Number(body.delivery || 0)), currency);

    // Not once it has been processed — a processing landing since the read
    // included.
    const updated = await ReturnRequest.findOneAndUpdate(
      {
        _id: returnRequest._id,
        $or: [{ "exchange.orderId": { $exists: false } }, { "exchange.undoneAt": { $exists: true } }],
      },
      items.length > 0
        ? { $set: { exchangeItems: items, exchangeDelivery: delivery, updatedBy: session.user.id } }
        : {
            $unset: { exchangeItems: "", exchangeDelivery: "" },
            $set: { updatedBy: session.user.id },
          },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!updated) {
      throw new ValidationError(
        "This return was exchanged while you were working on it. Reload it and try again.",
      );
    }
    return successResponse(
      await describe(updated as ReturnDoc),
      items.length > 0 ? "Exchange items saved" : "Exchange items removed",
    );
  },
);
