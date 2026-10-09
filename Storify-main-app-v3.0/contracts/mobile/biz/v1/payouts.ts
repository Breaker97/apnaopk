/**
 * A seller's money: their balance, and the payouts the store has made them.
 * Read only, in the vendor workspace, with `VIEW_PAYOUTS`; the same figures as
 * the website's vendor finance pages.
 *
 * Session B5.
 */
import * as z from "zod";

import { ListQuery, Money, listOf } from "./common";

/**
 * GET /payouts/summary: `currency`, one of the summary's `availableCurrencies`,
 * reads the balance in it; left out, in the store's own currency.
 */
export const PayoutSummaryQuery = z.object({ currency: z.string().regex(/^[A-Za-z]{3}$/).optional() });
export type PayoutSummaryQuery = z.infer<typeof PayoutSummaryQuery>;

/** GET /payouts/summary */
export const PayoutSummary = z.object({
  /** Past the payout hold: what a payout made now would pay. */
  readyToPay: Money,
  grossEligible: Money.optional(),
  breakdown: z.record(z.string(), Money).optional(),
  eligible: z.boolean().optional(),
  hasMore: z.boolean().optional(),
  availableCurrencies: z.array(z.string()).optional(),
  calculatedAt: z.string().optional(),
  /** The orders `readyToPay` is for. */
  orderCount: z.number().int(),
  /** Delivered and not yet paid out, still inside the store's return window. */
  heldInReturnWindow: z.object({
    amount: Money,
    orderCount: z.number().int(),
    windowDays: z.number().int(),
  }),
  /** Held back against pre-order chargebacks, and when the first of it is released. */
  reserveHeld: z.object({
    amount: Money,
    releaseAt: z.string().optional(),
  }),
  /**
   * What the seller owes the store: paid out already for sales refunded since,
   * taken off the next payout.
   */
  owedToPlatform: Money,
  /** The smallest payout the store makes. */
  minimumPayout: Money,
});
export type PayoutSummary = z.infer<typeof PayoutSummary>;

/** The store's payout statuses. */
export const PAYOUT_STATUSES = ["pending", "processing", "paid", "failed", "cancelled"] as const;

/** GET /payouts. Newest first. */
export const PayoutListQuery = ListQuery.extend({
  status: z.enum(PAYOUT_STATUSES).optional(),
});
export type PayoutListQuery = z.infer<typeof PayoutListQuery>;

/** A payout as the list shows it. */
export const PayoutListItem = z.object({
  id: z.string(),
  number: z.string(),
  /** The store's own word: `pending`, `processing`, `paid`, `failed`, `cancelled`. */
  status: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  /** What the seller receives. */
  net: Money,
  createdAt: z.string(),
  paidAt: z.string().optional(),
  returnedAt: z.string().optional(),
});
export type PayoutListItem = z.infer<typeof PayoutListItem>;

export const PayoutList = listOf(PayoutListItem);
export type PayoutList = z.infer<typeof PayoutList>;

/** GET /payouts/{id} */
export const PayoutDetail = PayoutListItem.extend({
  /** Sales in the period. */
  gross: Money,
  /** The store's commission on them. */
  commission: Money,
  /** Delivery charges the seller earned, already inside `net`. */
  shipping: Money.optional(),
  /** Everything else that moved `net`: recoveries, reserves, offsets; already inside it. */
  adjustments: Money,
  breakdown: z.record(z.string(), Money).optional(),
  legacyCalculation: z.boolean().optional(),
  orderCount: z.number().int(),
  /** How it was paid: `bank`, `cash`, `gateway`, `other`. */
  method: z.string().optional(),
  /** The payment's reference, as the store recorded it. */
  reference: z.string().optional(),
});
export type PayoutDetail = z.infer<typeof PayoutDetail>;
