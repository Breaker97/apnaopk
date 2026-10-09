/**
 * Moving a vendor from a pay-per-period gateway onto Stripe's auto-renewal.
 *
 * The reverse direction (Stripe → one-shot) is a single write: flipping
 * `provider` off "stripe" hides the row from every Stripe path, so the
 * cancellation's own webhooks cannot hurt it. Coming back is harder, because
 * the vendor has already paid through `currentPeriodEnd` and the Stripe
 * subscription must not charge before then — and a Stripe subscription that has
 * not charged yet has no paid invoice, which is exactly the evidence
 * `canActivatePaidPlan` demands. Flipping `provider` to "stripe" at checkout
 * time would therefore hand the sync a fully-paid vendor with no activation
 * evidence, and its `!accessAllowed` branch would revoke the store.
 *
 * So the flip is deferred. Checkout creates the subscription with a trial to
 * the paid-through date and records it in the three `stripeTakeover*` columns
 * ONLY; `provider` stays on the old gateway, which keeps the row invisible to
 * Stripe exactly as it was before. When Stripe's first real invoice is paid the
 * row is promoted — provider, reference and price pointers move over in one
 * write — and from that moment the ordinary Stripe machinery owns it.
 *
 * Promotion is driven by the invoice webhook and swept hourly as a backstop,
 * because a takeover that never promotes leaves the vendor paying Stripe while
 * the local clock lapses them.
 */

import type Stripe from "stripe";
import type { ISettings } from "@/models/settings.model";
import { VendorSubscription } from "@/models";
import { getStripeForSecretKey, isStripeSecretKeyConfigured } from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  retrieveVendorBillingSnapshot,
  type VendorBillingSnapshot,
} from "@/lib/vendors/vendor-stripe-adapter";
import { synchronizeVendorBilling } from "@/lib/vendors/vendor-billing-sync";
import { dispatchVendorBillingNotifications } from "@/lib/vendors/vendor-billing-notifications";

export const VENDOR_STRIPE_TAKEOVER_KIND = "vendor_subscription_takeover";

type StripeTakeoverDecision =
  | { kind: "promote" }
  | { kind: "wait"; reason: string }
  | { kind: "discard"; reason: string };

interface StripeTakeoverSnapshotView {
  subscriptionId: string;
  status: string;
  priceId: string | null;
  invoiceStatus?: string | null;
}

/**
 * Whether a pending takeover should move the row onto Stripe, keep waiting, or
 * be dropped. Pure so both callers — the invoice webhook and the hourly sweep —
 * decide identically, and so the money-relevant conditions are testable without
 * Stripe or a database.
 *
 * The price check mirrors the sync's: the trusted price is the one WE recorded
 * for the plan, never the one Stripe reports, so a subscription created against
 * some other price can never be promoted onto this vendor's row.
 */
export function decideStripeTakeover(input: {
  provider?: string | null;
  takeoverSubscriptionId?: string | null;
  trustedPriceId?: string | null;
  snapshot: StripeTakeoverSnapshotView;
}): StripeTakeoverDecision {
  if (!input.takeoverSubscriptionId) {
    return { kind: "wait", reason: "no takeover is pending" };
  }
  if (input.takeoverSubscriptionId !== input.snapshot.subscriptionId) {
    return { kind: "wait", reason: "snapshot is for a different subscription" };
  }
  // Already promoted: the columns are leftovers from the write that moved this
  // row over, and clearing them is the idempotent finish rather than a failure.
  if (input.provider === "stripe") {
    return { kind: "discard", reason: "already promoted" };
  }
  if (
    input.snapshot.status === "canceled" ||
    input.snapshot.status === "incomplete_expired"
  ) {
    return { kind: "discard", reason: `subscription is ${input.snapshot.status}` };
  }
  if (
    !input.trustedPriceId ||
    input.trustedPriceId !== input.snapshot.priceId
  ) {
    return {
      kind: "discard",
      reason: `subscription price ${input.snapshot.priceId || "missing"} does not match trusted price ${input.trustedPriceId || "missing"}`,
    };
  }
  if (input.snapshot.status === "active" && input.snapshot.invoiceStatus === "paid") {
    return { kind: "promote" };
  }
  return {
    kind: "wait",
    reason: `subscription is ${input.snapshot.status} with invoice ${input.snapshot.invoiceStatus || "none"}`,
  };
}

/** Metadata the takeover subscription carries, shaped to satisfy the sync's
 *  `metadataMatches` once the row is promoted. A mismatch there is treated as
 *  tampering and revokes access, so this must line up exactly. */
