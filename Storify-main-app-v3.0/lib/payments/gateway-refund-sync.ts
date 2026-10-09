import { VendorSubscriptionPayment } from "@/models/vendorSubscriptionPayment.model";
import { syncVendorSubscriptionRefunds } from "@/lib/vendors/vendor-subscription-refunds";
import "server-only";

import type Stripe from "stripe";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import { Order } from "@/models/order.model";
import { PlatformPayment } from "@/models/platformPayment.model";
import {
  resolvePaystackCredentials,
  resolveRazorpayCredentials,
  resolveStripeCredentials,
} from "@/lib/settings/credentials";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import {
  fromRazorpayAmountSubunits,
  listRazorpayRefunds,
} from "@/lib/payments/razorpay";
import {
  fromPaystackAmountSubunits,
  listPaystackRefunds,
  listPaystackRefundsCreated,
} from "@/lib/payments/paystack";
import {
  readRazorpayRefund,
  reconcileGatewayRefundReading,
  reconcilePaystackRefunds,
  reconcileStripeOrderRefunds,
  reverseFailedGatewayRefund,
  reverseFailedOrderRefund,
} from "@/lib/orders/order-refund-sync";
import { RefundInFlightError } from "@/lib/orders/refund-in-flight";

/**
 * The hourly backstop for refunds, as `syncGatewayDisputes` is for disputes.
 *
 * The webhooks are the fast path. A refund made in a gateway's own dashboard,
 * or one that failed days after it was sent, reaches the books only through
 * them — and a webhook endpoint that was never subscribed, a Razorpay webhook
 * switched off after a day of errors, or a delivery that simply never came
 * lost it for good: the vendor was paid on a refunded sale, or a shopper whose
 * refund bounced was never paid at all.
 *
 * Every refund is applied exactly as its webhook would apply it, and applying
 * one twice changes nothing the second time, so each run re-reads the window
 * rather than remembering where it stopped. PayPal is left to its webhook: it
 * has no plain way to list refunds.
 */

/** How far back a run looks. A card refund can fail weeks after it was sent. */
const REFUND_SYNC_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const DEAD_STATUSES = new Set(["failed", "canceled", "cancelled"]);

type RefundSyncGateway = "stripe" | "razorpay" | "paystack";

interface GatewayRefundSync {
  status: "synced" | "not_configured" | "failed";
  checked: number;
  /** Refunds the books did not have, now recorded. */
  recorded: number;
  /** Refunds that failed at the gateway, now taken back off the books. */
  reversed: number;
  /** Left for the next run because a refund was being recorded on the order. */
  busy: number;
  failed: number;
  error?: string;
}

type Settings = Awaited<ReturnType<typeof getSettings>>;

/**
 * The refund ids the books already hold, under any of the names a row keeps
 * them by. Only the rest are worth a round trip to the gateway.
 */
async function knownRefundIds(ids: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Set();
  const rows = await PaymentTransaction.find({
    type: "refund",
    $or: [
      { externalId: { $in: unique } },
      { "metadata.gatewayRefundIds": { $in: unique } },
      { "metadata.gatewayAliasIds": { $in: unique } },
    ],
  })
    .select("externalId metadata.gatewayRefundIds metadata.gatewayAliasIds")
    .lean<
      Array<{
        externalId?: string;
        metadata?: { gatewayRefundIds?: unknown; gatewayAliasIds?: unknown };
      }>
    >();
  const known = new Set<string>();
  for (const row of rows) {
    if (row.externalId) known.add(String(row.externalId));
    for (const list of [row.metadata?.gatewayRefundIds, row.metadata?.gatewayAliasIds]) {
      if (Array.isArray(list)) list.forEach((id) => known.add(String(id)));
    }
  }
  return known;
}

async function tallied(
  tally: GatewayRefundSync,
  kind: "recorded" | "reversed",
  apply: () => Promise<number | boolean>,
) {
  tally.checked += 1;
  try {
    const result = await apply();
    if (typeof result === "number" ? result > 0 : result) tally[kind] += 1;
  } catch (error) {
    if (error instanceof RefundInFlightError) {
      tally.busy += 1;
      return;
    }
    tally.failed += 1;
    console.error("Refund sync could not apply a refund:", error);
  }
}

