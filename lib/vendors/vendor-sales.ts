import { Types } from "mongoose";
import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";

/**
 * Per-vendor gross sales, aggregated live from orders.
 *
 * `Vendor.totalSales` is a dead column — nothing in the order flow ever
 * writes it — so every admin surface that shows a sales figure must derive
 * it from `subOrders`. The definition here matches the vendor's own
 * analytics dashboard (`/api/vendor/analytics`): sum of `subOrders.subtotal`
 * across non-cancelled orders, so the admin and the vendor see the same
 * number.
 *
 * Sales are grouped by the currency each order froze at checkout
 * (`Order.currency`). Adding a UGX subtotal to a USD one produces a number
 * that means nothing, and the UI formats the result with a single currency
 * symbol — so the buckets stay separate and the caller decides what to show.
 * Orders written before the `currency` field existed are attributed to the
 * store's current default currency, which is what they were charged in.
 *
 * That grouping is the one place the two surfaces can differ: a store that
 * changed its default currency mid-life has orders in both, and the vendor
 * dashboard still sums them at face value while these callers report the
 * store-currency bucket plus a breakdown. Single-currency stores — every
 * store that never switched — are unaffected.
 */

/**
 * One currency's worth of a vendor's trade.
 *
 * All four come out of the same `$group`, so the header KPI and the Payouts
 * tab's lifetime strip cannot drift apart: "Total sales" is `grossSales` here.
 * `shipping` is what buyers paid this vendor's shipments — the platform keeps
 * it, since `vendorEarnings` is `subtotal - commission` with no shipping in it.
 */
interface VendorCurrencyTotals {
  grossSales: number;
  commission: number;
  vendorEarnings: number;
  shipping: number;
}

interface VendorSalesBreakdown {
  /** Totals keyed by ISO 4217 code, e.g. `{ USD: {...}, UGX: {...} }`. */
  byCurrency: Record<string, VendorCurrencyTotals>;
  /** Gross sales across every currency, labelled with the store default. */
  primary: number;
  /** Every figure, summed across currencies. */
  primaryTotals: VendorCurrencyTotals;
  /**
   * Currency codes present other than the store default.
   *
   * Retained for diagnostics only — the UI no longer surfaces it, because the
   * app now shows one store-currency label everywhere and these figures are
   * already inside `primaryTotals`. Reading it to render a second figure would
   * double-count.
   */
  otherCurrencies: string[];
}

function emptyTotals(): VendorCurrencyTotals {
  return { grossSales: 0, commission: 0, vendorEarnings: 0, shipping: 0 };
}

interface VendorSalesOptions {
  /** Store default currency. Resolved from settings when omitted. */
  defaultCurrency?: string;
}

async function resolveDefaultCurrency(
  provided?: string,
): Promise<string> {
  if (provided) return provided.toUpperCase();
  const settings = await getSettings();
  return String(settings.general?.defaultCurrency || "USD").toUpperCase();
}

/**
 * Gross sales per vendor, split by the currency each order was charged in.
 */
export async function getVendorSalesBreakdowns(
  vendorIds: ReadonlyArray<string | Types.ObjectId>,
  options: VendorSalesOptions = {},
): Promise<Map<string, VendorSalesBreakdown>> {
  const breakdowns = new Map<string, VendorSalesBreakdown>();
  if (vendorIds.length === 0) return breakdowns;

  const defaultCurrency = await resolveDefaultCurrency(
    options.defaultCurrency,
  );
  const ids = vendorIds.map((id) => new Types.ObjectId(String(id)));

  // Leading $match is index-backed by { subOrders.vendorId, createdAt } and
  // shrinks the input before $unwind explodes sub-orders.
  const rows = await Order.aggregate<{
    _id: { vendorId: unknown; currency: string | null };
    total: number;
    commission: number;
    vendorEarnings: number;
    shipping: number;
  }>([
    {
      $match: {
        "subOrders.vendorId": { $in: ids },
        status: { $ne: ORDER_STATUS.CANCELLED },
      },
    },
    {
      $project: {
        _id: 0,
        currency: 1,
        "subOrders.vendorId": 1,
        "subOrders.subtotal": 1,
        "subOrders.commission": 1,
        "subOrders.vendorEarnings": 1,
        "subOrders.shippingCost": 1,
      },
    },
    { $unwind: "$subOrders" },
    { $match: { "subOrders.vendorId": { $in: ids } } },
    {
      $group: {
        _id: {
          vendorId: "$subOrders.vendorId",
          currency: { $ifNull: ["$currency", null] },
        },
        total: { $sum: { $ifNull: ["$subOrders.subtotal", 0] } },
        commission: { $sum: { $ifNull: ["$subOrders.commission", 0] } },
        vendorEarnings: {
          $sum: { $ifNull: ["$subOrders.vendorEarnings", 0] },
        },
        shipping: { $sum: { $ifNull: ["$subOrders.shippingCost", 0] } },
      },
    },
  ]);

  const finite = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  for (const row of rows) {
    if (typeof row.total !== "number" || !Number.isFinite(row.total)) continue;

    const vendorKey = String(row._id.vendorId);
    const currency = String(row._id.currency || defaultCurrency).toUpperCase();
    const entry = breakdowns.get(vendorKey) ?? {
      byCurrency: {},
      primary: 0,
      primaryTotals: emptyTotals(),
      otherCurrencies: [],
    };

    const bucket = (entry.byCurrency[currency] ??= emptyTotals());
    bucket.grossSales += row.total;
    bucket.commission += finite(row.commission);
    bucket.vendorEarnings += finite(row.vendorEarnings);
    bucket.shipping += finite(row.shipping);
    breakdowns.set(vendorKey, entry);
  }

  // Every currency folds into one total, labelled with the store default.
  // Buckets are summed at face value, NOT converted — the app displays one
  // store-wide currency, so a sale charged before the default changed keeps its
  // amount and takes the current symbol. Keeping only the default-currency
  // bucket (the previous behaviour) instead dropped those sales to zero, which
  // disagreed with the order list showing them.
  for (const entry of breakdowns.values()) {
    const summed = emptyTotals();
    for (const bucket of Object.values(entry.byCurrency)) {
      summed.grossSales += bucket.grossSales;
      summed.commission += bucket.commission;
      summed.vendorEarnings += bucket.vendorEarnings;
      summed.shipping += bucket.shipping;
    }

    entry.primaryTotals = summed;
    entry.primary = summed.grossSales;
    entry.otherCurrencies = Object.keys(entry.byCurrency)
      .filter((code) => code !== defaultCurrency)
      .sort();
  }

  return breakdowns;
}

/**
 * Gross sales per vendor, labelled with the store's default currency.
 *
 * The single-number form used by list surfaces. Sales charged in another
 * currency are included at face value, matching how every other surface
 * relabels historical amounts — use {@link getVendorSalesBreakdowns} when the
 * per-currency split matters.
 */
export async function getVendorSalesTotals(
  vendorIds: ReadonlyArray<string | Types.ObjectId>,
  options: VendorSalesOptions = {},
): Promise<Map<string, number>> {
  const breakdowns = await getVendorSalesBreakdowns(vendorIds, options);
  const totals = new Map<string, number>();
  for (const [vendorId, breakdown] of breakdowns) {
    totals.set(vendorId, breakdown.primary);
  }
  return totals;
}
