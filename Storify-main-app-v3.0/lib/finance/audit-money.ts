import { audit, type AuditContext } from "@/lib/audit";
import { currencyPriceScale } from "@/lib/intl/money";
import type { AuditResource } from "@/config/audit.config";
import { User, Vendor } from "@/models";

/**
 * Money events for the Activity Log: payouts, store credit, commission invoices
 * and what a vendor pays the platform.
 *
 * The same job `lib/orders/audit-order.ts` does for orders, and held to the same
 * two rules. `audit()` never throws, and these add no failure mode of their own —
 * the lookups below that name a store or a customer swallow their errors, because
 * a row without a name is still worth writing and a missing name must not fail a
 * payout or a webhook. And the summary is a sentence that reads alone: the list
 * shows nothing else.
 *
 * Nothing here takes a bank or card number. A payout names its transfer by the
 * reference the admin typed, and a bank account never reaches these rows at all.
 */

function money(amount: unknown, currency?: string): string {
  const code = String(currency || "").trim().toUpperCase();
  const value = Number(amount);
  const digits = code ? currencyPriceScale(code) : 2;
  return `${(Number.isFinite(value) ? value : 0).toFixed(digits)}${code ? ` ${code}` : ""}`;
}

/** `2026-09-30`, or nothing for a value that is not a date. */
function day(value: unknown): string {
  const at = new Date(value as string | number | Date);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString().slice(0, 10);
}