async function syncStripeRefunds(
  settings: Settings,
  now: Date,
  tally: GatewayRefundSync,
): Promise<GatewayRefundSync["status"]> {
  const { secretKey } = resolveStripeCredentials(settings.payment?.stripe);
  if (!secretKey) return "not_configured";
  const stripe = getStripeForSecretKey(secretKey);

  const live: Stripe.Refund[] = [];
  let seen = 0;
  for await (const refund of stripe.refunds.list({
    created: { gte: Math.floor((now.getTime() - REFUND_SYNC_LOOKBACK_MS) / 1000) },
    limit: PAGE_SIZE,
  })) {
    if (++seen > MAX_PAGES * PAGE_SIZE) break;
    if (DEAD_STATUSES.has(String(refund.status || ""))) {
      // Undone off the books if it was ever on them; nothing otherwise.
      await tallied(tally, "reversed", async () => await syncVendorSubscriptionRefunds({ payment_intent: refund.payment_intent }, stripe, now) || await reverseFailedOrderRefund(refund));
    } else {
      live.push(refund);
    }
  }

  // Only the charges holding a refund the books have never seen, and only on
  // a payment this store has: the account also carries other environments'
  // and abandoned checkouts' payments, which would otherwise be read back
  // from Stripe every hour for nothing. Each is read once and reconciled as
  // its `charge.refunded` event would have been.
  const known = await knownRefundIds(live.map((refund) => refund.id));
  const unknown = live.filter((refund) => !known.has(refund.id));
  const intentOf = (refund: Stripe.Refund) =>
    typeof refund.payment_intent === "string"
      ? refund.payment_intent
      : refund.payment_intent?.id || "";
  const intents = Array.from(new Set(unknown.map(intentOf).filter(Boolean)));
  const ours = new Set<string>();
  if (intents.length > 0) {
    const [orders, payments, subscriptions] = await Promise.all([
      Order.find({
        $or: [
          { stripePaymentIntentId: { $in: intents } },
          { paymentId: { $in: intents } },
          { preorderBalancePaymentIntentId: { $in: intents } },
        ],
      })
        .select("stripePaymentIntentId paymentId preorderBalancePaymentIntentId")
        .lean<
          Array<{
            stripePaymentIntentId?: string;
            paymentId?: string;
            preorderBalancePaymentIntentId?: string;
          }>
        >(),
      PlatformPayment.find({ stripePaymentIntentId: { $in: intents } })
        .select("stripePaymentIntentId")
        .lean<Array<{ stripePaymentIntentId?: string | null }>>(),
      VendorSubscriptionPayment.find({ provider: "stripe", providerPaymentIntentId: { $in: intents } }).select("providerPaymentIntentId").lean(),
    ]);
    for (const order of orders) {
      for (const id of [
        order.stripePaymentIntentId,
        order.paymentId,
        order.preorderBalancePaymentIntentId,
      ]) {
        if (id) ours.add(String(id));
      }
    }
    for (const subscription of subscriptions) {
      if (subscription.providerPaymentIntentId) ours.add(subscription.providerPaymentIntentId);
    }
    for (const payment of payments) {
      if (payment.stripePaymentIntentId) ours.add(String(payment.stripePaymentIntentId));
    }
  }
  const chargeIds = new Set<string>();
  for (const refund of unknown) {
    if (!ours.has(intentOf(refund))) continue;
    const chargeId =
      typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
    if (chargeId) chargeIds.add(chargeId);
  }
  for (const chargeId of chargeIds) {
    await tallied(tally, "recorded", async () => {
      const charge = await stripe.charges.retrieve(chargeId);
      const recorded = await reconcileStripeOrderRefunds(charge, stripe);
      // Or one of the marketplace's own payments — a boost, a subscription.
      const { processPlatformChargeRefunded } = await import("@/lib/boosts/boost-billing");
      const platform = await processPlatformChargeRefunded(charge);
      const subscription = await syncVendorSubscriptionRefunds(charge, stripe, now);
      return recorded > 0 || platform || subscription;
    });
  }
  return "synced";
}

