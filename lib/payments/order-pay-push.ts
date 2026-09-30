import { randomUUID } from "crypto";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ValidationError } from "@/lib/api/errors";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { ASYNC_PUSH_PAYMENT_METHODS } from "@/lib/orders/pending-payment-lock";
import {
  releaseAsyncPushInventory,
  reserveAsyncPushInventory,
} from "@/lib/orders/async-push-inventory";
import { orderInventoryOpts } from "@/lib/orders/order-inventory";
import { isOrderPayable, getOrderPayAmountDue } from "@/lib/payments/order-pay";
import type { SettingsDocument } from "@/lib/payments/finalize-order";

/**
 * Ask a mobile-money provider to prompt the payer again, for the same order.
 *
 * The "pay now" answer for the gateways where paying does not mean typing a
 * card: a push went to the phone, nobody approved it, and the only useful
 * thing a link can do is send another one. Same order, same number, same
 * amount — nothing is re-priced and no second order is created.
 *
 * **Only once the first attempt is definitively dead.** A live prompt on the
 * payer's phone is money that may still arrive: sending a second one invites
 * two approvals, and taking the order's handle off the first (each provider
 * has exactly one reference per transaction) would leave a payment nothing
 * could ever match to an order. So this waits for the reconciler or the expiry
 * sweep to have closed the previous try, and otherwise tells the shopper to
 * check their phone — which is the honest answer, because the prompt is there.
 */

type PushOrder = {
  _id: unknown;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  channel?: string;
  posLocationId?: unknown;
  currency?: string;
  total?: number;
  preorderOutstandingAmount?: number;
  hasPreorder?: boolean;
  paymentReconcileClosedAt?: Date;
  billingAddress?: { phone?: string; fullName?: string };
  shippingAddress?: { phone?: string; fullName?: string };
  items?: Array<{
    productId: unknown;
    variantId?: unknown;
    vendorId?: unknown;
    quantity: number;
    purchaseType?: string;
  }>;
  subOrders?: Array<{
    vendorId?: unknown;
    status?: string;
    inventoryReserved?: boolean;
    fulfillment?: unknown;
  }>;
};

type OrderPayPushResult =
  | { prompted: true; method: string }
  /** Orange Money takes the payer to its own page rather than prompting. */
  | { prompted: false; redirectUrl: string; method: string };

/** Payment states in which nothing has been collected yet. */
const PAYABLE_STATES: string[] = [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.EXPIRED];

const STILL_IN_FLIGHT =
  "The last payment request is still live — check your phone for the prompt and approve it there. If it never arrives, try again in a few minutes.";

