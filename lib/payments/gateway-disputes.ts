import "server-only";

import type Stripe from "stripe";
import { createHash, randomUUID } from "node:crypto";

import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  resolvePayPalCredentials,
  resolvePaystackCredentials,
  resolveRazorpayCredentials,
  resolveStripeCredentials,
} from "@/lib/settings/credentials";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import {
  fetchRazorpayDispute,
  listRazorpayDisputes,
} from "@/lib/payments/razorpay";
import {
  fetchPaystackDispute,
  fromPaystackAmountSubunits,
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
  readPaystackRefund,
  reconcileGatewayRefundReading,
  reconcilePaystackRefunds,
  reverseFailedGatewayRefund,
  type DisputeApplication,
} from "@/lib/orders/order-refund-sync";
import {
  paystackTransactionOf,
  paystackRefundDisputeId,
  readPayPalDispute,
  readPaystackDispute,
  readRazorpayDispute,
  readStripeDispute,
  type PayPalDisputeLike,
  type PaystackDisputeLike,
  type RazorpayDisputeLike,
} from "@/lib/orders/dispute-readings";
import { RefundInFlightError } from "@/lib/orders/refund-in-flight";
import {
  reconcileTrackedDispute,
  rememberGatewayDispute,
  DisputeReconciliationBusyError,
} from "@/lib/payments/dispute-reconciliation";
import type { GatewayDisputeReading } from "@/lib/orders/dispute-readings";

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

const NOT_MATCHED: DisputeApplication = {
  matched: false,
  recorded: 0,
  reversed: 0,
};

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Stripe: any `charge.dispute.*` event, applied from the dispute as Stripe has it now. */
export async function syncStripeDisputeEvent(
  stripe: Stripe,
  dispute: Stripe.Dispute,
): Promise<DisputeApplication> {
  if (!dispute.id) return NOT_MATCHED;
  return reconcileTrackedDispute({
    gateway: "stripe",
    disputeId: dispute.id,
    read: async () => {
      try {
        return {
          reading: readStripeDispute(
            await stripe.disputes.retrieve(dispute.id),
          ),
        };
      } catch (error) {
        const status = Number(
          (error as { statusCode?: number })?.statusCode || 0,
        );
        if (!status || status >= 500 || status === 429) throw error;
        console.warn(
          "Stripe dispute could not be read back; using the event's copy:",
          error,
        );
        return { reading: readStripeDispute(dispute), authoritative: false };
      }
    },
  });
}

