import type { ReturnRefund, ShopperReturn } from "@/contracts/mobile/shop/v1/returns";
import { imageSet } from "@/lib/api-core/shop/images";
import { toMoney } from "@/lib/api-core/shop/money";
import type { ReturnCopy } from "@/lib/returns/return-copy";
import { toCustomerReturn } from "@/lib/returns/return-customer-view";

/** A return as its shopper may see it (`toCustomerReturn`'s allowlist), in the contract's shape. */

type Estimate = {
  itemsSubtotal?: number;
  shipping?: number;
  tax?: number;
  discountAdjustment?: number;
  restockingFee?: number;
  returnShippingFee?: number;
  total?: number;
  currency?: string;
};

export function toReturnRefund(estimate: Estimate | null | undefined, currency: string): ReturnRefund {
  const money = (amount: number | undefined) => toMoney(amount ?? 0, estimate?.currency || currency);
  return {
    items: money(estimate?.itemsSubtotal),
    discount: money(estimate?.discountAdjustment),
    tax: money(estimate?.tax),
    shipping: money(estimate?.shipping),
    restockingFee: money(estimate?.restockingFee),
    returnShippingFee: money(estimate?.returnShippingFee),
    total: money(estimate?.total),
  };
}

const iso = (value: unknown): string | undefined => {
  if (!value) return undefined;
  const time = new Date(value as string | Date);
  return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

type RawReturnItems = { items?: Array<{ productId?: unknown }> | null } | null | undefined;

/**
 * The products these returns' lines are of, for `productSlugsOf`: the shopper
 * view drops the ids, and one query for every return's lines needs them.
 */
export function productIdsOfReturns(docs: ReadonlyArray<unknown>): unknown[] {
  return docs.flatMap((doc) => ((doc as RawReturnItems)?.items ?? []).map((item) => item.productId));
}

export function toShopperReturn(
  doc: Parameters<typeof toCustomerReturn>[0],
  ctx: {
    copy: ReturnCopy;
    currency: string;
    /** Each line's product's page address, by product id (`productSlugsOf`): a deleted product has none. */
    slugs: ReadonlyMap<string, string>;
  },
): ShopperReturn {
  const view = toCustomerReturn(doc)!;
  const rawItems = (doc as RawReturnItems)?.items ?? [];
  const { copy } = ctx;
  const estimate = view.estimatedRefund as Estimate | undefined;
  const currency = estimate?.currency || ctx.currency;
  const status = String(view.status || "requested");
  const refundStatus = String(view.refundStatus || "pending");
  const reason = String(view.reason || "other");
  const destination = (view as { refundDestination?: Record<string, unknown> }).refundDestination;
  const refundedAmount = view.actualRefund?.amount;
  const requestedAt = iso(doc?.requestedAt) ?? iso(doc?.createdAt) ?? new Date(0).toISOString();
  const times = {
    requestedAt,
    ...(iso(doc?.approvedAt) ? { approvedAt: iso(doc?.approvedAt) } : {}),
    ...(iso(doc?.rejectedAt) ? { rejectedAt: iso(doc?.rejectedAt) } : {}),
    ...(iso(doc?.receivedAt) ? { receivedAt: iso(doc?.receivedAt) } : {}),
    ...(iso(doc?.refundedAt) ? { refundedAt: iso(doc?.refundedAt) } : {}),
    ...(iso(doc?.closedAt) ? { closedAt: iso(doc?.closedAt) } : {}),
  };
  const instructions = text((view as { returnInstructions?: unknown }).returnInstructions);
  return {
    id: String(view._id),
    number: String(view.returnNumber || ""),
    orderId: String(view.orderId || ""),
    orderNumber: String(view.orderNumber || ""),
    status,
    statusLabel: copy.status(status),
    refundStatus,
    refundStatusLabel: copy.refundStatus(refundStatus),
    reason,
    reasonLabel: copy.reason(reason),
    ...(text(view.customerNote) ? { note: text(view.customerNote) } : {}),
    ...(text(view.rejectionReason) ? { rejectionReason: text(view.rejectionReason) } : {}),
    lines: (view.items || []).map((item, position) => {
      const image = imageSet(item.image, item.name);
      const slug = ctx.slugs.get(String(rawItems[position]?.productId ?? ""));
      return {
        index: Number(item.orderItemIndex ?? 0),
        ...(slug ? { slug } : {}),
        name: String(item.name || ""),
        ...(image ? { image } : {}),
        quantityRequested: Number(item.quantityRequested || 0),
        ...(typeof item.quantityApproved === "number" ? { quantityApproved: item.quantityApproved } : {}),
        unitPrice: toMoney(item.unitPrice ?? 0, currency),
      };
    }),
    refund: toReturnRefund(estimate, currency),
    ...(typeof refundedAmount === "number" && refundedAmount > 0
      ? { refunded: toMoney(refundedAmount, currency) }
      : {}),
    ...(destination && typeof destination.method === "string"
      ? {
          refundDestination: {
            method: destination.method,
            label: copy.method(destination.method),
            ...(text(destination.provider) ? { provider: text(destination.provider) } : {}),
            ...(text(destination.accountName) ? { accountName: text(destination.accountName) } : {}),
            ...(text(destination.accountNumber) ? { accountNumber: text(destination.accountNumber) } : {}),
          },
        }
      : {}),
    ...(instructions ? { instructions } : {}),
    times: times as ShopperReturn["times"],
  };
}
