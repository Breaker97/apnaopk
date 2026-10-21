import "server-only";

import { basketTaxLines } from "@/lib/tax/tax-rates";
import { lineTaxGetters } from "@/lib/tax/checkout-tax";
import type { TaxLine } from "@/lib/tax/tax-engine";

/**
 * The tax of an order made by hand: the admin, staff and vendor order forms
 * and the business app. Left alone, each line is taxed at its product's rate
 * — its custom rate, its class, its category's, or the store's
 * (lib/tax/tax-rates.ts) — exactly as a checkout taxes it. A percentage typed
 * on the form instead taxes the whole order at that one rate, as manual
 * orders always did; an exchange order passes the rate its return was sold at.
 */

export interface ManualTaxLine {
  productId: unknown;
  price: number;
  quantity: number;
}

export interface ManualOrderTaxPlan {
  /** Taxed line by line at each product's own rate, not at one typed percentage. */
  automatic: boolean;
  /** The order-wide percentage: the typed one, or the store's when automatic. */
  taxRate: number;
  /** Each line's rate, when some product's differs from the store's; else null. */
  taxLines: TaxLine[] | null;
  /** The store's rate (fraction), what a line with no rate of its own pays. */
  storeRate: number;
}

export async function manualOrderTax(params: {
  lines: ReadonlyArray<ManualTaxLine>;
  /** A percentage typed on the form; null or absent taxes each line by its product. */
  taxRate?: number | null;
  /** `settings.orders.taxRate`, a fraction. */
  storeRate: number;
}): Promise<ManualOrderTaxPlan> {
  const storeRate = Math.max(0, Number(params.storeRate) || 0);
  if (typeof params.taxRate === "number" && Number.isFinite(params.taxRate)) {
    return { automatic: false, taxRate: params.taxRate, taxLines: null, storeRate };
  }
  const taxLines = await basketTaxLines({
    items: params.lines.map((line) => ({
      productId: line.productId,
      amount: Math.max(0, line.price) * Math.max(0, line.quantity),
    })),
    storeRate,
  });
  return {
    automatic: true,
    taxRate: Math.round(storeRate * 100 * 10_000) / 10_000,
    taxLines,
    storeRate,
  };
}

/**
 * Each line's rate and tax for `buildVendorSubOrders`, so a return of an
 * automatically taxed line hands back what it was charged. A typed rate is
 * one rate for the whole order, recorded as the order's tax alone.
 */
export async function manualOrderLineTaxes<T>(
  items: T[],
  params: {
    plan: ManualOrderTaxPlan | undefined;
    line: (item: T) => ManualTaxLine;
    /** The order's discount on goods, as priced. */
    discount: number;
    /** The order's tax, as priced. */
    tax: number;
    currency: string;
  },
): Promise<Awaited<ReturnType<typeof lineTaxGetters<T>>>> {
  if (!params.plan?.automatic) return {};
  return lineTaxGetters(items, {
    line: params.line,
    goodsDiscount: params.discount,
    tax: params.tax,
    storeRate: params.plan.storeRate,
    currency: params.currency,
  });
}
