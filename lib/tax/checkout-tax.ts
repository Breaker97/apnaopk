import "server-only";

import { calculateCheckoutTotals, type CheckoutTotalsInput } from "@/lib/catalog/discounts";
import { resolveCouponLineDiscounts } from "@/lib/catalog/coupons";
import { fingerprintLineOrder, type CartFingerprintLine } from "@/lib/checkout/checkout-cart-fingerprint";
import { allocateMoney } from "@/lib/intl/money";
import { computeTax, type TaxLine } from "@/lib/tax/tax-engine";
import { resolveProductTaxRates, type ProductTaxRates } from "@/lib/tax/tax-rates";
import { splitTax, type TaxPart } from "@/lib/tax/tax-parts";
import { combinedRate } from "@/lib/tax/tax-settings";

/**
 * Pricing an order whose lines may carry their own tax rates — the server's
 * side of lib/tax/tax-engine.ts, shared by every path that charges or writes
 * an order (checkout, the card intent, the order routes), so the amount a
 * shopper is charged and the tax the order records cannot disagree.
 *
 * A basket whose every line is at the store's one rate takes the old path
 * unchanged: `calculateCheckoutTotals` with `taxRate`.
 */

export interface BasketLine {
  productId: unknown;
  /** Keyed as the coupon's `vendorShares` are — see `couponVendorKey`. */
  vendorId?: string | null;
  price: number;
  quantity: number;
}

type LineCoupon = Parameters<typeof resolveCouponLineDiscounts>[0]["coupon"];

const idOf = (value: unknown) => String((value as { _id?: unknown } | null)?._id ?? value ?? "");

/** The basket's tax lines — or null when every line is at the store's rate. */
export async function checkoutTaxLines(params: {
  lines: BasketLine[];
  coupon?: LineCoupon;
  /** What the coupon took off the goods (never a free-shipping discount). */
  goodsDiscount: number;
  /** `settings.orders.taxRate`, a fraction. */
  storeRate: number;
  currency: string;
  rates?: Map<string, number | null>;
}): Promise<TaxLine[] | null> {
  if (!params.lines.length) return null;
  const rates = params.rates ?? (await resolveProductTaxRates(params.lines.map((line) => line.productId)));
  const own = params.lines.map((line) => rates.get(idOf(line.productId)) ?? null);
  if (own.every((rate) => rate === null)) return null;
  // A coupon limited to some products comes off those lines only, and so
  // lowers only their tax — the same split the order records per line.
  const shares =
    params.goodsDiscount > 0
      ? await resolveCouponLineDiscounts({
          coupon: params.coupon,
          goodsDiscount: params.goodsDiscount,
          lines: params.lines.map((line) => ({
            productId: idOf(line.productId),
            vendorId: line.vendorId,
            price: line.price,
            quantity: line.quantity,
          })),
          currency: params.currency,
        })
      : null;
  const storeRate = Math.max(0, Number(params.storeRate) || 0);
  return params.lines.map((line, index) => ({
    amount: Math.max(0, line.price) * Math.max(0, line.quantity),
    rate: own[index] ?? storeRate,
    ...(shares ? { discount: shares[index] ?? 0 } : {}),
  }));
}

/**
 * `calculateCheckoutTotals`, each line taxed at its own rate. Taxed that way,
 * the rate each line was charged at (a fraction) comes back as `lineRates`,
 * beside the `lineTaxes` the totals already carry.
 */
export async function checkoutTotalsWithLineTax(
  input: CheckoutTotalsInput,
  basket: { lines: BasketLine[]; coupon?: LineCoupon; rates?: Map<string, number | null> },
): Promise<ReturnType<typeof calculateCheckoutTotals> & { lineRates?: number[] }> {
  const base = calculateCheckoutTotals(input);
  const taxLines = await checkoutTaxLines({
    lines: basket.lines,
    coupon: basket.coupon,
    goodsDiscount: base.subtotalDiscount,
    storeRate: input.taxRate,
    currency: input.currency || "USD",
    rates: basket.rates,
  });
  return taxLines
    ? { ...calculateCheckoutTotals({ ...input, taxLines }), lineRates: taxLines.map((line) => line.rate) }
    : base;
}

/**
 * What each line was charged when a card payment was quoted: its rate in
 * percent and its tax. A Stripe order is built when the money lands, from the
 * cart and the rates of THAT moment, so without this a rate changed in
 * between would move the tax charged from one line to another — the total
 * stays what the card paid, the split does not.
 */
export interface LineTaxSnapshotEntry {
  rate: number;
  tax: number;
}

/**
 * A snapshot, read back: each line's rate and tax, or — for a basket whose
 * every line was at the store's one rate — that rate alone, so the lines are
 * still split at it whatever their products are rated by the time the order
 * is built.
 */
export type LineTaxSnapshot =
  | { kind: "lines"; entries: LineTaxSnapshotEntry[] }
  | { kind: "store"; rate: number };

/** Stripe keeps a metadata value to 500 characters; a longer snapshot is not carried. */
const SNAPSHOT_MAX_LENGTH = 500;

