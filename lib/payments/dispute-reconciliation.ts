import "server-only";
import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/db";
import type { DisputeGateway } from "@/lib/payments/dispute-gateways";
import type { GatewayDisputeReading } from "@/lib/orders/dispute-readings";
import {
  applyGatewayDispute,
  type DisputeApplication,
} from "@/lib/orders/order-refund-sync";
import { isGatewayNotFoundError } from "@/lib/payments/gateway-api-error";
import {
  DISPUTE_GATEWAY_LABEL,
  DISPUTE_RESPONSE_PLACE,
} from "@/lib/payments/dispute-gateways";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LEASE_MS = 10 * 60 * 1000;
/** An order can still be linking to its payment shortly after the dispute opens. */
export const UNMATCHED_GRACE_MS = DAY;
const ORPHAN_RECHECK_MS = 7 * DAY;

/**
 * How often to look again at a dispute nothing in this store owns: hourly while
 * an order may still be linking, then daily, then weekly. It is not work left
 * undone, only a dispute that might yet be claimed.
 */
export function unmatchedRecheckMs(ageMs: number): number {
  if (ageMs < UNMATCHED_GRACE_MS) return HOUR;
  return ageMs < 14 * DAY ? DAY : 7 * DAY;
}
export class DisputeReconciliationBusyError extends Error {
  constructor() {
    super("This dispute is already being reconciled; retry later");
    this.name = "DisputeReconciliationBusyError";
  }
}

/** Enrol before fetching/applying, and never postpone an already-due retry. */
export async function rememberGatewayDispute(
  gateway: DisputeGateway,
  disputeId: string,
  now = new Date(),
) {
  await connectDB();
  const { GatewayDisputeReconciliation } = await import(
    "@/models/gateway-dispute-reconciliation.model"
  );
  await GatewayDisputeReconciliation.updateOne(
    { gateway, disputeId },
    {
      $setOnInsert: { gateway, disputeId, state: "pending", nextCheckAt: now },
    },
    { upsert: true },
  );
}

/**
 * Open cases are checked hourly, failures after a minute, and complete cases
 * daily without an age cutoff. Completion requires a terminal, authoritative,
 * known-money snapshot, a matched order and successful strict bookkeeping.
 *
 * Two outcomes are neither done nor failing, and must not hold the cron back
 * forever: a dispute the gateway confirms but no order, boost or plan owns
 * (`unmatched`, rechecked ever more slowly, the admin told once), and a dispute
 * the gateway no longer has — an id from test keys read with live ones
 * (`orphaned`, rechecked weekly).
 */
