import { OrderDetail } from "@/contracts/mobile/shop/v1/orders";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { withRequestScope } from "@/lib/api/request-scope";
import { isValidObjectId } from "@/lib/api/validate";
import { DEFAULT_CURRENCY } from "@/config/branding.config";
import { connectDB } from "@/lib/db";
import { sanitizeOrderForCustomer } from "@/lib/orders/order-customer-view";
import {
  getPreorderBalanceDeadline,
  getPreorderBalanceDue,
  getPreorderPaidSoFar,
} from "@/lib/orders/order-payment-status";
import { loadOrderShipmentTracking } from "@/lib/orders/order-shipment-view";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import { appBaseUrl } from "@/lib/app-url";
import { buildLocalePath, resolveLocaleRouting } from "@/lib/i18n/locale-prefix";
import { preorderBalanceLinkPath } from "@/lib/payments/preorder-balance-link";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import type { PayableOrder } from "@/lib/payments/order-pay";
import type { IOrder } from "@/types";
import { productSlugsOf } from "@/lib/api-core/shop/product-slugs";
import { orderReturnability } from "@/lib/api-core/shop/returns/returnability";
import { getReturnCopy } from "@/lib/returns/return-copy";
import { toOrderDetail, type CustomerOrder } from "./dto";
import { orderPaymentOf } from "./payment";

export function orderNotFound(): MobileApiError {
  return new MobileApiError(404, "NOT_FOUND", "Order not found.");
}

/** The website's signed balance page for this order, in the app's language. */
function balancePayUrl(
  order: IOrder,
  locale: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
): string | undefined {
  const path = preorderBalanceLinkPath(String(order._id));
  if (!path) return undefined;
  const { storeDefault } = resolveLocaleRouting(settings.general);
  return `${appBaseUrl()}${buildLocalePath(locale, path, storeDefault)}`;
}

/** The shopper's own order, or 404: somebody else's never answers otherwise. */
export async function findCustomerOrder(id: string, userId: string): Promise<IOrder> {
  if (!isValidObjectId(id)) throw orderNotFound();
  await connectDB();
  const order = await Order.findOne({ _id: id, customerId: userId }).lean<IOrder>();
  if (!order) throw orderNotFound();
  return order;
}

/**
 * One order as its shopper sees it: the consignments without the sellers'
 * economics, the courier's scans, a pre-order's balance, and what "Pay now"
 * can collect. One read of the settings serves the tracking links, the
 * balance deadline, the currency and the gateways.
 */
export function buildOrderDetail(
  order: IOrder,
  ctx: {
    appScheme: string;
    /**
     * The shopper's own order, in this locale: say what of it can be
     * returned, and link the website's page that pays a pre-order's balance.
     */
    returnsIn?: string;
  },
): Promise<OrderDetail> {
  return withRequestScope(async () => {
    const settings = await getSettings();
    const [sanitized, tracking, slugs] = await Promise.all([
      sanitizeOrderForCustomer(order as unknown as Parameters<typeof sanitizeOrderForCustomer>[0]),
      loadOrderShipmentTracking({
        orderId: order._id,
        trackingNumber: order.trackingNumber,
        carrier: order.carrier,
        settings,
      }),
      // One query for every line's product page, whatever the number of lines.
      productSlugsOf((order.items ?? []).map((item) => item.productId)),
    ]);

    // Here rather than in the app: the sanitizer strips the consignments'
    // lines, which say what part of the balance a cancelled one owed, and the
    // grace period lives in settings the shopper never sees.
    const preOrderBalance = order.hasPreorder
      ? {
          balanceDue: getPreorderBalanceDue(order),
          paidSoFar: getPreorderPaidSoFar(order),
          deadline: getPreorderBalanceDeadline(
            order,
            resolvePreorderPolicy(settings.preorder).expiryGraceDays,
          ),
          // The website's own balance page, signed for this order: the app
          // has no way to take part of an order's money (lib/payments/order-pay.ts).
          payUrl: ctx.returnsIn ? balancePayUrl(order, ctx.returnsIn, settings) : undefined,
        }
      : null;

    const detail = toOrderDetail(sanitized as unknown as CustomerOrder, {
      storeCurrency: settings.general?.defaultCurrency || DEFAULT_CURRENCY,
      tracking: tracking.primary,
      trackingFor: tracking.forTrackingNumber,
      preOrderBalance,
      payment: orderPaymentOf(order as unknown as PayableOrder, settings, ctx.appScheme),
      slugs,
    });
    if (!ctx.returnsIn) return detail;

    // Read off the stored order, not the sanitized one: the window and the
    // claimed quantities need its delivery dates and consignments.
    const returns = await orderReturnability(
      order as unknown as Parameters<typeof orderReturnability>[0],
      settings,
      await getReturnCopy(ctx.returnsIn),
    );
    if (!returns) return { ...detail, canReturn: false };
    return {
      ...detail,
      lines: detail.lines.map((line) => {
        const own = returns.lines.get(line.index);
        if (!own) return line;
        return {
          ...line,
          returnableQuantity: own.returnableQuantity,
          ...(own.blockedReason ? { returnBlockedReason: own.blockedReason } : {}),
          ...(own.windowEndsAt ? { returnWindowEndsAt: own.windowEndsAt } : {}),
        };
      }),
      canReturn: returns.canReturn,
      ...(returns.windowEndsAt ? { returnWindowEndsAt: returns.windowEndsAt } : {}),
      ...(returns.blockedReason
        ? { returnBlockedReason: returns.blockedReason, returnBlockedMessage: returns.blockedMessage }
        : {}),
    };
  });
}

/** GET /orders/{id} */
export const orderDetailRoute = defineRoute({
  id: "orders.detail",
  method: "GET",
  path: "/orders/{id}",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  output: OrderDetail,
  handler: async ({ params, session, mobileApp, locale }) =>
    buildOrderDetail(await findCustomerOrder(params.id, session.user.id), {
      appScheme: mobileApp.scheme,
      returnsIn: locale,
    }),
});
