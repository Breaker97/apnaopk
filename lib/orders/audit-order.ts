import type { NextRequest } from "next/server";
import { audit, createAuditContext, type AuditContext } from "@/lib/audit";

/**
 * Order lifecycle audit events.
 *
 * The admin order Timeline renders `AuditLog` rows for `resource: "order"`.
 * Before these helpers existed only two admin endpoints ever wrote such a row,
 * so the card showed nothing for a POS sale, nothing for a card payment, and
 * nothing for a refund — the three things an operator most needs to see.
 *
 * Two properties every helper here holds to:
 *
 * 1. **It never throws.** `audit()` already swallows its own errors and returns
 *    null; these wrappers add no failure mode of their own. An audit write must
 *    not be able to fail a checkout or a webhook.
 * 2. **The summary is self-contained.** `getOrderTimeline` selects only
 *    `action`, `createdAt`, `userEmail` and `changes.summary` — deliberately,
 *    because audit rows carry whole before/after documents the card never
 *    shows. So the summary string must read as a complete sentence on its own.
 *
 * Most of the order lifecycle runs with no admin session (gateway webhooks,
 * payment finalizers, storefront checkout), which is what `systemActor()` is
 * for — the timeline renders those as "by System".
 */

interface AuditOrderRef {
  _id: unknown;
  orderNumber?: string;
}

/**
 * Actor for events no human triggered: gateway webhooks, background
 * finalizers, automatic stock cancellations.
 */
export function systemActor(request?: NextRequest): AuditContext {
  return { request, userRole: "system" };
}

/** Actor for a signed-in customer acting on their own order. */
export function customerActor(
  request: NextRequest,
  session?: { user?: { id?: string; email?: string; role?: string } } | null,
): AuditContext {
  return createAuditContext(request, session);
}

function ref(order: AuditOrderRef) {
  return {
    resourceId: String(order._id),
    resourceName: order.orderNumber ? `Order #${order.orderNumber}` : undefined,
  };
}

function money(amount: number, currency?: string) {
  const value = Number.isFinite(amount) ? amount : 0;
  return `${value.toFixed(2)}${currency ? ` ${currency.toUpperCase()}` : ""}`;
}

const SOURCE_LABEL: Record<string, string> = {
  storefront: "the online store",
  pos: "the POS register",
  admin: "the admin panel",
};

/**
 * Order created. Written by all three creation paths — storefront checkout,
 * POS sale, and manual admin creation — so every order has a birth event.
 */
export function auditOrderPlaced(
  context: AuditContext,
  order: AuditOrderRef,
  details: {
    source: "storefront" | "pos" | "admin";
    total: number;
    currency?: string;
    itemCount: number;
    paymentMethod?: string;
  },
) {
  return audit(context, {
    action: "CREATE",
    resource: "order",
    ...ref(order),
    changes: {
      summary: `Order placed via ${SOURCE_LABEL[details.source]} — ${
        details.itemCount
      } item${details.itemCount === 1 ? "" : "s"}, ${money(
        details.total,
        details.currency,
      )}${details.paymentMethod ? ` via ${details.paymentMethod}` : ""}`,
    },
    metadata: {
      source: details.source,
      total: details.total,
      currency: details.currency,
      itemCount: details.itemCount,
      paymentMethod: details.paymentMethod,
    },
  });
}

/**
 * Payment captured.
 *
 * Safe to call unconditionally from a gateway finalizer: every finalizer flips
 * the order to paid with a guarded `findOneAndUpdate` that no-ops on a replayed
 * webhook, so this only runs on the write that actually captured the money.
 */
export function auditOrderPaid(
  context: AuditContext,
  order: AuditOrderRef,
  details: {
    gateway: string;
    amount: number;
    currency?: string;
    transactionId?: string;
    partial?: boolean;
  },
) {
  return audit(context, {
    action: "PAYMENT",
    resource: "order",
    ...ref(order),
    changes: {
      summary: `${details.partial ? "Deposit" : "Payment"} of ${money(
        details.amount,
        details.currency,
      )} received via ${details.gateway}`,
    },
    metadata: {
      gateway: details.gateway,
      amount: details.amount,
      currency: details.currency,
      transactionId: details.transactionId,
      partial: Boolean(details.partial),
    },
  });
}

/**
 * Status transition. Replaces the field-name dump an `auditUpdate` produced
 * ("Updated order fields: status, updatedAt, statusChangedBy…") with a sentence
 * an operator can read.
 */
export function auditOrderStatus(
  context: AuditContext,
  order: AuditOrderRef,
  details: { from: string; to: string; reason?: string },
) {
  return audit(context, {
    action: "STATUS_CHANGE",
    resource: "order",
    ...ref(order),
    changes: {
      before: { status: details.from },
      after: { status: details.to },
      fields: ["status"],
      summary: `Status changed from ${details.from} to ${details.to}${
        details.reason ? ` — ${details.reason}` : ""
      }`,
    },
  });
}