const toPercent = (fraction: number) => Math.round(fraction * 100 * 10_000) / 10_000;

/**
 * The snapshot of a priced basket, as a metadata value — "20:10.5,0:0" in
 * fingerprint order (`fingerprintLineOrder`), so the cart that is rebuilt at
 * capture can read it whatever order its lines are held in. A basket taxed at
 * the store's one rate is "*10", the rate alone. Empty when the lines do not
 * add up to the tax charged, or when it will not fit; the order is then built
 * from the rates of the day, as it always was.
 */
export function encodeLineTaxSnapshot(
  items: ReadonlyArray<CartFingerprintLine>,
  quoted: {
    tax: number;
    lineTaxes?: number[];
    lineRates?: number[];
    /** `settings.orders.taxRate` (a fraction), the rate a basket without line rates was taxed at. */
    storeRate?: number;
  },
): string {
  const { lineTaxes, lineRates } = quoted;
  if (!lineTaxes || !lineRates) {
    // Every line at the store's rate: "*10" says so.
    const storeRate = Number(quoted.storeRate);
    return items.length > 0 && quoted.tax > 0 && Number.isFinite(storeRate) && storeRate >= 0
      ? `*${toPercent(storeRate)}`
      : "";
  }
  if (!items.length || lineTaxes.length !== items.length || lineRates.length !== items.length) return "";
  const sum = lineTaxes.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - quoted.tax) > 0.005) return "";
  const value = fingerprintLineOrder(items)
    .map((index) => `${toPercent(lineRates[index]!)}:${lineTaxes[index]!}`)
    .join(",");
  return value.length <= SNAPSHOT_MAX_LENGTH ? value : "";
}

/**
 * A snapshot read back, with its lines in the order of `items`; null when it
 * is absent, unreadable, for a different number of lines, or does not add up
 * to `tax`.
 */
export function decodeLineTaxSnapshot(
  raw: string | undefined,
  items: ReadonlyArray<CartFingerprintLine>,
  tax: number,
): LineTaxSnapshot | null {
  if (!raw || !items.length) return null;
  if (raw.startsWith("*")) {
    const rate = Number(raw.slice(1));
    return raw.length > 1 && Number.isFinite(rate) && rate >= 0 ? { kind: "store", rate } : null;
  }
  const entries: LineTaxSnapshotEntry[] = [];
  for (const piece of raw.split(",")) {
    const [rate, lineTax, extra] = piece.split(":").map(Number);
    if (extra !== undefined || !Number.isFinite(rate) || !Number.isFinite(lineTax)) return null;
    if (rate! < 0 || lineTax! < 0) return null;
    entries.push({ rate: rate!, tax: lineTax! });
  }
  if (entries.length !== items.length) return null;
  const sum = entries.reduce((total, entry) => total + entry.tax, 0);
  if (!Number.isFinite(tax) || Math.abs(sum - tax) > 0.005) return null;
  const aligned: LineTaxSnapshotEntry[] = [];
  fingerprintLineOrder(items).forEach((index, position) => {
    aligned[index] = entries[position]!;
  });
  return { kind: "lines", entries: aligned };
}

/**
 * Each line's rate (fraction) and its share of the tax charged, worked out
 * for every basket — what both the recorded line taxes and the tax parts are
 * read from. The shares always add up to `tax`.
 */
async function workLineTaxes(params: {
  lines: BasketLine[];
  couponLineShares?: Array<number | undefined> | null;
  goodsDiscount: number;
  tax: number;
  storeRate: number;
  currency: string;
  rates?: ProductTaxRates;
  /** What the payment was quoted with, lines in `lines` order. */
  snapshot?: LineTaxSnapshot | null;
}) {
  const rates = params.rates ?? (await resolveProductTaxRates(params.lines.map((line) => line.productId)));
  const quoted = params.snapshot;
  if (quoted?.kind === "lines" && quoted.entries.length === params.lines.length) {
    return workQuotedLineTaxes(params.lines, quoted.entries, rates, params.currency);
  }
  // Quoted at the store's one rate: every line is, whatever its product is
  // rated by now, and its parts are the store rate's.
  const quotedStoreRate = quoted?.kind === "store" ? quoted.rate : null;
  const own = params.lines.map((line) => (quotedStoreRate === null ? (rates.get(idOf(line.productId)) ?? null) : null));
  const storeRate = quotedStoreRate === null ? Math.max(0, Number(params.storeRate) || 0) : quotedStoreRate / 100;
  const lineRates = own.map((rate) => rate ?? storeRate);
  const named = Array.isArray(params.couponLineShares);
  const worked = computeTax({
    lines: params.lines.map((line, index) => ({
      amount: Math.max(0, line.price) * Math.max(0, line.quantity),
      rate: lineRates[index]!,
      ...(named ? { discount: params.couponLineShares?.[index] ?? 0 } : {}),
    })),
    discount: params.goodsDiscount,
    currency: params.currency,
  });
  const tax = Math.max(0, Number(params.tax) || 0);
  // What was charged is the answer; the lines share it as they earned it.
  const shares =
    worked.tax === tax
      ? worked.lineTaxes
      : allocateMoney(tax, worked.lineTaxes.some((value) => value > 0) ? worked.lineTaxes : lineRates, params.currency);
  // Each line's parts (state, county): its product's, or the store rate's; one
  // unnamed part at the line's rate when the parts are not known.
  const quotedStoreComponents =
    quotedStoreRate === null
      ? null
      : rates.storeParts?.length && Math.abs(combinedRate(rates.storeParts) * 100 - quotedStoreRate) < 0.001
        ? rates.storeParts
        : [{ name: "", rate: quotedStoreRate }];
  const parts = params.lines.map((line, index) => {
    const components =
      quotedStoreComponents ??
      rates.parts?.get(idOf(line.productId)) ??
      (own[index] === null ? rates.storeParts : undefined) ??
      [{ name: "", rate: Math.round(lineRates[index]! * 100 * 10_000) / 10_000 }];
    return splitTax(shares[index] ?? 0, components, params.currency);
  });
  return { own, lineRates, shares, parts };
}

