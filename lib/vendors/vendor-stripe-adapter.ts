import type Stripe from "stripe";
import {
  normalizeStripeSubscription,
  type NormalizedStripeSubscription,
} from "@/lib/vendors/vendor-billing-state";

export interface NormalizedStripeInvoice {
  id: string;
  subscriptionId: string | null;
  paymentIntentId: string | null;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  attemptCount: number;
  paidAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  providerCreatedAt: Date | null;
}

export interface VendorBillingSnapshot {
  subscription: NormalizedStripeSubscription;
  invoice: NormalizedStripeInvoice | null;
}

export function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

function stripeDate(value: unknown): Date | null {
  return typeof value === "number" && value > 0
    ? new Date(value * 1000)
    : null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as unknown as {
    subscription?: unknown;
    parent?: { subscription_details?: { subscription?: unknown } };
  };
  return (
    stripeObjectId(raw.subscription) ??
    stripeObjectId(raw.parent?.subscription_details?.subscription)
  );
}

function invoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as unknown as {
    payment_intent?: unknown;
    payments?: {
      data?: Array<{ payment?: { payment_intent?: unknown } }>;
    };
  };
  return (
    stripeObjectId(raw.payment_intent) ??
    stripeObjectId(raw.payments?.data?.[0]?.payment?.payment_intent)
  );
}

export function normalizeStripeInvoice(
  invoice: Stripe.Invoice,
): NormalizedStripeInvoice {
  const raw = invoice as unknown as {
    created?: number;
    amount_due?: number;
    amount_paid?: number;
    amount_refunded?: number;
    currency?: string;
    attempt_count?: number;
    status_transitions?: { paid_at?: number | null };
    last_finalization_error?: { code?: string; message?: string } | null;
    last_payment_error?: { code?: string; message?: string } | null;
    lines?: {
      data?: Array<{ period?: { start?: number; end?: number } }>;
    };
  };
  const starts = (raw.lines?.data ?? [])
    .map((line) => line.period?.start)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const ends = (raw.lines?.data ?? [])
    .map((line) => line.period?.end)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const failure = raw.last_payment_error ?? raw.last_finalization_error;

  return {
    id: invoice.id,
    subscriptionId: invoiceSubscriptionId(invoice),
    paymentIntentId: invoicePaymentIntentId(invoice),
    status: invoice.status,
    amountDue: raw.amount_due ?? 0,
    amountPaid: raw.amount_paid ?? 0,
    amountRefunded: raw.amount_refunded ?? 0,
    currency: String(raw.currency || "usd").toUpperCase(),
    periodStart: starts.length > 0 ? stripeDate(Math.min(...starts)) : null,
    periodEnd: ends.length > 0 ? stripeDate(Math.max(...ends)) : null,
    attemptCount: raw.attempt_count ?? 0,
    paidAt: stripeDate(raw.status_transitions?.paid_at),
    failureCode: failure?.code || null,
    failureMessage: failure?.message || null,
    providerCreatedAt: stripeDate(raw.created),
  };
}

function expandedInvoice(value: unknown): Stripe.Invoice | null {
  return value &&
    typeof value === "object" &&
    "id" in value &&
    (value as { object?: unknown }).object === "invoice"
    ? (value as Stripe.Invoice)
    : null;
}

export async function retrieveVendorBillingSnapshot(
  stripe: Stripe,
  subscriptionId: string,
  invoiceId?: string | null,
): Promise<VendorBillingSnapshot> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["latest_invoice", "items.data.price"],
  });
  const normalizedSubscription = normalizeStripeSubscription(subscription);
  const raw = subscription as unknown as { latest_invoice?: unknown };
  const expanded = expandedInvoice(raw.latest_invoice);
  const resolvedInvoiceId = invoiceId || normalizedSubscription.latestInvoiceId;

  // Callers that are reacting to a specific invoice (invoice.paid, a failed
  // renewal) pass its id, and that invoice is the evidence being acted on — the
  // subscription's expanded `latest_invoice` may be a newer one. Use the
  // expansion only when it IS the requested invoice.
  //
  // The dedicated fetch also expands the payment intent, which the subscription
  // expansion never includes; without it the recorded payment loses its
  // provider reference and refunds cannot be traced back.
  let invoice =
    expanded && (!resolvedInvoiceId || expanded.id === resolvedInvoiceId)
      ? expanded
      : null;

  if (!invoice && resolvedInvoiceId) {
    invoice = await stripe.invoices.retrieve(resolvedInvoiceId, {
      expand: ["payments.data.payment.payment_intent"],
    });
  }

  // A subscription can report no invoice at all — briefly, right after
  // creation. Fall back to the newest invoice Stripe holds for it so activation
  // is not deferred to the next reconciliation pass.
  //
  // This is a best-effort enrichment: the snapshot is already valid without it,
  // and callers treat a null invoice as "no paid evidence yet", which
  // reconciliation retries. Failing the whole snapshot here would turn a
  // recoverable gap into a hard error on a path that was previously fine.
  if (!invoice) {
    try {
      const listed = await stripe.invoices?.list({
        subscription: subscriptionId,
        limit: 1,
        expand: ["data.payments.data.payment.payment_intent"],
      });
      invoice = listed?.data?.[0] ?? null;
    } catch (error) {
      console.error(
        "Failed to list invoices for vendor subscription",
        subscriptionId,
        error,
      );
    }
  }

  return {
    subscription: normalizedSubscription,
    invoice: invoice ? normalizeStripeInvoice(invoice) : null,
  };
}