/** A free-text note cut to what a list row can hold; the whole of it stays in `after`. */
function clip(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** `reference "A" → "B"`, `reference set to "B"` or `reference cleared (was "A")`. */
function fromTo(label: string, from: string | null, to: string | null): string {
  if (from && to) return `${label} "${from}" → "${to}"`;
  if (to) return `${label} set to "${to}"`;
  return `${label} cleared (was "${from}")`;
}

/** The store a money row is about, by name. */
async function storeName(vendorId: unknown): Promise<string | undefined> {
  try {
    const vendor = await Vendor.findById(vendorId)
      .select("storeName")
      .lean<{ storeName?: string } | null>();
    return vendor?.storeName || undefined;
  } catch {
    return undefined;
  }
}

async function customerOf(userId: string): Promise<{ email?: string; name?: string }> {
  try {
    const user = await User.findById(userId)
      .select("name email")
      .lean<{ name?: string; email?: string } | null>();
    return { email: user?.email || undefined, name: user?.name || undefined };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Payouts

interface PayoutRef {
  _id: unknown;
  payoutNumber: string;
  currency: string;
  vendorId: unknown;
  netAmount: number;
}

/** A payout built: what it pays, to which store, for which sales. */
export function auditPayoutCreated(
  context: AuditContext,
  payout: PayoutRef & {
    periodStart: Date;
    periodEnd: Date;
    grossSales: number;
    commissionAmount: number;
    adjustments: number;
    orderCount: number;
  },
  vendorName?: string,
) {
  const period = `${day(payout.periodStart)} to ${day(payout.periodEnd)}`;
  return audit(context, {
    action: "CREATE",
    resource: "payout",
    resourceId: String(payout._id),
    resourceName: payout.payoutNumber,
    changes: {
      after: {
        status: "pending",
        vendorId: String(payout.vendorId),
        ...(vendorName ? { vendorName } : {}),
        currency: payout.currency,
        periodStart: day(payout.periodStart),
        periodEnd: day(payout.periodEnd),
        grossSales: payout.grossSales,
        commissionAmount: payout.commissionAmount,
        adjustments: payout.adjustments,
        netAmount: payout.netAmount,
        orderCount: payout.orderCount,
      },
      summary: `Payout ${payout.payoutNumber} of ${money(payout.netAmount, payout.currency)} created for ${
        vendorName || "a vendor"
      }, covering ${period} (${plural(payout.orderCount, "order")})`,
    },
  });
}

export interface PayoutAuditState {
  status: string;
  paymentReference?: string | null;
  paidFrom?: string | null;
}

const PAID_FROM_LABEL: Record<string, string> = {
  bank: "bank",
  cash: "cash",
  gateway: "gateway",
  other: "another account",
};

const paidFromLabel = (value: string | null) => (value ? (PAID_FROM_LABEL[value] ?? value) : null);

/**
 * A payout moved between statuses, or had where its money went corrected.
 *
 * A status move is `STATUS_CHANGE`. A save that moved nothing but changed the
 * transfer reference or the account it left from — the admin fixing a typo on a
 * paid payout — is an `UPDATE`: that reference is the only thing tying the
 * payout to a bank line, so a silent edit of it is exactly what the log is for.
 * A note on its own is not logged. Nothing changed, nothing is written.
 */
export async function auditPayoutChanged(
  context: AuditContext,
  payout: PayoutRef,
  details: {
    before: PayoutAuditState;
    after: PayoutAuditState;
    /** The note the admin gave with the move — why a paid payout came back. */
    reason?: string;
  },
) {
  const state = (value: PayoutAuditState) => ({
    status: value.status,
    paymentReference: value.paymentReference?.trim() || null,
    paidFrom: value.paidFrom || null,
  });
  const before = state(details.before);
  const after = state(details.after);
  const fields = (["status", "paymentReference", "paidFrom"] as const).filter(
    (field) => before[field] !== after[field],
  );
  if (fields.length === 0) return null;

  const moved = fields.includes("status");
  const reason = moved ? details.reason?.trim() : undefined;
  const vendorName = await storeName(payout.vendorId);
  const subject = `Payout ${payout.payoutNumber} of ${money(payout.netAmount, payout.currency)}${
    vendorName ? ` for ${vendorName}` : ""
  }`;

  let summary: string;
  if (moved) {
    // How the money left only matters once it has.
    const how =
      after.status === "paid"
        ? [
            after.paidFrom && `paid from ${paidFromLabel(after.paidFrom)}`,
            after.paymentReference && `ref ${after.paymentReference}`,
          ].filter(Boolean)
        : [];
    summary = `${subject} moved from ${before.status} to ${after.status}${
      how.length ? ` (${how.join(", ")})` : ""
    }${reason ? ` — ${clip(reason)}` : ""}`;
  } else {
    const parts = [
      fields.includes("paymentReference")
        ? fromTo("reference", before.paymentReference, after.paymentReference)
        : null,
      fields.includes("paidFrom")
        ? fromTo("paid from", paidFromLabel(before.paidFrom), paidFromLabel(after.paidFrom))
        : null,
    ].filter(Boolean);
    summary = `${subject} payment details changed: ${parts.join(", ")}`;
  }

  const snapshot = (value: typeof before) => ({
    ...value,
    netAmount: payout.netAmount,
    currency: payout.currency,
  });
  return audit(context, {
    action: moved ? "STATUS_CHANGE" : "UPDATE",
    resource: "payout",
    resourceId: String(payout._id),
    resourceName: payout.payoutNumber,
    changes: { before: snapshot(before), after: snapshot(after), fields, summary },
    metadata: {
      vendorId: String(payout.vendorId),
      ...(reason ? { reason } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Store credit

/** Store credit given by hand, with no refund behind it. */
export async function auditStoreCreditIssued(
  context: AuditContext,
  lot: {
    _id: unknown;
    customerId: unknown;
    amount: number;
    currency: string;
    source?: string;
    expiresAt?: Date | null;
    note?: string | null;
  },
) {
  const customerId = String(lot.customerId);
  const { email, name } = await customerOf(customerId);
  const note = lot.note?.trim();
  const expires = lot.expiresAt ? day(lot.expiresAt) : "";
  return audit(context, {
    action: "CREATE",
    resource: "storeCredit",
    resourceId: String(lot._id),
    resourceName: email || name,
    changes: {
      after: {
        customerId,
        amount: lot.amount,
        currency: lot.currency,
        ...(lot.source ? { source: lot.source } : {}),
        reason: note || null,
        expiresAt: expires || null,
      },
      summary: `Store credit of ${money(lot.amount, lot.currency)} issued to ${
        email || name || "a customer"
      } (customer ${customerId})${expires ? `, expiring ${expires}` : ""}${
        note ? ` — ${clip(note)}` : ""
      }`,
    },
  });
}

// ---------------------------------------------------------------------------
// Commission invoices

interface InvoiceVendor {
  id: string;
  name?: string;
}

/** The commission a vendor owes on sales they collected themselves, billed. */
export function auditCommissionInvoiceRaised(
  context: AuditContext,
  invoice: { invoiceId: string; amount: number; currency: string; orderCount: number },
  vendor: InvoiceVendor,
  note?: string,
) {
  return audit(context, {
    action: "CREATE",
    resource: "commissionInvoice",
    resourceId: invoice.invoiceId,
    resourceName: vendor.name,
    changes: {
      after: {
        status: "open",
        vendorId: vendor.id,
        ...(vendor.name ? { vendorName: vendor.name } : {}),
        amount: invoice.amount,
        currency: invoice.currency,
        orderCount: invoice.orderCount,
        ...(note?.trim() ? { note: note.trim() } : {}),
      },
      summary: `Commission invoice of ${money(invoice.amount, invoice.currency)} raised for ${
        vendor.name || "a vendor"
      }, covering ${plural(invoice.orderCount, "order")}`,
    },
  });
}

/** An invoice withdrawn before anyone paid it; its sales are owed again. */
export function auditCommissionInvoiceCancelled(
  context: AuditContext,
  invoice: {
    _id: unknown;
    status: string;
    amount: number;
    currency: string;
    orderCount: number;
  },
  vendor: InvoiceVendor,
) {
  const figures = { amount: invoice.amount, currency: invoice.currency };
  return audit(context, {
    action: "STATUS_CHANGE",
    resource: "commissionInvoice",
    resourceId: String(invoice._id),
    resourceName: vendor.name,
    changes: {
      before: { status: invoice.status, ...figures },
      after: { status: "cancelled", ...figures },
      fields: ["status"],
      summary: `Commission invoice of ${money(invoice.amount, invoice.currency)} for ${
        vendor.name || "a vendor"
      } cancelled — the commission on its ${plural(invoice.orderCount, "order")} is owed again`,
    },
  });
}

// ---------------------------------------------------------------------------
// What vendors pay the platform

const PLATFORM_PAYMENT_TARGET: Record<string, { resource: AuditResource; label: string }> = {
  commission: { resource: "commissionInvoice", label: "Commission payment" },
  subscription: { resource: "vendorSubscription", label: "Subscription payment" },
  boost: { resource: "boostCampaign", label: "Boost payment" },
};

interface PlatformPaymentRef {
  _id: unknown;
  kind: string;
  vendorId: unknown;
  amount: number;
  currency: string;
  provider: string;
  reference?: string | null;
  commissionInvoiceId?: unknown;
  subscriptionId?: unknown;
  applicationId?: unknown;
  campaignId?: unknown;
  stripePaymentIntentId?: string | null;
  paypalCaptureId?: string | null;
  razorpayPaymentId?: string | null;
  paystackTransactionId?: string | null;
  iotecTransactionId?: string | null;
  pesapalOrderTrackingId?: string | null;
  orangeMoneyTxnId?: string | null;
  mtnMomoTransactionId?: string | null;
}

/** The gateway's own id for the charge, whichever gateway took it. */
function gatewayTransactionId(payment: PlatformPaymentRef): string | undefined {
  return (
    payment.stripePaymentIntentId ||
    payment.paypalCaptureId ||
    payment.razorpayPaymentId ||
    payment.paystackTransactionId ||
    payment.iotecTransactionId ||
    payment.pesapalOrderTrackingId ||
    payment.orangeMoneyTxnId ||
    payment.mtnMomoTransactionId ||
    undefined
  );
}

/**
 * Money a vendor paid the platform, recorded the moment it was.
 *
 * Filed under what the money bought — the commission invoice, the subscription,
 * the boost campaign — so it reads next to that record. Its before and after are
 * the PAYMENT's status, not the invoice's: the attempt is what flipped, and the
 * invoice can still refuse the settlement afterwards.
 */
export async function auditPlatformPaymentReceived(
  context: AuditContext,
  payment: PlatformPaymentRef,
  details: {
    /** How it was taken: the gateway's name, or anything for a manual collection. */
    method: string;
    /** An admin recording money taken off-system, not a gateway's. */
    manual: boolean;
    statusBefore?: string;
  },
) {
  const target = PLATFORM_PAYMENT_TARGET[payment.kind] ?? {
    resource: "payment" as const,
    label: "Platform payment",
  };
  const targetId =
    payment.kind === "commission"
      ? payment.commissionInvoiceId
      : payment.kind === "boost"
        ? payment.campaignId
        : payment.subscriptionId;
  const vendorName = await storeName(payment.vendorId);
  const amount = money(payment.amount, payment.currency);
  const how = details.manual
    ? "recorded as collected by hand"
    : `received via ${details.method}`;
  const transactionId = gatewayTransactionId(payment);

  return audit(context, {
    action: "PAYMENT",
    resource: target.resource,
    resourceId: String(targetId ?? payment._id),
    resourceName: vendorName,
    changes: {
      before: { paymentStatus: details.statusBefore ?? "pending" },
      after: { paymentStatus: "paid" },
      fields: ["paymentStatus"],
      summary: `${target.label} of ${amount} ${how} for ${vendorName || "a vendor"}${
        payment.reference ? ` (ref ${payment.reference})` : ""
      }`,
    },
    metadata: {
      paymentId: String(payment._id),
      kind: payment.kind,
      vendorId: String(payment.vendorId),
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      ...(payment.reference ? { reference: payment.reference } : {}),
      ...(transactionId ? { transactionId } : {}),
      ...(payment.applicationId ? { applicationId: String(payment.applicationId) } : {}),
    },
  });
}
