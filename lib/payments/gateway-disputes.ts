import "server-only";

import type Stripe from "stripe";

import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  resolvePayPalCredentials,
  resolvePaystackCredentials,
  resolveRazorpayCredentials,
  resolveStripeCredentials,
} from "@/lib/settings/credentials";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import { fetchRazorpayDispute, listRazorpayDisputes } from "@/lib/payments/razorpay";
import {
  fetchPaystackDispute,
  listPaystackDisputes,
  listPaystackRefunds,
  type PaystackRefund,
} from "@/lib/payments/paystack";
import {
  fetchPayPalDispute,
  listPayPalDisputes,
  type PayPalCredentials,
} from "@/lib/payments/paypal";
import { isRetryableGatewayError } from "@/lib/payments/gateway-api-error";
import type { DisputeGateway } from "@/lib/payments/dispute-gateways";
import {
  applyGatewayDispute,
  readPaystackRefund,
  reconcileGatewayRefundReading,
  reconcilePaystackRefunds,
  reverseFailedGatewayRefund,
  type DisputeApplication,
} from "@/lib/orders/order-refund-sync";
import {
  paystackTransactionOf,
  readPayPalDispute,
  readPaystackDispute,
  readRazorpayDispute,
  readStripeDispute,
  type PayPalDisputeLike,
  type PaystackDisputeLike,
  type RazorpayDisputeLike,
} from "@/lib/orders/dispute-readings";
import { RefundInFlightError } from "@/lib/orders/refund-in-flight";

/**
 * Every way a gateway's dispute reaches the books: its webhook, and an hourly
 * sync that asks the gateway itself.
 *
 * Both read the dispute AS IT STANDS NOW before acting. A webhook carries a
 * snapshot from when it was sent, deliveries arrive out of order, and an older
 * snapshot applied after a newer one would undo a decision — so a payload only
 * says which dispute to look at. When the gateway refuses to be asked (an app
 * without the Disputes permission, an id it will not return), the payload is
 * used, under the readers' rule that a copy which cannot say what money moved
 * changes nothing. When the gateway cannot be reached, the delivery fails and
 * is sent again.
 *
 * No credential is needed beyond what the gateway's payments already use. A
 * gateway without credentials is reported by the sync as not configured, and
 * starts being synced the moment they are added.
 */

type Settings = Awaited<ReturnType<typeof getSettings>>;

const NOT_MATCHED: DisputeApplication = { matched: false, recorded: 0, reversed: 0 };

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Stripe: any `charge.dispute.*` event, applied from the dispute as Stripe has it now. */
export async function syncStripeDisputeEvent(
  stripe: Stripe,
  dispute: Stripe.Dispute,
): Promise<DisputeApplication> {
  let current: Stripe.Dispute = dispute;
  try {
    current = await stripe.disputes.retrieve(dispute.id);
  } catch (error) {
    const status = Number((error as { statusCode?: number })?.statusCode || 0);
    if (!status || status >= 500 || status === 429) throw error;
    console.warn("Stripe dispute could not be read back; using the event's copy:", error);
  }
  return applyGatewayDispute(readStripeDispute(current));
}

/** Razorpay: any `payment.dispute.*` event. */
export async function syncRazorpayDisputeEvent(params: {
  dispute: RazorpayDisputeLike;
  settings: Settings;
}): Promise<DisputeApplication> {
  const creds = resolveRazorpayCredentials(params.settings.payment?.razorpay);
  let dispute = params.dispute;
  // A webhook secret is all the webhook itself needs; reading the dispute back
  // also needs the API keys, and without them the event's copy is what there is.
  if (dispute.id && creds.keyId && creds.keySecret) {
    try {
      dispute = await fetchRazorpayDispute({
        creds: { keyId: creds.keyId, keySecret: creds.keySecret },
        disputeId: String(dispute.id),
      });
    } catch (error) {
      if (isRetryableGatewayError(error)) throw error;
      console.warn("Razorpay dispute could not be read back; using the event's copy:", error);
    }
  }
  return applyGatewayDispute(readRazorpayDispute(dispute));
}

/**
 * The refunds Paystack raised for a decided dispute — the money an accepted
 * chargeback actually moved. Null when the dispute is not decided, or Paystack
 * refused the question; the reader then goes by the accepted amount.
 */
async function paystackDisputeRefunds(
  secretKey: string,
  dispute: PaystackDisputeLike,
  event?: string,
): Promise<PaystackRefund[] | null> {
  const resolved =
    String(dispute.status || "").toLowerCase() === "resolved" ||
    event === "charge.dispute.resolve";
  if (!resolved) return null;
  const transaction = paystackTransactionOf(dispute);
  if (!transaction.id && !transaction.reference) return null;
  try {
    return await listPaystackRefunds({ creds: { secretKey }, transaction });
  } catch (error) {
    if (isRetryableGatewayError(error)) throw error;
    console.warn("Paystack refunds for a dispute could not be listed:", error);
    return null;
  }
}

