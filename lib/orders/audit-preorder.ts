import { audit, type AuditContext } from "@/lib/audit";

/**
 * A pre-order moving through its stages, as a row in the order's Timeline.
 *
 * Until now only the money of a pre-order was audited: the refund a cancellation
 * sent back. That the order was released for fulfilment, asked for its balance,
 * given a new date or called off by a person left nothing, which is the
 * question a customer's "why did it ship late" turns on.
 *
 * Written beside `lib/orders/audit-order.ts` rather than in it, in its voice:
 * the summary is a whole sentence, because the Timeline shows nothing else.
 * Used by the admin's single and bulk routes and by the seller's route, which
 * make the same four moves.
 */

interface PreorderRef {
  _id: unknown;
  orderNumber?: string;
}

/** The stages that move. A seller's own part of a split order has its own. */
export interface PreorderState {
  status?: string | null;
  preorderStatus?: string | null;
  consignmentStatus?: string | null;
  releaseDate?: Date | string | null;
}

export type PreorderMove = "ready" | "payment_due" | "delay" | "cancel";

const words = (value?: string | null) => (value ? value.replace(/_/g, " ") : "none");

function day(value?: Date | string | null) {
  if (!value) return "no date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "no date" : date.toISOString().slice(0, 10);
}

/**
 * Written once a transition has actually landed.
 *
 * Says nothing when the stages did not move — a balance reminder sent for an
 * order already waiting on its balance, a release of one already released. A
 * delay always counts: it records a new promise and tells the shopper, whether
 * or not the status beside it changed.
 */
export function auditPreorderMove(
  context: AuditContext,
  order: PreorderRef,
  details: {
    move: PreorderMove;
    from: PreorderState;
    to: PreorderState;
    reason?: string;
    /** The seller whose consignment moved, when a seller moved only their own. */
    consignmentOf?: string;
    /** One of a batch run from the pre-orders table. */
    bulk?: boolean;
  },
) {
  const { move, from, to } = details;
  const stages = [
    { field: "preorderStatus", label: "pre-order status", from: from.preorderStatus, to: to.preorderStatus },
    { field: "status", label: "order status", from: from.status, to: to.status },
    {
      field: "consignmentStatus",
      label: "consignment status",
      from: from.consignmentStatus,
      to: to.consignmentStatus,
    },
  ].filter((stage) => (stage.from ?? null) !== (stage.to ?? null));

  if (move !== "delay" && stages.length === 0) return Promise.resolve(null);

  const who = details.consignmentOf
    ? `${details.consignmentOf}'s pre-order consignment`
    : "Pre-order";
  const headline = {
    ready: `${who} marked ready`,
    payment_due: "Pre-order balance requested",
    delay:
      day(from.releaseDate) === day(to.releaseDate)
        ? `${who} delay recorded for release date ${day(to.releaseDate)}`
        : `${who} release date moved from ${day(from.releaseDate)} to ${day(to.releaseDate)}`,
    cancel: `${who} cancelled`,
  }[move];
  const steps = stages
    .map((stage) => `${stage.label} ${words(stage.from)} → ${words(stage.to)}`)
    .join(", ");

  const fields = [
    ...stages.map((stage) => stage.field),
    ...(move === "delay" ? ["preorderReleaseDate"] : []),
  ];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const stage of stages) {
    before[stage.field] = stage.from ?? null;
    after[stage.field] = stage.to ?? null;
  }
  if (move === "delay") {
    before.preorderReleaseDate = from.releaseDate ? day(from.releaseDate) : null;
    after.preorderReleaseDate = to.releaseDate ? day(to.releaseDate) : null;
  }

  return audit(context, {
    action: stages.length > 0 ? "STATUS_CHANGE" : "UPDATE",
    resource: "order",
    resourceId: String(order._id),
    resourceName: order.orderNumber ? `Order #${order.orderNumber}` : undefined,
    changes: {
      before,
      after,
      fields,
      summary: `${headline}${steps ? ` (${steps})` : ""}${details.reason ? ` — ${details.reason}` : ""}`,
    },
    metadata: {
      preorderAction: move,
      ...(details.bulk ? { bulk: true } : {}),
      ...(details.reason ? { reason: details.reason } : {}),
      ...(details.consignmentOf ? { consignmentOf: details.consignmentOf } : {}),
    },
  });
}