export async function retrieveCheckoutBillingSnapshot(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<VendorBillingSnapshot | null> {
  const subscriptionId = stripeObjectId(session.subscription);
  return subscriptionId
    ? retrieveVendorBillingSnapshot(stripe, subscriptionId)
    : null;
}

export async function confirmStripeVendorUpgrade(
  stripe: Stripe,
  input: {
    subscriptionId: string;
    subscriptionItemId: string;
    targetPriceId: string;
    targetPlanId: string;
    applicationId?: string | null;
    vendorId: string;
    userId: string;
  },
): Promise<VendorBillingSnapshot> {
  await stripe.subscriptions.update(input.subscriptionId, {
    items: [
      {
        id: input.subscriptionItemId,
        price: input.targetPriceId,
      },
    ],
    payment_behavior: "pending_if_incomplete",
    proration_behavior: "always_invoice",
    metadata: {
      kind: "vendor_application_subscription",
      applicationId: input.applicationId || "",
      vendorId: input.vendorId,
      userId: input.userId,
      planId: input.targetPlanId,
    },
  });
  return retrieveVendorBillingSnapshot(stripe, input.subscriptionId);
}

/**
 * The schedule a subscription is currently managed by, if any.
 *
 * Stripe hands cancellation behaviour to the schedule the moment one is
 * attached, and then rejects `subscriptions.update({ cancel_at_period_end })`
 * outright: "the subscription is managed by the subscription schedule
 * sub_sched_..., and updating any cancelation behavior directly is not
 * allowed". Every cancel-shaped lever has to ask this before it writes.
 *
 * A schedule outlives the change it was created for. `scheduleStripeVendorDowngrade`
 * leaves its last phase open-ended, so `end_behavior: "release"` never fires —
 * once a downgrade is staged the subscription stays schedule-managed for good.
 */
async function retrieveVendorScheduleId(
  stripe: Stripe,
  subscriptionId: string,
): Promise<string | null> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return stripeObjectId(
    (subscription as unknown as { schedule?: unknown }).schedule,
  );
}

/**
 * A schedule that is already gone is the outcome the caller wanted. Release is
 * reached from several independent levers — cancelling the subscription,
 * dropping a staged downgrade — and whichever arrives second must not report
 * an error for work the first one already did.
 */
function isStripeScheduleAlreadyGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already been released|already released|is not active|already canceled|No such subscription schedule/i.test(
    message,
  );
}

/**
 * Detach a subscription from its schedule. The subscription survives untouched
 * on its current price and period; what goes away is the staged future phase
 * and the schedule's ownership of how the subscription ends.
 */
async function releaseStripeVendorSchedule(
  stripe: Stripe,
  scheduleId: string,
): Promise<void> {
  try {
    await stripe.subscriptionSchedules.release(scheduleId);
  } catch (error) {
    if (!isStripeScheduleAlreadyGone(error)) throw error;
  }
}