/** Paystack: `charge.dispute.create`, `.remind` and `.resolve`. */
export async function syncPaystackDisputeEvent(params: {
  event: string;
  dispute: PaystackDisputeLike;
  secretKey: string;
}): Promise<DisputeApplication> {
  let dispute = params.dispute;
  const id =
    dispute?.id === null || dispute?.id === undefined ? "" : String(dispute.id);
  if (!id) return NOT_MATCHED;
  try {
    dispute = await fetchPaystackDispute({
      creds: { secretKey: params.secretKey },
      disputeId: id,
    });
  } catch (error) {
    if (isRetryableGatewayError(error)) throw error;
    console.warn("Paystack dispute could not be read back; using the event's copy:", error);
  }
  const refunds = await paystackDisputeRefunds(params.secretKey, dispute, params.event);
  return applyGatewayDispute(
    readPaystackDispute(dispute, { event: params.event, refunds }),
  );
}

/** What a Paystack `refund.*` event carries. */
export interface PaystackRefundEventData {
  id?: unknown;
  status?: string;
  amount?: number | string;
  currency?: string;
  transaction_reference?: string;
  transaction?: { id?: unknown; reference?: string } | null;
}

/**
 * Paystack: a `refund.*` event, reconciled from the transaction's refunds as
 * its API lists them — which name the refund's id and, for an accepted
 * chargeback, its dispute, where the event's own payload may name neither.
 * The payload is the fallback when the API cannot be asked.
 */
export async function syncPaystackRefundEvent(params: {
  event: string;
  refund: PaystackRefundEventData;
  secretKey: string;
}): Promise<number> {
  const transaction = paystackTransactionOf({
    transaction:
      params.refund.transaction && typeof params.refund.transaction === "object"
        ? {
            id: params.refund.transaction.id ? String(params.refund.transaction.id) : null,
            reference: params.refund.transaction.reference || null,
          }
        : null,
    transaction_reference: params.refund.transaction_reference || null,
  });

  let refunds: PaystackRefund[] | null = null;
  if (transaction.id || transaction.reference) {
    try {
      refunds = await listPaystackRefunds({
        creds: { secretKey: params.secretKey },
        transaction,
      });
    } catch (error) {
      // Without the refund's own id the payload cannot record anything, so an
      // outage is worth a retry rather than a refund lost.
      if (!params.refund.id && isRetryableGatewayError(error)) throw error;
      console.warn("Paystack refunds could not be listed; using the event's copy:", error);
    }
  }
  if (refunds && refunds.length > 0) {
    return reconcilePaystackRefunds({ transaction, refunds });
  }

  if (params.event === "refund.failed") {
    if (params.refund.id) await reverseFailedGatewayRefund(String(params.refund.id));
    return 0;
  }
  return reconcileGatewayRefundReading(readPaystackRefund(params.refund));
}

/** PayPal: `CUSTOMER.DISPUTE.CREATED`, `.UPDATED` and `.RESOLVED`. */
export async function syncPayPalDisputeEvent(params: {
  disputeId: string;
  resource?: PayPalDisputeLike | null;
  creds: PayPalCredentials;
}): Promise<DisputeApplication> {
  let dispute: PayPalDisputeLike | null | undefined = params.resource;
  // Only a copy read from the Disputes API is trusted to say what money moved.
  let trusted = false;
  try {
    dispute = await fetchPayPalDispute({ creds: params.creds, disputeId: params.disputeId });
    trusted = true;
  } catch (error) {
    if (isRetryableGatewayError(error)) throw error;
    console.warn("PayPal dispute could not be read back; its money is left alone:", error);
  }
  if (!dispute) return NOT_MATCHED;
  return applyGatewayDispute(readPayPalDispute(dispute, { movementsTrusted: trusted }));
}

// ---------------------------------------------------------------------------
// The hourly sync
// ---------------------------------------------------------------------------

/**
 * How far back the sync looks, by when a dispute was opened. A card dispute
 * can take four months to decide, and a decision on an old dispute is exactly
 * what a missed webhook loses.
 */
export const DISPUTE_SYNC_LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;

/** PayPal filters by last update instead, which catches a decision on any dispute. */
export const PAYPAL_DISPUTE_SYNC_UPDATED_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_PAGES = 10;

/** The sync reads months of disputes; only what changed the books is news. */
const SYNC_OPTIONS = { quietHistory: true };

export interface GatewayDisputeSync {
  status: "synced" | "not_configured" | "failed";
  checked: number;
  /** Disputes on one of this store's orders. */
  matched: number;
  /** Disputes that recorded a chargeback this run. */
  recorded: number;
  /** Disputes that gave money back this run. */
  reversed: number;
  /** Left for the next run because a refund was being recorded on the order. */
  busy: number;
  failed: number;
  error?: string;
}

async function applyTallied(
  tally: GatewayDisputeSync,
  apply: () => Promise<DisputeApplication>,
) {
  tally.checked += 1;
  try {
    const applied = await apply();
    if (applied.matched) tally.matched += 1;
    if (applied.recorded > 0) tally.recorded += 1;
    if (applied.reversed > 0) tally.reversed += 1;
  } catch (error) {
    if (error instanceof RefundInFlightError) {
      tally.busy += 1;
      return;
    }
    tally.failed += 1;
    console.error("Dispute sync could not apply a dispute:", error);
  }
}

