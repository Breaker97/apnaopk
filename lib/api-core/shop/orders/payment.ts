import {
  ORDER_PAY_METHODS,
  type OrderPayment,
} from "@/contracts/mobile/shop/v1/orders";
import { toMoney } from "@/lib/api-core/shop/money";
import { missingGatewayCredentials } from "@/lib/payments/checkout-gateways";
import type { SettingsDocument } from "@/lib/payments/finalize-order";
import { gatewaySettlesCurrency } from "@/lib/payments/gateway-currencies";
import {
  getOrderPayAmountDue,
  isOrderPayable,
  type PayableOrder,
} from "@/lib/payments/order-pay";
import { isValidAppScheme } from "@/lib/settings/mobile-app";

type OrderPayMethod = (typeof ORDER_PAY_METHODS)[number];

/** The gateway behind each way "Pay now" can take the money. */
const GATEWAY: Record<OrderPayMethod, "stripe" | "paypal" | "mtn_momo" | "iotec"> = {
  card: "stripe",
  paypal: "paypal",
  mtn_momo: "mtn_momo",
  iotec: "iotec",
};

/** Mobile money is paid the way the order was placed: its phone is prompted again. */
const PUSH_METHODS: ReadonlySet<OrderPayMethod> = new Set(["mtn_momo", "iotec"]);

/** The currency the order was placed in: what it still owes is owed in that. */
export function orderPayCurrency(order: PayableOrder, settings: SettingsDocument): string {
  return String(order.currency || settings.general?.defaultCurrency || "USD").trim().toUpperCase();
}

/**
 * Whether "Pay now" can take the money this way: the gateway switched on, its
 * keys in, and the ORDER's currency one it settles (a store that has changed
 * currency since still owes in the old one) — for PayPal, a way back from its
 * page to the app; for mobile money, an order placed with that provider.
 */
export function orderPayMethodReady(
  method: OrderPayMethod,
  order: PayableOrder,
  settings: SettingsDocument,
  appScheme: string,
): boolean {
  const gateway = GATEWAY[method];
  if (PUSH_METHODS.has(method) && order.paymentMethod !== method) return false;
  if (!settings.payment?.[gateway]?.enabled) return false;
  if (missingGatewayCredentials(settings.payment)[gateway].length > 0) return false;
  if (!gatewaySettlesCurrency(gateway, orderPayCurrency(order, settings))) return false;
  return method !== "paypal" || isValidAppScheme(appScheme);
}

/** `OrderDetail.payment`: what the order still owes, and the ways "Pay now" can take it. */
export function orderPaymentOf(
  order: PayableOrder,
  settings: SettingsDocument,
  appScheme: string,
): OrderPayment {
  const currency = orderPayCurrency(order, settings);
  const due = isOrderPayable(order) ? getOrderPayAmountDue(order) : 0;
  const methods = due > 0 ? ORDER_PAY_METHODS.filter((method) => orderPayMethodReady(method, order, settings, appScheme)) : [];
  return {
    payable: methods.length > 0,
    due: toMoney(due, currency),
    methods,
  };
}