export async function scheduleStripeVendorDowngrade(
  stripe: Stripe,
  input: {
    subscriptionId: string;
    currentPriceId: string;
    targetPriceId: string;
    currentPeriodStart: Date;
    effectiveAt: Date;
    targetPlanId: string;
  },
): Promise<{ scheduleId: string }> {
  const existingScheduleId = await retrieveVendorScheduleId(
    stripe,
    input.subscriptionId,
  );
  const schedule = existingScheduleId
    ? await stripe.subscriptionSchedules.retrieve(existingScheduleId)
    : await stripe.subscriptionSchedules.create({
        from_subscription: input.subscriptionId,
      });
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      {
        start_date: Math.floor(input.currentPeriodStart.getTime() / 1000),
        end_date: Math.floor(input.effectiveAt.getTime() / 1000),
        items: [{ price: input.currentPriceId, quantity: 1 }],
      },
      {
        start_date: Math.floor(input.effectiveAt.getTime() / 1000),
        items: [{ price: input.targetPriceId, quantity: 1 }],
        metadata: { planId: input.targetPlanId },
      },
    ],
  });
  return { scheduleId: schedule.id };
}

interface ScheduledCancellationResult {
  snapshot: VendorBillingSnapshot;
  /** The schedule this cancellation had to tear down, if there was one. */
  releasedScheduleId: string | null;
}

export async function scheduleStripeVendorCancellation(
  stripe: Stripe,
  subscriptionId: string,
): Promise<ScheduledCancellationResult> {
  // Ending the subscription at the period end makes anything staged for after
  // it moot, so the schedule is released outright rather than rewritten — and
  // it has to go first, because Stripe refuses the flag while one is attached.
  // The caller is told which schedule went, so the staged change it described
  // can be cleared locally too.
  const scheduleId = await retrieveVendorScheduleId(stripe, subscriptionId);
  if (scheduleId) {
    await releaseStripeVendorSchedule(stripe, scheduleId);
  }
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
  return {
    snapshot: await retrieveVendorBillingSnapshot(stripe, subscriptionId),
    releasedScheduleId: scheduleId,
  };
}

export async function reverseStripeVendorCancellation(
  stripe: Stripe,
  subscriptionId: string,
): Promise<VendorBillingSnapshot> {
  const scheduleId = await retrieveVendorScheduleId(stripe, subscriptionId);
  if (scheduleId) {
    // The schedule owns the ending, so the undo belongs there. `end_behavior:
    // "cancel"` is the only shape that actually ends the subscription; a
    // schedule that merely stages a downgrade cancels nothing, and releasing
    // it would silently drop a plan change nobody asked to undo.
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
    if (schedule.end_behavior === "cancel") {
      await stripe.subscriptionSchedules.update(scheduleId, {
        end_behavior: "release",
      });
    }
    return retrieveVendorBillingSnapshot(stripe, subscriptionId);
  }
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
  return retrieveVendorBillingSnapshot(stripe, subscriptionId);
}

/**
 * Undo a staged plan change at the provider, leaving the vendor on the plan
 * they are paying for: drop the schedule holding the future phase, and clear
 * the period-end cancellation that stands in for a schedule when the target
 * plan is free.
 */
export async function cancelStripeVendorScheduledChange(
  stripe: Stripe,
  subscriptionId: string,
): Promise<VendorBillingSnapshot> {
  const scheduleId = await retrieveVendorScheduleId(stripe, subscriptionId);
  if (scheduleId) {
    await releaseStripeVendorSchedule(stripe, scheduleId);
  }
  // Read the flag only after the release: while a schedule is attached the
  // value Stripe reports is the schedule's, and releasing can hand it back.
  const snapshot = await retrieveVendorBillingSnapshot(stripe, subscriptionId);
  if (!snapshot.subscription.cancelAtPeriodEnd) return snapshot;
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
  return retrieveVendorBillingSnapshot(stripe, subscriptionId);
}

/**
 * A Stripe subscription that is already gone is the outcome the caller wanted,
 * not a failure. Cancellation is reached from several independent paths — the
 * expiry sweep, application rejection, a vendor switching to another gateway —
 * and whichever arrives second must not report an error for work the first one
 * already did.
 */
export function isStripeSubscriptionAlreadyGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already canceled|No such subscription/i.test(message);
}

/**
 * Stop a Stripe subscription from ever billing again, without invoicing or
 * prorating: the period the vendor already paid for is theirs to keep, and
 * this is called precisely when something else has taken over the billing.
 */
export async function releaseStripeVendorSubscription(
  stripe: Stripe,
  subscriptionId: string,
): Promise<void> {
  try {
    await stripe.subscriptions.cancel(subscriptionId, {
      invoice_now: false,
      prorate: false,
    });
  } catch (error) {
    if (!isStripeSubscriptionAlreadyGone(error)) throw error;
  }
}
