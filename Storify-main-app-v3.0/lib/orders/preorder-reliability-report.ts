import { Types } from "mongoose";
import { Order, Product } from "@/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { PREORDER_ITEM_STATUS, PURCHASE_TYPE } from "@/lib/orders/preorders";
import { DISPATCHED_ORDER_STATUSES } from "@/lib/orders/order-status-workflow";
import { classifyConsignmentAllocation } from "@/lib/orders/preorder-allocation";
import { PreorderOperation } from "@/models/preorder-operation.model";

/**
 * The pre-order reliability dry run: what the historical data holds that the
 * new workflow will not (or must not) act on by itself, before it is rolled
 * out. READ ONLY — every query here is a find, a count or an aggregation; no
 * document is written and no index is built (the CLI connects with
 * `autoIndex: false`). See docs/PREORDER_RELIABILITY_IMPLEMENTATION.md.
 *
 * Each finding names what it is, what to do about it, how many there are and
 * a sample of order ids and numbers — never customer data.
 */

export type ReliabilityFinding = {
  key: string;
  title: string;
  /** What an operator does about it. */
  action: string;
  count: number;
  samples: Array<{ orderId: string; orderNumber?: string; detail?: string }>;
};

export type PreorderReliabilityReport = {
  generatedAt: Date;
  scanned: { orders: number; products: number };
  findings: ReliabilityFinding[];
  operations: Record<string, Record<string, number>>;
};

type ReportOrder = {
  _id: Types.ObjectId;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  preorderStatus?: string;
  preorderBalancePaidAt?: Date | null;
  preorderSavedPaymentMethodId?: string | null;
  preorderMandateAcceptedAt?: Date | null;
  createdAt?: Date;
  preorderCollection?: {
    cycleId?: string;
    state?: string;
    preparedAt?: Date;
    attentionReason?: string;
  } | null;
  preorderRelease?: {
    state?: string;
    operationId?: string;
    operationCreatedAt?: Date;
    reason?: string;
  } | null;
  subOrders?: Array<{
    _id: Types.ObjectId;
    status?: string;
    inventoryReserved?: boolean;
    preorderReserved?: boolean;
    preorderAllocation?: { state?: string; operationId?: string } | null;
    items?: Array<{
      productId?: Types.ObjectId;
      purchaseType?: string;
      quantity?: number;
      preorderTermsRevision?: number;
    }>;
  }>;
};

const REPORT_FIELDS =
  "_id orderNumber status paymentStatus preorderStatus preorderBalancePaidAt preorderSavedPaymentMethodId preorderMandateAcceptedAt createdAt preorderCollection.cycleId preorderCollection.state preorderCollection.preparedAt preorderCollection.attentionReason preorderRelease.state preorderRelease.operationId preorderRelease.operationCreatedAt preorderRelease.reason subOrders._id subOrders.status subOrders.inventoryReserved subOrders.preorderReserved subOrders.preorderAllocation.state subOrders.preorderAllocation.operationId subOrders.items.productId subOrders.items.purchaseType subOrders.items.quantity subOrders.items.preorderTermsRevision";

const DEFINITIONS: Array<Omit<ReliabilityFinding, "count" | "samples">> = [
  {
    key: "ambiguous_allocation",
    title: "Waiting consignments whose stock state cannot be told from the record",
    action:
      "Count the units on hand for these products, then either record them as allocated or clear the reservation by hand. The new workflow refuses to allocate or restore them on its own (reconciliation_required).",
  },
  {
    key: "cancelled_with_committed_stock",
    title: "Cancelled consignments still holding allocated stock",
    action:
      "Restock the recorded units (the allocation evidence lists them per location) — a cancellation that died before its restore. New cancellations do this in the same transaction.",
  },
  {
    key: "paid_but_payment_due",
    title: "Balances paid while the order still reads 'payment due'",
    action:
      "A settlement that never reached its release. After deploying, the recovery pass releases these (a release request is created when the next payment event or the daily pass touches them); check any that stay listed.",
  },
  {
    key: "cancelled_parent_live_consignments",
    title: "Cancelled orders with consignments that are not cancelled",
    action:
      "Inspect each: cancel the remaining consignment through the order page (which restores and refunds through the shared cancellation) or correct the parent status.",
  },
  {
    key: "legacy_request_without_cycle",
    title: "Balance requests from before advance notices (no collection cycle)",
    action:
      "Nothing to do by hand: the daily pass adopts them — allocates their stock and sends a new advance notice — and no card is charged until that notice is accepted and its window passes. Listed so the volume of notices is known in advance.",
  },
  {
    key: "notice_not_accepted",
    title: "Balance notices not accepted by the mail server",
    action:
      "Fix the contact details or the mail settings and use 'Resend notice'. No card is charged and no expiry clock runs until a notice is accepted.",
  },
  {
    key: "stale_date_revision",
    title: "Waiting order lines behind their product's release-date revision",
    action:
      "Run the frequent job (/api/cron/preorder-jobs) until the date jobs report idle; these orders are not charged or auto-released while stale.",
  },
  {
    key: "release_without_operation",
    title: "Paid releases requested with no operation behind them",
    action: "The recovery pass recreates the operation; anything that stays listed needs a look.",
  },
];

/**
 * Build the report. `sampleLimit` bounds the ids listed per finding (counts
 * are always complete); `scanLimit` bounds the orders read, for a quick look
 * at a very large store (then the counts say "at least").
 */