export async function reconcileTrackedDispute(input: {
  gateway: DisputeGateway;
  disputeId: string;
  now?: Date;
  quietHistory?: boolean;
  read: () => Promise<{
    reading: GatewayDisputeReading | null;
    authoritative?: boolean;
    reconciliationPending?: boolean;
  }>;
}): Promise<DisputeApplication> {
  const now = input.now ?? new Date();
  await rememberGatewayDispute(input.gateway, input.disputeId, now);
  const { GatewayDisputeReconciliation } = await import(
    "@/models/gateway-dispute-reconciliation.model"
  );
  const owner = randomUUID();
  const claimed = await GatewayDisputeReconciliation.findOneAndUpdate(
    {
      gateway: input.gateway,
      disputeId: input.disputeId,
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }],
    },
    {
      $set: {
        leaseOwner: owner,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        lastAttemptAt: now,
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after" },
  ).lean();
  if (!claimed) throw new DisputeReconciliationBusyError();
  try {
    let result: Awaited<ReturnType<typeof input.read>>;
    try {
      result = await input.read();
    } catch (error) {
      if (!isGatewayNotFoundError(error)) throw error;
      await GatewayDisputeReconciliation.updateOne(
        { _id: claimed._id, leaseOwner: owner },
        {
          $set: {
            state: "orphaned",
            error: String(error).slice(0, 2000),
            nextCheckAt: new Date(now.getTime() + ORPHAN_RECHECK_MS),
          },
          $unset: { leaseOwner: "", leaseUntil: "" },
        },
      );
      console.warn(
        `${input.gateway} no longer has dispute ${input.disputeId}; it will be checked weekly:`,
        error,
      );
      return { matched: false, recorded: 0, reversed: 0 };
    }
    const {
      reading,
      authoritative = true,
      reconciliationPending = false,
    } = result;
    if (
      reading &&
      (reading.gateway !== input.gateway ||
        reading.disputeId !== input.disputeId)
    ) {
      throw new Error("Provider returned a different dispute identity");
    }
    // A slow request must not apply its snapshot after a new owner took over.
    const held = await GatewayDisputeReconciliation.updateOne(
      { _id: claimed._id, leaseOwner: owner },
      {
        $set: { leaseUntil: new Date(Date.now() + LEASE_MS), reading },
      },
    );
    if (!held.matchedCount) throw new DisputeReconciliationBusyError();
    const { withStrictLedger } = await import("@/lib/finance/ledger");
    const applied = await withStrictLedger(() =>
      applyGatewayDispute(reading, {
        quietHistory: input.quietHistory,
        strictReconciliation: true,
      }),
    );
    const terminal =
      reading && ["won", "lost", "closed"].includes(reading.stage);
    // The gateway answered and nothing here is that payment: not a failure,
    // and not something an hourly retry will change.
    const unmatched =
      authoritative && !reconciliationPending && !applied.matched;
    const pending =
      !unmatched &&
      (reconciliationPending ||
        !reading ||
        !authoritative ||
        !applied.matched ||
        applied.deferred ||
        reading.withdrawn === null ||
        !Number.isFinite(reading.withdrawn) ||
        (reading.stage === "won" && reading.withdrawn > 0));
    const state = unmatched
      ? "unmatched"
      : pending
        ? "pending"
        : terminal
          ? "complete"
          : "open";
    const ageMs = now.getTime() - new Date(claimed.createdAt ?? now).getTime();
    let noticed = false;
    if (
      unmatched &&
      reading &&
      ageMs >= UNMATCHED_GRACE_MS &&
      !claimed.unmatchedNoticeAt &&
      !["won", "closed"].includes(reading.stage)
    )
      noticed = await announceUnmatchedDispute(reading);
    await GatewayDisputeReconciliation.updateOne(
      { _id: claimed._id, leaseOwner: owner },
      {
        $set: {
          state,
          lastSuccessAt: now,
          nextCheckAt: new Date(
            now.getTime() +
              (state === "complete"
                ? DAY
                : state === "unmatched"
                  ? unmatchedRecheckMs(ageMs)
                  : HOUR),
          ),
          ...(noticed ? { unmatchedNoticeAt: now } : {}),
        },
        $unset: { error: "", leaseOwner: "", leaseUntil: "" },
      },
    );
    return applied;
  } catch (error) {
    await GatewayDisputeReconciliation.updateOne(
      { _id: claimed._id, leaseOwner: owner },
      {
        $set: {
          state: "pending",
          error: String(error).slice(0, 2000),
          nextCheckAt: new Date(now.getTime() + 60_000),
        },
        $unset: { leaseOwner: "", leaseUntil: "" },
      },
    );
    throw error;
  }
}

/** Once, after the grace period: money may have moved for a payment nobody here owns. */
async function announceUnmatchedDispute(
  reading: GatewayDisputeReading,
): Promise<boolean> {
  try {
    const { currencyMinorUnitExponent } = await import("@/lib/intl/money");
    const { notifyAdminsPaymentAnomaly } = await import(
      "@/lib/notifications/notifications"
    );
    const label = DISPUTE_GATEWAY_LABEL[reading.gateway];
    const amount = reading.disputedAmount
      ? ` for ${reading.disputedAmount.toFixed(currencyMinorUnitExponent(reading.currency))} ${reading.currency}`
      : "";
    await notifyAdminsPaymentAnomaly({
      title: "A dispute does not match any payment",
      message: `${label} dispute ${reading.disputeId}${amount} is not on any order, boost, subscription or commission payment in this store. If it is for a payment made outside Storify, answer it in ${DISPUTE_RESPONSE_PLACE[reading.gateway]}; otherwise find the payment it belongs to and record the chargeback by hand.`,
      dedupeKey: `dispute:${reading.gateway}:${reading.disputeId}:unmatched`,
    });
    return true;
  } catch (error) {
    console.error("Failed to report an unmatched dispute:", error);
    return false;
  }
}