/**
 * A status moved somewhere the workflow forbids.
 *
 * The workflow is one-way by design — it is what stops a webhook walking a
 * delivered order back to processing. But people misclick, and a merchant who
 * marked the wrong order Delivered had no way back at all: the graph offered
 * no edge, so the order was stuck in a lie forever.
 *
 * So the escape hatch exists, and everything about this entry is built to make
 * using it visible. The reason is mandatory (the route refuses without one),
 * the action is its own `STATUS_OVERRIDE` rather than hiding among ordinary
 * transitions, and the actor is whoever authorised it. An override nobody can
 * find afterwards is indistinguishable from the bug it was meant to fix.
 */
export function auditOrderStatusOverride(
  context: AuditContext,
  order: AuditOrderRef,
  details: { from: string; to: string; reason: string },
) {
  return audit(context, {
    action: "STATUS_OVERRIDE",
    resource: "order",
    ...ref(order),
    changes: {
      before: { status: details.from },
      after: { status: details.to },
      fields: ["status"],
      summary: `Status overridden from ${details.from} to ${details.to} — ${details.reason}`,
    },
    metadata: { override: true, reason: details.reason },
  });
}

/**
 * Cancellation, with the actor spelled out. A cancelled order with money
 * captured is a support emergency; "who cancelled this, and why" is the first
 * question, and until now the page could not answer it.
 */
export function auditOrderCancelled(
  context: AuditContext,
  order: AuditOrderRef,
  details: {
    from: string;
    by: "admin" | "customer" | "system";
    reason?: string;
  },
) {
  const by =
    details.by === "system"
      ? "automatically"
      : details.by === "customer"
        ? "by the customer"
        : "by staff";

  return audit(context, {
    action: "STATUS_CHANGE",
    resource: "order",
    ...ref(order),
    changes: {
      before: { status: details.from },
      after: { status: "cancelled" },
      fields: ["status"],
      summary: `Order cancelled ${by}${
        details.reason ? ` — ${details.reason}` : ""
      }`,
    },
    metadata: { cancelledBy: details.by, reason: details.reason },
  });
}

/** Money leaving the business — the event most worth having a record of. */
export function auditOrderRefunded(
  context: AuditContext,
  order: AuditOrderRef,
  details: {
    amount: number;
    currency?: string;
    reason?: string;
    gatewayCalled?: boolean;
    returnNumber?: string;
    full?: boolean;
  },
) {
  return audit(context, {
    action: "REFUND",
    resource: "order",
    ...ref(order),
    changes: {
      summary: `${details.full ? "Full refund" : "Partial refund"} of ${money(
        details.amount,
        details.currency,
      )} issued${details.returnNumber ? ` for return ${details.returnNumber}` : ""}${
        details.gatewayCalled === false ? " (recorded manually)" : ""
      }${details.reason ? ` — ${details.reason}` : ""}`,
    },
    metadata: {
      amount: details.amount,
      currency: details.currency,
      reason: details.reason,
      gatewayCalled: details.gatewayCalled,
      returnNumber: details.returnNumber,
    },
  });
}

/** A parcel leaving the warehouse: label created, carrier and tracking known. */
export function auditOrderShipment(
  context: AuditContext,
  order: AuditOrderRef,
  details: { carrier?: string; trackingNumber?: string; vendorName?: string },
) {
  const parts = [details.carrier, details.trackingNumber].filter(Boolean);
  return audit(context, {
    action: "UPDATE",
    resource: "order",
    ...ref(order),
    changes: {
      summary: `Shipment created${
        details.vendorName ? ` for ${details.vendorName}` : ""
      }${parts.length ? ` — ${parts.join(" · ")}` : ""}`,
    },
    metadata: {
      carrier: details.carrier,
      trackingNumber: details.trackingNumber,
    },
  });
}

/**
 * Return request lifecycle, recorded against the ORDER so it lands in that
 * order's timeline next to the refund it produced.
 */
export function auditOrderReturn(
  context: AuditContext,
  order: AuditOrderRef,
  details: {
    returnNumber?: string;
    from?: string;
    to: string;
    reason?: string;
  },
) {
  const label = details.returnNumber
    ? `Return ${details.returnNumber}`
    : "Return request";

  return audit(context, {
    action: "STATUS_CHANGE",
    resource: "order",
    ...ref(order),
    changes: {
      before: details.from ? { returnStatus: details.from } : undefined,
      after: { returnStatus: details.to },
      fields: ["returnStatus"],
      summary: `${label} ${details.to.replace(/_/g, " ")}${
        details.reason ? ` — ${details.reason}` : ""
      }`,
    },
    metadata: { returnNumber: details.returnNumber, status: details.to },
  });
}