export async function buildPreorderReliabilityReport(
  options: { sampleLimit?: number; scanLimit?: number; now?: Date } = {},
): Promise<PreorderReliabilityReport> {
  const now = options.now || new Date();
  const sampleLimit = Math.max(0, options.sampleLimit ?? 25);
  const findings = new Map<string, ReliabilityFinding>(
    DEFINITIONS.map((definition) => [definition.key, { ...definition, count: 0, samples: [] }]),
  );
  const note = (key: string, order: ReportOrder, detail?: string) => {
    const finding = findings.get(key)!;
    finding.count += 1;
    if (finding.samples.length < sampleLimit) {
      finding.samples.push({
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        ...(detail ? { detail } : {}),
      });
    }
  };

  // Waiting lines per product, to compare against the products' revisions.
  const linesByProduct = new Map<string, Array<{ order: ReportOrder; revision: number }>>();
  let scannedOrders = 0;
  const cursor = Order.find({ hasPreorder: true })
    .select(REPORT_FIELDS)
    .sort({ _id: 1 })
    .limit(options.scanLimit ?? 0)
    .lean<ReportOrder[]>()
    .cursor();
  for await (const order of cursor as AsyncIterable<ReportOrder>) {
    scannedOrders += 1;
    const subs = order.subOrders || [];
    const cancelled = order.status === ORDER_STATUS.CANCELLED;

    for (const sub of subs) {
      const allocation = classifyConsignmentAllocation(sub as never);
      if (!cancelled && allocation.state === "ambiguous") {
        note("ambiguous_allocation", order, `${String(sub._id)}: ${allocation.reason}`);
      }
      if (sub.status === ORDER_STATUS.CANCELLED && sub.preorderAllocation?.state === "committed") {
        note("cancelled_with_committed_stock", order, String(sub._id));
      }
    }

    if (
      order.preorderStatus === PREORDER_ITEM_STATUS.PAYMENT_DUE &&
      !cancelled &&
      (order.paymentStatus === PAYMENT_STATUS.PAID || order.preorderBalancePaidAt)
    ) {
      note("paid_but_payment_due", order);
    }

    if (cancelled) {
      const live = subs.filter(
        (sub) =>
          sub.status !== ORDER_STATUS.CANCELLED &&
          !DISPATCHED_ORDER_STATUSES.includes(String(sub.status || "")),
      );
      if (live.length > 0) {
        note(
          "cancelled_parent_live_consignments",
          order,
          live.map((sub) => `${String(sub._id)}:${sub.status}`).join(", "),
        );
      }
      continue;
    }

    if (
      order.preorderStatus === PREORDER_ITEM_STATUS.PAYMENT_DUE &&
      !order.preorderCollection?.cycleId &&
      order.paymentStatus !== PAYMENT_STATUS.PAID
    ) {
      const card = Boolean(order.preorderSavedPaymentMethodId && order.preorderMandateAcceptedAt);
      note(
        "legacy_request_without_cycle",
        order,
        card ? "saved card + mandate (was chargeable on the old path)" : undefined,
      );
    }

    const cycle = order.preorderCollection;
    if (cycle?.state === "attention") {
      note("notice_not_accepted", order, cycle.attentionReason || "attention");
    } else if (
      cycle?.state === "notice_pending" &&
      cycle.preparedAt &&
      now.getTime() - new Date(cycle.preparedAt).getTime() > 60 * 60 * 1000
    ) {
      note("notice_not_accepted", order, "still sending after an hour");
    }

    const release = order.preorderRelease;
    if (
      (release?.state === "requested" || release?.state === "waiting") &&
      !release.operationCreatedAt
    ) {
      note("release_without_operation", order, release.operationId);
    }

    for (const sub of subs) {
      if (sub.status !== ORDER_STATUS.PREORDERED) continue;
      for (const item of sub.items || []) {
        if (item.purchaseType !== PURCHASE_TYPE.PREORDER || !item.productId) continue;
        const key = String(item.productId);
        const list = linesByProduct.get(key) || [];
        list.push({ order, revision: Number(item.preorderTermsRevision || 0) });
        linesByProduct.set(key, list);
      }
    }
  }

  // Stale revisions: one read of the products involved, in batches.
  const productIds = [...linesByProduct.keys()];
  let scannedProducts = 0;
  const staleOrders = new Set<string>();
  for (let start = 0; start < productIds.length; start += 500) {
    const products = await Product.find({
      _id: { $in: productIds.slice(start, start + 500).map((value) => new Types.ObjectId(value)) },
    })
      .select("_id preorderTermsRevision")
      .lean<Array<{ _id: Types.ObjectId; preorderTermsRevision?: number }>>();
    scannedProducts += products.length;
    for (const product of products) {
      const revision = Number(product.preorderTermsRevision || 0);
      for (const line of linesByProduct.get(String(product._id)) || []) {
        if (line.revision >= revision) continue;
        const key = String(line.order._id);
        if (staleOrders.has(key)) continue;
        staleOrders.add(key);
        note(
          "stale_date_revision",
          line.order,
          `product ${String(product._id)}: line r${line.revision} < product r${revision}`,
        );
      }
    }
  }

  const operationRows = await PreorderOperation.aggregate<{
    _id: { kind: string; state: string };
    count: number;
  }>([{ $group: { _id: { kind: "$kind", state: "$state" }, count: { $sum: 1 } } }]);
  const operations: Record<string, Record<string, number>> = {};
  for (const row of operationRows) {
    operations[row._id.kind] ??= {};
    operations[row._id.kind][row._id.state] = row.count;
  }

  return {
    generatedAt: now,
    scanned: { orders: scannedOrders, products: scannedProducts },
    findings: [...findings.values()],
    operations,
  };
}