/** Razorpay: any `payment.dispute.*` event. */
export async function syncRazorpayDisputeEvent(params: {
  dispute: RazorpayDisputeLike;
  settings: Settings;
}): Promise<DisputeApplication> {
  const creds = resolveRazorpayCredentials(params.settings.payment?.razorpay);
  const id = String(params.dispute.id || "");
  if (!id) return NOT_MATCHED;
  return reconcileTrackedDispute({
    gateway: "razorpay",
    disputeId: id,
    read: async () => {
      let dispute = params.dispute;
      let authoritative = false;
      // A webhook secret is all the webhook itself needs; reading the dispute back
      // also needs the API keys, and without them the event's copy is what there is.
      if (dispute.id && creds.keyId && creds.keySecret) {
        try {
          dispute = await fetchRazorpayDispute({
            creds: { keyId: creds.keyId, keySecret: creds.keySecret },
            disputeId: String(dispute.id),
          });
          authoritative = true;
        } catch (error) {
          if (isRetryableGatewayError(error)) throw error;
          console.warn(
            "Razorpay dispute could not be read back; using the event's copy:",
            error,
          );
        }
      }
      return { reading: readRazorpayDispute(dispute), authoritative };
    },
  });
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

/** A decision can precede the refund that settles it. Keep polling that gap. */
async function readPaystackWithRefunds(
  secretKey: string,
  dispute: PaystackDisputeLike,
  event?: string,
) {
  const refunds = await paystackDisputeRefunds(secretKey, dispute, event);
  const reading = readPaystackDispute(dispute, { event, refunds });
  const linked = (refunds || []).filter(
    (refund) => paystackRefundDisputeId(refund) === String(dispute.id),
  );
  const reconciliationPending =
    reading?.stage === "lost" &&
    (!linked.length ||
      linked.some(
        (refund) => String(refund.status || "").toLowerCase() !== "processed",
      ));
  return { reading, reconciliationPending };
}

/** Paystack: `charge.dispute.create`, `.remind` and `.resolve`. */
export async function syncPaystackDisputeEvent(params: {
  event: string;
  dispute: PaystackDisputeLike;
  secretKey: string;
}): Promise<DisputeApplication> {
  const id =
    params.dispute?.id === null || params.dispute?.id === undefined
      ? ""
      : String(params.dispute.id);
  if (!id) return NOT_MATCHED;
  return reconcileTrackedDispute({
    gateway: "paystack",
    disputeId: id,
    read: async () => {
      let dispute = params.dispute;
      let authoritative = true;
      try {
        dispute = await fetchPaystackDispute({
          creds: { secretKey: params.secretKey },
          disputeId: id,
        });
      } catch (error) {
        if (isRetryableGatewayError(error)) throw error;
        authoritative = false;
        console.warn(
          "Paystack dispute could not be read back; using the event's copy:",
          error,
        );
      }
      return {
        ...(await readPaystackWithRefunds(
          params.secretKey,
          dispute,
          params.event,
        )),
        authoritative,
      };
    },
  });
}

/** What a Paystack `refund.*` event carries. */
interface PaystackRefundEventData {
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
            id: params.refund.transaction.id
              ? String(params.refund.transaction.id)
              : null,
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
      console.warn(
        "Paystack refunds could not be listed; using the event's copy:",
        error,
      );
    }
  }
  if (refunds && refunds.length > 0) {
    return reconcilePaystackRefunds({ transaction, refunds });
  }

  if (params.event === "refund.failed") {
    if (params.refund.id) {
      const currency = String(params.refund.currency || "");
      await reverseFailedGatewayRefund(String(params.refund.id), {
        amount:
          typeof params.refund.amount === "number" && currency
            ? fromPaystackAmountSubunits(params.refund.amount, currency)
            : undefined,
        currency: currency || undefined,
      });
    }
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
  if (!params.disputeId) return NOT_MATCHED;
  return reconcileTrackedDispute({
    gateway: "paypal",
    disputeId: params.disputeId,
    read: async () => {
      let dispute: PayPalDisputeLike | null | undefined = params.resource;
      // Only a copy read from the Disputes API is trusted to say what money moved.
      let trusted = false;
      try {
        dispute = await fetchPayPalDispute({
          creds: params.creds,
          disputeId: params.disputeId,
        });
        trusted = true;
      } catch (error) {
        if (isRetryableGatewayError(error)) throw error;
        console.warn(
          "PayPal dispute could not be read back; its money is left alone:",
          error,
        );
      }
      return {
        reading: dispute
          ? readPayPalDispute(dispute, { movementsTrusted: trusted })
          : null,
        authoritative: trusted,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// The hourly sync
// ---------------------------------------------------------------------------

/** Discovery is recent; follow-up has no creation-date or age cutoff. */
const DISPUTE_SYNC_LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;
const PAYPAL_DISPUTE_SYNC_UPDATED_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 10;
const PAGE_SIZE = 100;
const FOLLOWUP_LIMIT = 100;
const CHECKPOINT_LEASE_MS = 20 * 60 * 1000;

type ReadDispute = () => Promise<{
  reading: GatewayDisputeReading | null;
  authoritative?: boolean;
  reconciliationPending?: boolean;
}>;
interface DiscoveryPage {
  entries: Array<{ id: string; read: ReadDispute }>;
  more: boolean;
  drained?: boolean;
  progress: {
    cursor?: string;
    offset?: number;
    page?: number;
    next?: string;
    itemOffset?: number;
  };
}
interface Checkpoint {
  _id: unknown;
  since: Date;
  until: Date;
  cursor?: string;
  offset: number;
  page: number;
  itemOffset: number;
  historyScan?: boolean;
  lastHistoryAt?: Date;
  next?: string;
  complete: boolean;
  credentialFingerprint?: string;
  legacyCursor?: unknown;
}
interface Provider {
  fingerprint: string;
  lookback: number;
  read: (id: string) => ReturnType<ReadDispute>;
  list: (checkpoint: Checkpoint) => Promise<DiscoveryPage>;
}
export interface GatewayDisputeSync {
  status: "synced" | "continuing" | "not_configured" | "failed";
  checked: number;
  matched: number;
  recorded: number;
  reversed: number;
  busy: number;
  failed: number;
  followedUp: number;
  pending: number;
  due: number;
  /** Discovery drained its fixed window; false means a saved continuation. */
  discoveryComplete?: boolean;
  /** Bounded samples; all failed IDs remain in durable reconciliation tracking. */
  failureDetails?: Array<{ recordId: string; error: string }>;
  error?: string;
}

const fingerprint = (...values: string[]) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

function providerFor(
  gateway: DisputeGateway,
  settings: Settings,
): Provider | null {
  if (gateway === "stripe") {
    const { secretKey } = resolveStripeCredentials(settings.payment?.stripe);
    if (!secretKey) return null;
    const stripe = getStripeForSecretKey(secretKey);
    return {
      fingerprint: fingerprint(secretKey),
      lookback: DISPUTE_SYNC_LOOKBACK_MS,
      read: async (id) => ({
        reading: readStripeDispute(await stripe.disputes.retrieve(id)),
      }),
      list: async (checkpoint) => {
        const page = await stripe.disputes.list({
          limit: PAGE_SIZE,
          created: {
            gte: Math.floor(checkpoint.since.getTime() / 1000),
            lte: Math.floor(checkpoint.until.getTime() / 1000),
          },
          ...(checkpoint.cursor ? { starting_after: checkpoint.cursor } : {}),
        });
        if (!Array.isArray(page.data) || typeof page.has_more !== "boolean")
          throw new Error("Stripe returned an invalid dispute page");
        return {
          entries: page.data.map((dispute) => ({
            id: dispute.id,
            read: async () => ({ reading: readStripeDispute(dispute) }),
          })),
          more: page.has_more,
          progress: { cursor: page.data.at(-1)?.id },
        };
      },
    };
  }
  if (gateway === "razorpay") {
    const { keyId, keySecret } = resolveRazorpayCredentials(
      settings.payment?.razorpay,
    );
    if (!keyId || !keySecret) return null;
    const creds = { keyId, keySecret };
    return {
      fingerprint: fingerprint(keyId, keySecret),
      lookback: DISPUTE_SYNC_LOOKBACK_MS,
      read: async (id) => ({
        reading: readRazorpayDispute(
          await fetchRazorpayDispute({ creds, disputeId: id }),
        ),
      }),
      list: async (checkpoint) => {
        const disputes = await listRazorpayDisputes({
          creds,
          count: PAGE_SIZE,
          skip: checkpoint.offset,
          from: Math.floor(checkpoint.since.getTime() / 1000),
          to: Math.floor(checkpoint.until.getTime() / 1000),
        });
        return {
          entries: disputes.map((dispute) => ({
            id: String(dispute.id || ""),
            read: async () => ({ reading: readRazorpayDispute(dispute) }),
          })),
          more: disputes.length === PAGE_SIZE,
          progress: { offset: checkpoint.offset + disputes.length },
        };
      },
    };
  }
  if (gateway === "paystack") {
    const { secretKey } = resolvePaystackCredentials(
      settings.payment?.paystack,
    );
    if (!secretKey) return null;
    const read = (dispute: PaystackDisputeLike) =>
      readPaystackWithRefunds(secretKey, dispute);
    return {
      fingerprint: fingerprint(secretKey),
      lookback: DISPUTE_SYNC_LOOKBACK_MS,
      read: async (id) =>
        read(
          await fetchPaystackDispute({ creds: { secretKey }, disputeId: id }),
        ),
      list: async (checkpoint) => {
        const listed = await listPaystackDisputes({
          creds: { secretKey },
          from: checkpoint.since,
          to: checkpoint.until,
          page: checkpoint.page,
          perPage: PAGE_SIZE,
        });
        if (!Number.isSafeInteger(listed.pageCount) || listed.pageCount < 1)
          throw new Error("Paystack returned invalid dispute pagination");
        return {
          entries: listed.disputes
            .slice(checkpoint.itemOffset || 0)
            .map((dispute) => ({
              id: String(dispute.id ?? ""),
              read: () => read(dispute),
            })),
          more: checkpoint.page < listed.pageCount,
          drained:
            (checkpoint.itemOffset || 0) > 0 &&
            listed.disputes.length >= checkpoint.itemOffset,
          progress: { page: checkpoint.page + 1, itemOffset: 0 },
        };
      },
    };
  }
  const resolved = resolvePayPalCredentials(settings.payment?.paypal);
  if (!resolved.clientId || !resolved.clientSecret) return null;
  const creds: PayPalCredentials = {
    clientId: resolved.clientId,
    clientSecret: resolved.clientSecret,
    mode: resolved.mode,
  };
  return {
    fingerprint: fingerprint(creds.clientId, creds.clientSecret, creds.mode),
    lookback: PAYPAL_DISPUTE_SYNC_UPDATED_WITHIN_MS,
    read: async (id) => ({
      reading: readPayPalDispute(
        await fetchPayPalDispute({ creds, disputeId: id }),
        { movementsTrusted: true },
      ),
    }),
    list: async (checkpoint) => {
      const listed = await listPayPalDisputes({
        creds,
        ...(checkpoint.next
          ? { next: checkpoint.next }
          : {
              updatedAfter: checkpoint.since,
              updatedBefore: checkpoint.until,
            }),
      });
      return {
        entries: listed.items.slice(checkpoint.itemOffset || 0).map((item) => ({
          id: String(item.dispute_id || ""),
          read: async () => ({
            reading: readPayPalDispute(
              await fetchPayPalDispute({
                creds,
                disputeId: String(item.dispute_id),
                token: listed.token,
              }),
              { movementsTrusted: true },
            ),
          }),
        })),
        more: Boolean(listed.next),
        drained:
          (checkpoint.itemOffset || 0) > 0 &&
          listed.items.length >= checkpoint.itemOffset,
        progress: { next: listed.next || "", itemOffset: 0 },
      };
    },
  };
}

/** Existing monetary rows and pending PayPal reviews are enrolled on upgrade. */
async function rememberLegacyDisputes(
  gateway: DisputeGateway,
  checkpoint: Checkpoint,
  owner: string,
  now: Date,
) {
  const { GatewayDisputeCheckpoint } = await import(
    "@/models/gateway-dispute-reconciliation.model"
  );
  const { PaymentTransaction } = await import(
    "@/models/payment-transaction.model"
  );
  const rows = await PaymentTransaction.find({
    type: "refund",
    ...(checkpoint.legacyCursor
      ? { _id: { $gt: checkpoint.legacyCursor } }
      : {}),
    $or: [
      { "metadata.dispute.gateway": gateway },
      { "metadata.paypalMatchReview.reading.gateway": gateway },
    ],
  })
    .sort({ _id: 1 })
    .limit(200)
    .select("metadata")
    .lean<
      Array<{
        _id: unknown;
        metadata?: {
          dispute?: { id?: string; key?: string };
          paypalMatchReview?: { reading?: { disputeId?: string } };
        };
      }>
    >();
  for (const row of rows) {
    const id =
      row.metadata?.dispute?.id ||
      row.metadata?.paypalMatchReview?.reading?.disputeId ||
      row.metadata?.dispute?.key?.replace(/^paystack-dispute:/, "");
    if (id) await rememberGatewayDispute(gateway, String(id), now);
  }
  if (rows.length || checkpoint.legacyCursor) {
    const saved = await GatewayDisputeCheckpoint.updateOne(
      { _id: checkpoint._id, leaseOwner: owner },
      { $set: { legacyCursor: rows.length === 200 ? rows.at(-1)!._id : null } },
    );
    if (!saved.matchedCount) throw new DisputeReconciliationBusyError();
  }
}

async function syncProvider(
  gateway: DisputeGateway,
  provider: Provider,
  now: Date,
  tally: GatewayDisputeSync,
  maxPages: number,
  followupLimit: number,
  budgetMs: number,
) {
  const { GatewayDisputeCheckpoint, GatewayDisputeReconciliation } =
    await import("@/models/gateway-dispute-reconciliation.model");
  await GatewayDisputeCheckpoint.updateOne(
    { gateway },
    { $setOnInsert: { gateway, complete: true } },
    { upsert: true },
  );
  const owner = randomUUID();
  const leased = await GatewayDisputeCheckpoint.findOneAndUpdate(
    {
      gateway,
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }],
    },
    {
      $set: {
        leaseOwner: owner,
        leaseUntil: new Date(Date.now() + CHECKPOINT_LEASE_MS),
      },
    },
    { returnDocument: "after" },
  ).lean<Checkpoint | null>();
  if (!leased) {
    tally.busy += 1;
    return "continuing" as const;
  }
  let checkpoint: Checkpoint = leased;
  tally.discoveryComplete = false;
  const checkpointId = checkpoint._id;
  const save = async (changes: Record<string, unknown>) => {
    const written = await GatewayDisputeCheckpoint.updateOne(
      { _id: checkpointId, leaseOwner: owner },
      {
        $set: {
          ...changes,
          lastRunAt: now,
          leaseUntil: new Date(Date.now() + CHECKPOINT_LEASE_MS),
        },
      },
    );
    if (!written.matchedCount) throw new DisputeReconciliationBusyError();
  };
  const started = Date.now();
  const outOfTime = () => Date.now() - started >= budgetMs;
  const seen = new Set<string>();
  const attempt = async (id: string, read: ReadDispute) => {
    if (!id) throw new Error("Provider returned a dispute without an id");
    if (seen.has(id)) return;
    seen.add(id);
    tally.checked += 1;
    await rememberGatewayDispute(gateway, id, now);
    try {
      const applied = await reconcileTrackedDispute({
        gateway,
        disputeId: id,
        now,
        quietHistory: true,
        read,
      });
      if (applied.matched) tally.matched += 1;
      if (applied.recorded > 0) tally.recorded += 1;
      if (applied.reversed > 0) tally.reversed += 1;
    } catch (error) {
      if (
        error instanceof RefundInFlightError ||
        error instanceof DisputeReconciliationBusyError
      )
        tally.busy += 1;
      else {
        tally.failed += 1;
        const details = (tally.failureDetails ??= []);
        if (details.length < 5)
          details.push({
            recordId: id,
            error: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 300),
          });
        console.error(
          "Dispute sync could not reconcile a dispute:",
          gateway,
          id,
          error,
        );
        // Applying/fetching can fail, but the page may only advance if that
        // dispute remains durably due for an ID-based retry.
        await GatewayDisputeReconciliation.updateOne(
          { gateway, disputeId: id },
          { $min: { nextCheckAt: new Date(now.getTime() + 60_000) } },
        );
      }
    }
  };
  try {
    await rememberLegacyDisputes(gateway, checkpoint, owner, now);
    const due = await GatewayDisputeReconciliation.find({
      gateway,
      nextCheckAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }],
    })
      .sort({ nextCheckAt: 1, _id: 1 })
      .limit(followupLimit)
      .select("disputeId")
      .lean<Array<{ disputeId: string }>>();
    for (const row of due) {
      if (Date.now() - started >= budgetMs / 2) break;
      tally.followedUp += 1;
      await attempt(row.disputeId, () => provider.read(row.disputeId));
    }
    if (
      checkpoint.complete ||
      checkpoint.credentialFingerprint !== provider.fingerprint
    ) {
      // Frozen bounds keep offset/page pagination stable as new disputes
      // arrive. If an old scan took longer than the lookback, cover the gap.
      const historyScan =
        gateway !== "paypal" &&
        (!checkpoint.lastHistoryAt ||
          checkpoint.credentialFingerprint !== provider.fingerprint ||
          now.getTime() - checkpoint.lastHistoryAt.getTime() >=
            7 * 24 * 60 * 60 * 1000);
      const since = historyScan
        ? new Date(0)
        : new Date(
            Math.min(
              now.getTime() - provider.lookback,
              checkpoint.until?.getTime() ?? now.getTime(),
            ),
          );
      checkpoint = {
        ...checkpoint,
        since,
        until: now,
        cursor: "",
        next: "",
        offset: 0,
        page: 1,
        itemOffset: 0,
        historyScan,
        complete: false,
        credentialFingerprint: provider.fingerprint,
      };
      await save({
        since,
        until: now,
        cursor: "",
        next: "",
        offset: 0,
        page: 1,
        itemOffset: 0,
        historyScan,
        complete: false,
        credentialFingerprint: provider.fingerprint,
      });
    }
    for (let page = 0; page < maxPages; page += 1) {
      if (outOfTime()) break;
      let listed: DiscoveryPage;
      try {
        listed = await provider.list(checkpoint);
      } catch (error) {
        const status = Number(
          (error as { statusCode?: number; status?: number }).statusCode ||
            (error as { status?: number }).status ||
            0,
        );
        const hasContinuation =
          checkpoint.cursor ||
          checkpoint.next ||
          checkpoint.offset ||
          checkpoint.page > 1 ||
          checkpoint.itemOffset;
        if (
          hasContinuation &&
          [400, 404, 422].includes(status) &&
          /cursor|starting_after|next.page|page.token|pagination|skip/i.test(
            String(error),
          )
        ) {
          // Provider cursors can expire or refer to a deleted object. The
          // fixed window is safe to replay: all advanced IDs remain tracked.
          const reset = {
            cursor: "",
            next: "",
            offset: 0,
            page: 1,
            itemOffset: 0,
          };
          await save(reset);
          checkpoint = { ...checkpoint, ...reset };
          tally.error =
            "Provider continuation expired; the same bounded window will be replayed";
          continue;
        }
        throw error;
      }
      if (listed.more && !listed.entries.length && !listed.drained)
        throw new Error("Provider returned an empty continuing dispute page");
      const originalCursor = checkpoint.cursor;
      const originalNext = checkpoint.next;
      let stopped = false;
      for (const entry of listed.entries) {
        if (outOfTime()) {
          stopped = true;
          break;
        }
        await attempt(entry.id, entry.read);
        const progress: DiscoveryPage["progress"] =
          gateway === "stripe"
            ? { cursor: entry.id }
            : gateway === "razorpay"
              ? { offset: checkpoint.offset + 1 }
              : { itemOffset: (checkpoint.itemOffset || 0) + 1 };
        await save(progress);
        checkpoint = { ...checkpoint, ...progress };
      }
      if (stopped) break;
      if (
        listed.more &&
        listed.progress.cursor === originalCursor &&
        gateway === "stripe"
      )
        throw new Error("Stripe dispute cursor did not advance");
      if (
        listed.more &&
        listed.progress.next === originalNext &&
        gateway === "paypal"
      )
        throw new Error("PayPal dispute cursor did not advance");
      await save({
        ...listed.progress,
        complete: !listed.more,
        ...(!listed.more && checkpoint.historyScan
          ? { lastHistoryAt: now }
          : {}),
      });
      checkpoint = {
        ...checkpoint,
        ...listed.progress,
        complete: !listed.more,
      };
      if (!listed.more) break;
    }
    tally.pending = await GatewayDisputeReconciliation.countDocuments({
      gateway,
      state: "pending",
    });
    tally.due = await GatewayDisputeReconciliation.countDocuments({
      gateway,
      nextCheckAt: { $lte: now },
    });
    tally.discoveryComplete = checkpoint.complete;
    return checkpoint.complete &&
      !tally.busy &&
      !tally.failed &&
      !tally.pending &&
      !tally.due
      ? ("synced" as const)
      : ("continuing" as const);
  } finally {
    await GatewayDisputeCheckpoint.updateOne(
      { _id: checkpointId, leaseOwner: owner },
      { $unset: { leaseOwner: "", leaseUntil: "" } },
    );
  }
}