export async function resendOrderPaymentPush(params: {
  orderId: string;
  customerId?: string;
  viaAccessLink?: boolean;
  /** Where Orange Money should send the payer back to. */
  origin: string;
  locale: string;
  settings?: SettingsDocument;
}): Promise<OrderPayPushResult> {
  const order = (await Order.findOne(
    params.viaAccessLink
      ? { _id: params.orderId }
      : { _id: params.orderId, customerId: params.customerId },
  )
    .select(
      "orderNumber status paymentStatus paymentMethod channel posLocationId currency total preorderOutstandingAmount storeCredit hasPreorder paymentReconcileClosedAt billingAddress shippingAddress items.productId items.variantId items.vendorId items.quantity items.purchaseType subOrders.vendorId subOrders.status subOrders.inventoryReserved subOrders.fulfillment",
    )
    .lean()) as PushOrder | null;
  if (!order) throw new ValidationError("Order not found");

  const method = String(order.paymentMethod || "").toLowerCase();
  if (!(ASYNC_PUSH_PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new ValidationError(
      "This order was not paid for with mobile money, so there is no prompt to resend.",
    );
  }
  if (!isOrderPayable(order)) {
    throw new ValidationError("This order has nothing left to pay");
  }

  // The previous attempt has to be finished with. `expired` is the sweep's
  // verdict after asking the provider; `paymentReconcileClosedAt` is the
  // reconciler's after being told the transaction failed.
  const settled =
    String(order.paymentStatus) === PAYMENT_STATUS.EXPIRED ||
    Boolean(order.paymentReconcileClosedAt);
  if (!settled) throw new ValidationError(STILL_IN_FLIGHT);

  const settings = params.settings || (await getSettings());
  const amount = getOrderPayAmountDue(order);
  const currency = String(
    order.currency || settings.general?.defaultCurrency || "USD",
  ).toUpperCase();
  const phone =
    order.billingAddress?.phone || order.shippingAddress?.phone || "";
  const payerName =
    order.billingAddress?.fullName || order.shippingAddress?.fullName;

  if (method === "iotec") {
    return resendIotec({ order, settings, amount, currency, phone, payerName });
  }
  if (method === "mtn_momo") {
    return resendMtnMomo({ order, settings, amount, currency, phone });
  }
  return resendOrangeMoney({
    order,
    settings,
    amount,
    currency,
    phone,
    origin: params.origin,
    locale: params.locale,
  });
}

/**
 * Take the goods off the shelf again for a new prompt, when nothing is holding
 * them any more.
 *
 * The expiry sweep gives an order's goods back when it writes the payment off.
 * A new prompt is a new chance of money none of these providers can refund, so
 * the goods are held again before it goes — exactly as at checkout
 * (`async-push-inventory.ts`) — and no prompt is sent for goods that have gone
 * since. An order the reconciler closed but the sweep has not reached still
 * holds them, and is left as it is. Only the sellers still on the order count:
 * a consignment called off after the write-off gave its goods up for good.
 *
 * Returns whether it took anything, so a caller that then cannot go ahead can
 * give it back.
 */
async function holdStockForNewPrompt(order: PushOrder): Promise<boolean> {
  const live = (order.subOrders || []).filter(
    (sub) => sub.status !== ORDER_STATUS.CANCELLED,
  );
  if (live.length === 0 || live.some((sub) => sub.inventoryReserved)) {
    return false;
  }
  const liveSellers = new Set(live.map((sub) => String(sub.vendorId ?? "")));
  const soldOut = await reserveAsyncPushInventory({
    order: { _id: order._id, hasPreorder: order.hasPreorder },
    items: (order.items || []).filter((item) =>
      liveSellers.has(String(item.vendorId ?? "")),
    ),
    inventoryOpts: orderInventoryOpts({ ...order, subOrders: live }),
  });
  if (soldOut) {
    throw new ValidationError(
      "Something on this order has sold out since the first payment request, so it can no longer be paid for here. Contact us and we will sort it out.",
    );
  }
  return true;
}

/**
 * A fresh reference replaces the dead one, and the goods are held for it.
 *
 * Safe only because of the guard above: the provider has already told us the
 * old transaction failed, so nothing will ever arrive against it, and keeping
 * it would mean the order carried a handle to a payment that cannot happen.
 *
 * Called last, right before the provider is asked, once every refusal that
 * does not need the provider has had its chance: the write here is what puts
 * the order back under the sweep's watch, and a hold taken on an order the
 * sweep is not watching is a hold nothing would ever give back.
 */
async function stampReference(order: PushOrder, update: Record<string, unknown>) {
  const held = await holdStockForNewPrompt(order);
  const stamped = await Order.updateOne(
    {
      _id: order._id,
      status: { $ne: ORDER_STATUS.CANCELLED },
      paymentStatus: { $in: PAYABLE_STATES },
    },
    {
      $set: {
        ...update,
        // Back in play: the sweep and the reconciler should watch this one.
        paymentStatus: PAYMENT_STATUS.PENDING,
      },
      $unset: { paymentReconcileClosedAt: "" },
    },
  );
  if (!stamped.modifiedCount) {
    // Cancelled since it was read, so the hold is not needed. Paid since it
    // was read is different: that settlement found the goods held and took
    // them as its own, and giving them back would sell them twice.
    if (held) {
      const now = await Order.findById(order._id)
        .select("paymentStatus")
        .lean<{ paymentStatus?: string } | null>();
      if (!now || PAYABLE_STATES.includes(String(now.paymentStatus || ""))) {
        await releaseAsyncPushInventory(order._id);
      }
    }
    throw new ValidationError("This order has nothing left to pay");
  }
}

async function resendIotec(params: {
  order: PushOrder;
  settings: SettingsDocument;
  amount: number;
  currency: string;
  phone: string;
  payerName?: string;
}): Promise<OrderPayPushResult> {
  const { getIotecCredentials, normalizeUgandaMsisdn, submitIotecCollection } =
    await import("@/lib/payments/iotec");
  const { resolveIotecCredentials } = await import("@/lib/settings/credentials");

  const iotec = params.settings.payment?.iotec;
  if (!iotec?.enabled) {
    throw new ValidationError("Mobile money is not available right now");
  }
  const creds = getIotecCredentials(resolveIotecCredentials(iotec));
  if (!creds.walletId) {
    throw new ValidationError("Mobile money is not configured");
  }
  const payer = normalizeUgandaMsisdn(params.phone);
  if (!payer) {
    throw new ValidationError(
      "This order has no mobile money number to prompt. Contact us and we will take the payment another way.",
    );
  }

  // Minted before the call, as at checkout: the reference is the transaction's
  // only handle, so it must be on the order before a prompt can exist.
  const externalId = randomUUID();
  await stampReference(params.order, { iotecExternalId: externalId });

  await submitIotecCollection({
    creds,
    externalId,
    currency: params.currency,
    amount: params.amount,
    payer,
    payerName: params.payerName,
    payerNote: `Order ${params.order.orderNumber || ""}`.trim(),
  });

  return { prompted: true, method: "iotec" };
}

async function resendMtnMomo(params: {
  order: PushOrder;
  settings: SettingsDocument;
  amount: number;
  currency: string;
  phone: string;
}): Promise<OrderPayPushResult> {
  const {
    getMtnMomoCredentials,
    mtnMomoCallbackUrl,
    mtnMomoChargeCurrency,
    normalizeMtnMomoMsisdn,
    requestMtnMomoPayment,
  } = await import("@/lib/payments/mtn-momo");
  const { resolveMtnMomoCredentials } = await import("@/lib/settings/credentials");

  const momo = params.settings.payment?.mtn_momo;
  if (!momo?.enabled) {
    throw new ValidationError("Mobile money is not available right now");
  }
  const creds = getMtnMomoCredentials(resolveMtnMomoCredentials(momo));
  const payerMsisdn = normalizeMtnMomoMsisdn(
    params.phone,
    creds.targetEnvironment,
  );
  if (!payerMsisdn) {
    throw new ValidationError(
      "This order has no mobile money number to prompt. Contact us and we will take the payment another way.",
    );
  }

  const referenceId = randomUUID();
  await stampReference(params.order, { mtnMomoReferenceId: referenceId });

  await requestMtnMomoPayment({
    creds,
    referenceId,
    amount: params.amount,
    currency: mtnMomoChargeCurrency(creds.mode, params.currency),
    externalId: String(params.order._id),
    payerMsisdn,
    payerMessage: `Order ${params.order.orderNumber || ""}`.replace(
      /[^\w\s.-]/g,
      "",
    ),
    payeeNote: `Order ${params.order._id}`,
    callbackUrl: mtnMomoCallbackUrl(creds),
  });

  return { prompted: true, method: "mtn_momo" };
}

async function resendOrangeMoney(params: {
  order: PushOrder;
  settings: SettingsDocument;
  amount: number;
  currency: string;
  phone: string;
  origin: string;
  locale: string;
}): Promise<OrderPayPushResult> {
  const {
    getOrangeMoneyCredentials,
    orangeMoneyChargeCurrency,
    orangeMoneyLang,
    submitOrangeMoneyPayment,
  } = await import("@/lib/payments/orange-money");
  const { resolveOrangeMoneyCredentials } = await import(
    "@/lib/settings/credentials"
  );

  const orange = params.settings.payment?.orange_money;
  if (!orange?.enabled) {
    throw new ValidationError("Orange Money is not available right now");
  }
  const creds = getOrangeMoneyCredentials(resolveOrangeMoneyCredentials(orange));

  const orangeMoneyOrderId = `om-${String(params.order._id).slice(-18)}-${Date.now().toString(36)}`;
  await stampReference(params.order, { orangeMoneyOrderId });

  const payment = await submitOrangeMoneyPayment({
    creds,
    orderId: orangeMoneyOrderId,
    amount: params.amount,
    currency: orangeMoneyChargeCurrency(creds.mode, params.currency),
    returnUrl: `${params.origin}/${params.locale}/checkout/success?orange_money_order_id=${encodeURIComponent(orangeMoneyOrderId)}`,
    cancelUrl: `${params.origin}/${params.locale}/account/orders/${String(params.order._id)}`,
    // Called server-to-server by Orange, so it must be absolute and public —
    // the same address checkout registers, not a locale-prefixed page route.
    notifUrl: `${params.origin}/api/payments/orange-money/callback`,
    lang: orangeMoneyLang(params.locale),
    reference: params.settings.general?.storeName || "Storify",
  });

  await Order.updateOne(
    { _id: params.order._id },
    {
      $set: {
        orangeMoneyPayToken: payment.pay_token,
        orangeMoneyNotifToken: payment.notif_token,
      },
    },
  );

  return {
    prompted: false,
    redirectUrl: String(payment.payment_url),
    method: "orange_money",
  };
}