export function buildStripeTakeoverMetadata(input: {
  applicationId: string | null;
  vendorId: string;
  userId: string;
  planId: string;
  subscriptionId: string;
}): Record<string, string> {
  return {
    kind: VENDOR_STRIPE_TAKEOVER_KIND,
    // Omitted entirely rather than sent empty when the row has no application:
    // `metadataMatches` requires the key to be absent in that case.
    ...(input.applicationId ? { applicationId: input.applicationId } : {}),
    vendorId: input.vendorId,
    userId: input.userId,
    planId: input.planId,
    localSubscriptionId: input.subscriptionId,
  };
}

function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

/**
 * Record a completed takeover checkout against its local subscription.
 *
 * This is the ONLY thing completing that checkout does. It writes the three
 * takeover columns and nothing else — no provider flip, no status change, no
 * period move — because the vendor has bought nothing yet: Stripe is holding a
 * card against a trial that runs to the date they already paid through.
 *
 * Returns true when the session belonged to a takeover, so the webhook router
 * stops treating it as an unrecognised session and tries to build an order.
 */
export async function recordStripeTakeoverFromSession(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
): Promise<boolean> {
  const metadata = session.metadata || {};
  if (metadata.kind !== VENDOR_STRIPE_TAKEOVER_KIND) return false;

  const localSubscriptionId = metadata.localSubscriptionId;
  const stripeSubscriptionId = stripeObjectId(session.subscription);
  if (!localSubscriptionId || !stripeSubscriptionId) {
    console.error(
      `Vendor Stripe takeover session ${session.id} is missing its subscription binding`,
    );
    return true;
  }

  // When Stripe will actually charge, read from the subscription rather than
  // assumed from the local period we asked for. The sweep waits on this date,
  // so it has to be Stripe's own answer — if the trial landed anywhere other
  // than where we asked, waiting on our own figure would either sweep a
  // subscription that has not billed yet or miss one that already has.
  const snapshot = await retrieveVendorBillingSnapshot(
    stripe,
    stripeSubscriptionId,
  );
  const takeoverAt =
    snapshot.subscription.trialEnd ??
    snapshot.subscription.currentPeriodEnd ??
    new Date();

  // Compare-and-set on exactly what this writes: a re-delivered webhook, or the
  // return-URL check racing it, must not resurrect a takeover that has already
  // been promoted (provider "stripe") or replaced by a different subscription.
  const claimed = await VendorSubscription.updateOne(
    {
      _id: localSubscriptionId,
      vendorId: metadata.vendorId,
      provider: { $ne: "stripe" },
      $or: [
        { stripeTakeoverSubscriptionId: null },
        { stripeTakeoverSubscriptionId: stripeSubscriptionId },
      ],
    },
    {
      $set: {
        stripeTakeoverSubscriptionId: stripeSubscriptionId,
        stripeTakeoverSessionId: session.id,
        stripeTakeoverAt: takeoverAt,
      },
    },
  );
  if (claimed.matchedCount === 0) {
    console.warn(
      `Vendor Stripe takeover session ${session.id} did not match a claimable subscription ${localSubscriptionId}`,
    );
  }
  return true;
}

function resolveStripe(settings: ISettings): Stripe | null {
  const secretKey = resolveStripeCredentials(settings.payment?.stripe).secretKey;
  return isStripeSecretKeyConfigured(secretKey)
    ? getStripeForSecretKey(secretKey as string)
    : null;
}

async function clearTakeover(
  localSubscriptionId: string,
  reason: string | null,
): Promise<void> {
  await VendorSubscription.updateOne(
    { _id: localSubscriptionId },
    {
      $set: {
        stripeTakeoverSubscriptionId: null,
        stripeTakeoverSessionId: null,
        stripeTakeoverAt: null,
        ...(reason ? { lastReconcileError: reason } : {}),
      },
    },
  );
}

/**
 * Apply a settled takeover: move the row onto Stripe and let the ordinary sync
 * take it from there.
 *
 * The flip and the takeover-column clear happen in one write, so the row is
 * never both "on Stripe" and "awaiting takeover". Only after that does
 * `synchronizeVendorBilling` run — its context lookup keys on
 * `provider: "stripe"` + `paymentProviderRef`, which is precisely what this
 * write establishes.
 */
async function applyStripeTakeover(
  localSubscriptionId: string,
  snapshot: VendorBillingSnapshot,
  settings: ISettings,
): Promise<boolean> {
  const promoted = await VendorSubscription.updateOne(
    {
      _id: localSubscriptionId,
      // Compare-and-set on the pending takeover: two callers (the webhook and
      // the sweep) can reach this at once, and only one may perform the flip.
      stripeTakeoverSubscriptionId: snapshot.subscription.id,
      provider: { $ne: "stripe" },
    },
    {
      $set: {
        provider: "stripe",
        paymentProviderRef: snapshot.subscription.id,
        stripeCustomerId: snapshot.subscription.customerId,
        stripeSubscriptionItemId: snapshot.subscription.subscriptionItemId,
        stripePriceId: snapshot.subscription.priceId,
        providerStatus: snapshot.subscription.status,
        providerStateUpdatedAt: new Date(),
        stripeTakeoverSubscriptionId: null,
        stripeTakeoverSessionId: null,
        stripeTakeoverAt: null,
        lastReconcileError: null,
      },
    },
  );
  if (promoted.modifiedCount === 0) return false;

  const result = await synchronizeVendorBilling(snapshot, {
    eventType: "vendor.stripe_takeover",
    expectedSubscriptionId: localSubscriptionId,
  });
  await dispatchVendorBillingNotifications(result, settings);
  return true;
}