/** Durable follow-up first, then bounded discovery continued from its checkpoint. */
export async function syncGatewayDisputes(
  options: {
    now?: Date;
    maxPages?: number;
    followupLimit?: number;
    budgetMs?: number;
  } = {},
): Promise<Record<DisputeGateway, GatewayDisputeSync>> {
  await connectDB();
  const settings = await getSettings();
  const now = options.now ?? new Date();
  const maxPages = Math.min(
    MAX_PAGES,
    Math.max(1, options.maxPages ?? MAX_PAGES),
  );
  const followupLimit = Math.min(
    FOLLOWUP_LIMIT,
    Math.max(1, options.followupLimit ?? FOLLOWUP_LIMIT),
  );
  const run = async (gateway: DisputeGateway): Promise<GatewayDisputeSync> => {
    const tally: GatewayDisputeSync = {
      status: "synced",
      checked: 0,
      matched: 0,
      recorded: 0,
      reversed: 0,
      busy: 0,
      failed: 0,
      followedUp: 0,
      pending: 0,
      due: 0,
    };
    try {
      const provider = providerFor(gateway, settings);
      tally.status = provider
        ? await syncProvider(
            gateway,
            provider,
            now,
            tally,
            maxPages,
            followupLimit,
            Math.max(1, options.budgetMs ?? 45_000),
          )
        : "not_configured";
    } catch (error) {
      if (
        error instanceof RefundInFlightError ||
        error instanceof DisputeReconciliationBusyError
      ) {
        tally.status = "continuing";
        tally.busy += 1;
        return tally;
      }
      tally.status = "failed";
      tally.error = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 300);
      console.error("Dispute sync gateway failed:", gateway, error);
    }
    return tally;
  };
  return {
    stripe: await run("stripe"),
    razorpay: await run("razorpay"),
    paystack: await run("paystack"),
    paypal: await run("paypal"),
  };
}