async function syncRazorpayRefunds(
  settings: Settings,
  now: Date,
  tally: GatewayRefundSync,
): Promise<GatewayRefundSync["status"]> {
  const { keyId, keySecret } = resolveRazorpayCredentials(settings.payment?.razorpay);
  if (!keyId || !keySecret) return "not_configured";

  const from = Math.floor((now.getTime() - REFUND_SYNC_LOOKBACK_MS) / 1000);
  const to = Math.floor(now.getTime() / 1000);
  const listed = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const refunds = await listRazorpayRefunds({
      creds: { keyId, keySecret },
      from,
      to,
      count: PAGE_SIZE,
      skip: page * PAGE_SIZE,
    });
    listed.push(...refunds);
    if (refunds.length < PAGE_SIZE) break;
  }

  const known = await knownRefundIds(listed.map((refund) => refund.id));
  for (const refund of listed) {
    const status = String(refund.status || "").toLowerCase();
    if (status === "failed") {
      await tallied(tally, "reversed", () =>
        reverseFailedGatewayRefund(refund.id, {
          amount:
            typeof refund.amount === "number" && refund.currency
              ? fromRazorpayAmountSubunits(refund.amount, refund.currency)
              : undefined,
          currency: refund.currency || undefined,
        }),
      );
      continue;
    }
    if (known.has(refund.id)) continue;
    await tallied(tally, "recorded", async () => {
      const recorded = await reconcileGatewayRefundReading(readRazorpayRefund(refund));
      // Or one of the marketplace's own payments.
      const { syncRazorpayPlatformRefund } = await import(
        "@/lib/payments/platform-refund-sync"
      );
      const platform = refund.payment_id
        ? await syncRazorpayPlatformRefund({
            paymentId: refund.payment_id,
            creds: { keyId, keySecret },
          })
        : false;
      return recorded > 0 || platform;
    });
  }
  return "synced";
}

async function syncPaystackRefunds(
  settings: Settings,
  now: Date,
  tally: GatewayRefundSync,
): Promise<GatewayRefundSync["status"]> {
  const { secretKey } = resolvePaystackCredentials(settings.payment?.paystack);
  if (!secretKey) return "not_configured";

  const from = new Date(now.getTime() - REFUND_SYNC_LOOKBACK_MS);
  const listed = [];
  let pageCount = 1;
  for (let page = 1; page <= Math.min(pageCount, MAX_PAGES); page += 1) {
    const result = await listPaystackRefundsCreated({
      creds: { secretKey },
      from,
      to: now,
      page,
      perPage: PAGE_SIZE,
    });
    pageCount = result.pageCount;
    listed.push(...result.refunds);
  }

  const known = await knownRefundIds(listed.map((refund) => String(refund.id)));
  // A transaction is read in full once: its refunds are what the webhook
  // reconciles too, chargeback refunds included.
  const transactions = new Map<string, { id?: string; reference?: string }>();
  for (const refund of listed) {
    const status = String(refund.status || "").toLowerCase();
    if (status === "failed") {
      const currency = String(refund.currency || "");
      await tallied(tally, "reversed", () =>
        reverseFailedGatewayRefund(String(refund.id), {
          amount:
            typeof refund.amount === "number" && currency
              ? fromPaystackAmountSubunits(refund.amount, currency)
              : undefined,
          currency: currency || undefined,
        }),
      );
      continue;
    }
    if (known.has(String(refund.id))) continue;
    const transaction = refund.transaction;
    const id =
      transaction && typeof transaction === "object"
        ? String(transaction.id ?? "")
        : String(transaction ?? "");
    const reference =
      transaction && typeof transaction === "object"
        ? String(transaction.reference || refund.transaction_reference || "")
        : String(refund.transaction_reference || "");
    if (id || reference) transactions.set(id || reference, { id, reference });
  }
  for (const transaction of transactions.values()) {
    await tallied(tally, "recorded", async () => {
      const recorded = await reconcilePaystackRefunds({
        transaction,
        refunds: await listPaystackRefunds({ creds: { secretKey }, transaction }),
      });
      // Or one of the marketplace's own payments.
      const { syncPaystackPlatformRefund } = await import(
        "@/lib/payments/platform-refund-sync"
      );
      const platform = await syncPaystackPlatformRefund({ transaction, secretKey });
      return recorded > 0 || platform;
    });
  }
  return "synced";
}

/**
 * Ask every gateway that can list its refunds about the recent ones, and
 * apply each exactly as its webhook would. One gateway failing does not stop
 * the others.
 */
export async function syncGatewayRefunds(
  options: { now?: Date } = {},
): Promise<Record<RefundSyncGateway, GatewayRefundSync>> {
  await connectDB();
  const settings = await getSettings();
  const now = options.now ?? new Date();

  const run = async (
    sync: (
      settings: Settings,
      now: Date,
      tally: GatewayRefundSync,
    ) => Promise<GatewayRefundSync["status"]>,
  ): Promise<GatewayRefundSync> => {
    const tally: GatewayRefundSync = {
      status: "synced",
      checked: 0,
      recorded: 0,
      reversed: 0,
      busy: 0,
      failed: 0,
    };
    try {
      tally.status = await sync(settings, now, tally);
    } catch (error) {
      tally.status = "failed";
      tally.error = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    }
    return tally;
  };

  return {
    stripe: await run(syncStripeRefunds),
    razorpay: await run(syncRazorpayRefunds),
    paystack: await run(syncPaystackRefunds),
  };
}