async function resolveTakeover(
  row: {
    _id: unknown;
    provider?: string | null;
    planSnapshot?: { stripePriceId?: string | null } | null;
    stripeTakeoverSubscriptionId?: string | null;
  },
  stripe: Stripe,
  settings: ISettings,
): Promise<"promoted" | "waiting" | "discarded"> {
  const localSubscriptionId = String(row._id);
  const takeoverId = row.stripeTakeoverSubscriptionId;
  if (!takeoverId) return "waiting";

  let snapshot: VendorBillingSnapshot;
  try {
    snapshot = await retrieveVendorBillingSnapshot(stripe, takeoverId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A subscription Stripe no longer knows about is never going to settle.
    if (/No such subscription/i.test(message)) {
      await clearTakeover(
        localSubscriptionId,
        `Stripe takeover ${takeoverId} no longer exists`,
      );
      return "discarded";
    }
    throw error;
  }

  const decision = decideStripeTakeover({
    provider: row.provider,
    takeoverSubscriptionId: takeoverId,
    trustedPriceId: row.planSnapshot?.stripePriceId ?? null,
    snapshot: {
      subscriptionId: snapshot.subscription.id,
      status: snapshot.subscription.status,
      priceId: snapshot.subscription.priceId,
      invoiceStatus: snapshot.invoice?.status ?? null,
    },
  });

  if (decision.kind === "wait") return "waiting";
  if (decision.kind === "discard") {
    await clearTakeover(
      localSubscriptionId,
      `Stripe takeover ${takeoverId} dropped: ${decision.reason}`,
    );
    return "discarded";
  }
  return (await applyStripeTakeover(localSubscriptionId, snapshot, settings))
    ? "promoted"
    : "waiting";
}

/**
 * Webhook entry point: an invoice was paid for `stripeSubscriptionId`. Returns
 * true when that invoice belonged to a pending takeover, so the caller can stop
 * treating the event as unhandled.
 */
export async function promoteStripeTakeoverForSubscription(
  stripeSubscriptionId: string,
  settings: ISettings,
): Promise<boolean> {
  const row = await VendorSubscription.findOne({
    stripeTakeoverSubscriptionId: stripeSubscriptionId,
  })
    .select("provider planSnapshot.stripePriceId stripeTakeoverSubscriptionId")
    .lean<{
      _id: unknown;
      provider?: string | null;
      planSnapshot?: { stripePriceId?: string | null } | null;
      stripeTakeoverSubscriptionId?: string | null;
    } | null>();
  if (!row) return false;

  const stripe = resolveStripe(settings);
  if (!stripe) return false;

  await resolveTakeover(row, stripe, settings);
  return true;
}

interface StripeTakeoverSweepSummary {
  considered: number;
  promoted: number;
  discarded: number;
}

/**
 * Hourly backstop for takeovers whose invoice webhook never arrived. Scoped to
 * rows whose takeover date has passed: before that Stripe has not charged yet
 * and there is nothing to settle.
 */
export async function sweepPendingStripeTakeovers(
  settings: ISettings,
  limit = 100,
  now = new Date(),
): Promise<StripeTakeoverSweepSummary> {
  const summary: StripeTakeoverSweepSummary = {
    considered: 0,
    promoted: 0,
    discarded: 0,
  };
  const stripe = resolveStripe(settings);
  if (!stripe) return summary;

  const rows = await VendorSubscription.find({
    stripeTakeoverSubscriptionId: { $ne: null },
    stripeTakeoverAt: { $lte: now },
  })
    .limit(limit)
    .select("provider planSnapshot.stripePriceId stripeTakeoverSubscriptionId")
    .lean<
      Array<{
        _id: unknown;
        provider?: string | null;
        planSnapshot?: { stripePriceId?: string | null } | null;
        stripeTakeoverSubscriptionId?: string | null;
      }>
    >();

  for (const row of rows) {
    summary.considered += 1;
    try {
      const outcome = await resolveTakeover(row, stripe, settings);
      if (outcome === "promoted") summary.promoted += 1;
      if (outcome === "discarded") summary.discarded += 1;
    } catch (error) {
      // One unreachable subscription must not stop the sweep for the rest.
      console.error(
        `Failed to resolve Stripe takeover for subscription ${String(row._id)}`,
        error,
      );
    }
  }
  return summary;
}