async function syncStripeDisputes(
  settings: Settings,
  now: Date,
  tally: GatewayDisputeSync,
): Promise<GatewayDisputeSync["status"]> {
  const { secretKey } = resolveStripeCredentials(settings.payment?.stripe);
  if (!secretKey) return "not_configured";
  const stripe = getStripeForSecretKey(secretKey);

  let seen = 0;
  for await (const dispute of stripe.disputes.list({
    created: { gte: Math.floor((now.getTime() - DISPUTE_SYNC_LOOKBACK_MS) / 1000) },
    limit: 100,
  })) {
    if (++seen > MAX_PAGES * 100) break;
    await applyTallied(tally, () =>
      applyGatewayDispute(readStripeDispute(dispute), SYNC_OPTIONS),
    );
  }
  return "synced";
}

async function syncRazorpayDisputes(
  settings: Settings,
  now: Date,
  tally: GatewayDisputeSync,
): Promise<GatewayDisputeSync["status"]> {
  const { keyId, keySecret } = resolveRazorpayCredentials(settings.payment?.razorpay);
  if (!keyId || !keySecret) return "not_configured";

  const from = Math.floor((now.getTime() - DISPUTE_SYNC_LOOKBACK_MS) / 1000);
  const to = Math.floor(now.getTime() / 1000);
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const disputes = await listRazorpayDisputes({
      creds: { keyId, keySecret },
      from,
      to,
      count: 100,
      skip: page * 100,
    });
    for (const dispute of disputes) {
      await applyTallied(tally, () =>
        applyGatewayDispute(readRazorpayDispute(dispute), SYNC_OPTIONS),
      );
    }
    if (disputes.length < 100) break;
  }
  return "synced";
}

async function syncPaystackDisputes(
  settings: Settings,
  now: Date,
  tally: GatewayDisputeSync,
): Promise<GatewayDisputeSync["status"]> {
  const { secretKey } = resolvePaystackCredentials(settings.payment?.paystack);
  if (!secretKey) return "not_configured";

  const from = new Date(now.getTime() - DISPUTE_SYNC_LOOKBACK_MS);
  let pageCount = 1;
  for (let page = 1; page <= Math.min(pageCount, MAX_PAGES); page += 1) {
    const listed = await listPaystackDisputes({
      creds: { secretKey },
      from,
      to: now,
      page,
      perPage: 100,
    });
    pageCount = listed.pageCount;
    for (const dispute of listed.disputes) {
      await applyTallied(tally, async () =>
        applyGatewayDispute(
          readPaystackDispute(dispute, {
            refunds: await paystackDisputeRefunds(secretKey, dispute),
          }),
          SYNC_OPTIONS,
        ),
      );
    }
  }
  return "synced";
}

async function syncPayPalDisputes(
  settings: Settings,
  now: Date,
  tally: GatewayDisputeSync,
): Promise<GatewayDisputeSync["status"]> {
  const resolved = resolvePayPalCredentials(settings.payment?.paypal);
  if (!resolved.clientId || !resolved.clientSecret) return "not_configured";
  const creds: PayPalCredentials = {
    clientId: resolved.clientId,
    clientSecret: resolved.clientSecret,
    mode: resolved.mode,
  };

  let page = await listPayPalDisputes({
    creds,
    updatedAfter: new Date(now.getTime() - PAYPAL_DISPUTE_SYNC_UPDATED_WITHIN_MS),
  });
  for (let count = 0; count < MAX_PAGES; count += 1) {
    for (const item of page.items) {
      const disputeId = String(item.dispute_id || "");
      if (!disputeId) continue;
      await applyTallied(tally, async () =>
        applyGatewayDispute(
          readPayPalDispute(
            await fetchPayPalDispute({ creds, disputeId, token: page.token }),
            { movementsTrusted: true },
          ),
          SYNC_OPTIONS,
        ),
      );
    }
    if (!page.next) break;
    page = await listPayPalDisputes({ creds, next: page.next, token: page.token });
  }
  return "synced";
}

/**
 * Ask every gateway with credentials about its recent disputes, and apply
 * each one exactly as its webhook would.
 *
 * Applying a dispute twice changes nothing the second time, so this re-reads
 * the whole window every run rather than remembering where it stopped — there
 * is no cursor to lose. One gateway failing does not stop the others.
 */
export async function syncGatewayDisputes(
  options: { now?: Date } = {},
): Promise<Record<DisputeGateway, GatewayDisputeSync>> {
  await connectDB();
  const settings = await getSettings();
  const now = options.now ?? new Date();

  const run = async (
    sync: (
      settings: Settings,
      now: Date,
      tally: GatewayDisputeSync,
    ) => Promise<GatewayDisputeSync["status"]>,
  ): Promise<GatewayDisputeSync> => {
    const tally: GatewayDisputeSync = {
      status: "synced",
      checked: 0,
      matched: 0,
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
    stripe: await run(syncStripeDisputes),
    razorpay: await run(syncRazorpayDisputes),
    paystack: await run(syncPaystackDisputes),
    paypal: await run(syncPayPalDisputes),
  };
}
