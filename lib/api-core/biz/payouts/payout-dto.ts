import type { PayoutDetail, PayoutListItem } from "@/contracts/mobile/biz/v1/payouts";
import { toMoney } from "@/lib/api-core/shop/money";

/**
 * A payout as the store keeps it (models/payout.model.ts), the fields the app
 * reads, and the contract's shape of it (contracts/mobile/biz/v1/payouts.ts).
 * Every amount is in the payout's own currency, the one it was made in.
 */
export interface PayoutRow {
  _id: unknown;
  payoutNumber?: string;
  status?: string;
  periodStart?: Date | string;
  periodEnd?: Date | string;
  currency?: string;
  grossSales?: number;
  commissionAmount?: number;
  shippingAmount?: number | null;
  netAmount?: number;
  adjustments?: number;
  orderIds?: unknown[];
  paidAt?: Date | string | null;
  reversedAt?: Date | string | null;
  breakdown?: Record<string, number>;
  paidFrom?: string;
  paymentReference?: string;
  createdAt?: Date | string;
}

const iso = (value: Date | string | null | undefined) => new Date(value ?? 0).toISOString();

export function toPayoutListItem(row: PayoutRow): PayoutListItem {
  const currency = row.currency ?? "USD";
  return {
    id: String(row._id),
    number: row.payoutNumber ?? "",
    status: row.status ?? "pending",
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    net: toMoney(row.netAmount, currency),
    createdAt: iso(row.createdAt),
    ...(row.paidAt ? { paidAt: iso(row.paidAt) } : {}),
    ...(row.reversedAt ? { returnedAt: iso(row.reversedAt) } : {}),
  };
}

export function toPayoutDetail(row: PayoutRow): PayoutDetail {
  const currency = row.currency ?? "USD";
  return {
    ...toPayoutListItem(row),
    gross: toMoney(row.grossSales, currency),
    commission: toMoney(row.commissionAmount, currency),
    // Absent on payouts made before the store handed delivery charges on.
    ...(typeof row.shippingAmount === "number" ? { shipping: toMoney(row.shippingAmount, currency) } : {}),
    adjustments: toMoney(row.adjustments, currency),
    legacyCalculation: !row.breakdown,
    ...(row.breakdown ? { breakdown: Object.fromEntries(Object.entries(row.breakdown).map(([key, amount]) => [key, toMoney(amount, currency)])) } : {}),
    orderCount: row.orderIds?.length ?? 0,
    ...(row.paidFrom ? { method: row.paidFrom } : {}),
    ...(row.paymentReference ? { reference: row.paymentReference } : {}),
  };
}