/**
 * The lines' taxes as the payment was quoted — the snapshot's rates and tax,
 * not today's. Each line's parts (state, county) come from today's components
 * only while they still make up the rate it was charged at; otherwise the
 * line has the one unnamed part at that rate.
 */
function workQuotedLineTaxes(
  lines: BasketLine[],
  snapshot: LineTaxSnapshotEntry[],
  rates: ProductTaxRates,
  currency: string,
) {
  const lineRates = snapshot.map((entry) => entry.rate / 100);
  const shares = snapshot.map((entry) => entry.tax);
  const parts = lines.map((line, index) => {
    const rate = snapshot[index]!.rate;
    const current = rates.parts?.get(idOf(line.productId));
    const components =
      current && current.length > 0 && Math.abs(combinedRate(current) * 100 - rate) < 0.001
        ? current
        : [{ name: "", rate }];
    return splitTax(shares[index] ?? 0, components, currency);
  });
  // A quoted snapshot is only written for a basket with rates of its own.
  return { own: lineRates as Array<number | null>, lineRates, shares, parts };
}

/**
 * Each line's rate (percent) and tax, to write onto an order whose `tax` was
 * charged — or null when every line is at the store's rate (those orders keep
 * the order-wide tax only, as before). The shares always add up to `tax`.
 */
export async function recordLineTaxes(params: {
  lines: BasketLine[];
  /** Each line's share of the coupon, when recorded (`items.couponDiscount`). */
  couponLineShares?: Array<number | undefined> | null;
  goodsDiscount: number;
  tax: number;
  storeRate: number;
  currency: string;
  rates?: ProductTaxRates;
}): Promise<Array<{ taxRate: number; tax: number }> | null> {
  if (!params.lines.length) return null;
  const worked = await workLineTaxes(params);
  if (worked.own.every((rate) => rate === null)) return null;
  return params.lines.map((_, index) => ({
    taxRate: Math.round(worked.lineRates[index]! * 100 * 10_000) / 10_000,
    tax: worked.shares[index] ?? 0,
  }));
}

/**
 * `recordLineTaxes` as the getters `buildVendorSubOrders` takes, keyed by
 * the caller's own line objects. The rate and tax are left out when every
 * line is at the store rate, so those orders keep the order-wide tax as
 * before; each line's tax parts (state, county) are given whenever tax was charged,
 * for invoices and the tax report.
 */
export async function lineTaxGetters<T>(
  items: T[],
  params: {
    line: (item: T) => BasketLine;
    /** Each line's recorded coupon share; absent when the order has none. */
    couponShare?: ((item: T) => number | undefined) | null;
    goodsDiscount: number;
    tax: number;
    storeRate: number;
    currency: string;
    /** What the payment was quoted with, lines in `items` order. */
    snapshot?: LineTaxSnapshot | null;
  },
): Promise<{
  getTaxRate?: (item: T) => number | undefined;
  getTax?: (item: T) => number | undefined;
  getTaxParts?: (item: T) => TaxPart[] | undefined;
}> {
  if (!items.length) return {};
  const worked = await workLineTaxes({
    lines: items.map(params.line),
    couponLineShares: params.couponShare ? items.map(params.couponShare) : null,
    goodsDiscount: params.goodsDiscount,
    tax: params.tax,
    storeRate: params.storeRate,
    currency: params.currency,
    snapshot: params.snapshot,
  });
  const indexOf = new Map(items.map((item, index) => [item, index]));
  const getTaxParts = (item: T) => {
    const parts = worked.parts[indexOf.get(item) ?? -1];
    return parts?.length ? parts : undefined;
  };
  const charged = worked.parts.some((parts) => parts.length > 0);
  if (worked.own.every((rate) => rate === null)) return charged ? { getTaxParts } : {};
  return {
    getTaxRate: (item) => {
      const index = indexOf.get(item);
      return index === undefined ? undefined : Math.round(worked.lineRates[index]! * 100 * 10_000) / 10_000;
    },
    getTax: (item) => {
      const index = indexOf.get(item);
      return index === undefined ? undefined : (worked.shares[index] ?? 0);
    },
    ...(charged ? { getTaxParts } : {}),
  };
}
