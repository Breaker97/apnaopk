/**
 * The shopper's store credit (the website's /account/store-credit): what they
 * can spend, currency by currency, the part that expires next, and what added
 * to it or took from it.
 *
 * GET /me/store-credit is the balance; GET /me/store-credit/history the list,
 * newest first. Credit is spent at checkout by the store's own rules; the app
 * only shows it.
 *
 * `kind` is one of `STORE_CREDIT_ENTRY_KINDS`; the app shows its own words for
 * the ones it knows and a neutral label for any other.
 */
import * as z from "zod";

import { ListQuery, Money, listOf } from "./common";

/** What one currency's credit holds. */
export const StoreCreditBalance = z.object({
  balance: Money,
  /** The part that expires first, and when. Left out when none of it expires. */
  nextExpiry: z
    .object({
      amount: Money,
      expiresAt: z.string(),
    })
    .optional(),
});
export type StoreCreditBalance = z.infer<typeof StoreCreditBalance>;

/** GET /me/store-credit */
export const StoreCredit = z.object({
  /** One per currency the shopper holds credit in. Empty when they hold none. */
  balances: z.array(StoreCreditBalance),
});
export type StoreCredit = z.infer<typeof StoreCredit>;

/** What a row of the history was (`StoreCreditEntry.kind`). */
export const STORE_CREDIT_ENTRY_KINDS = [
  /** Given as the refund for a return. */
  "return_refund",
  /** Given as a refund on an order. */
  "order_refund",
  /** Given back from an order that was refunded. */
  "refund_restored",
  /** Given by the store. */
  "from_store",
  /** Spent on an order. */
  "spent",
  /** Held for an order being paid. */
  "held",
  /** Ran out unspent. */
  "expired",
] as const;

/** GET /me/store-credit/history. Newest first. */
export const StoreCreditHistoryQuery = ListQuery;
export type StoreCreditHistoryQuery = z.infer<typeof StoreCreditHistoryQuery>;

export const StoreCreditEntry = z.object({
  id: z.string(),
  /** One of `STORE_CREDIT_ENTRY_KINDS`. */
  kind: z.string(),
  /** `in` added to the credit, `out` took from it. */
  direction: z.enum(["in", "out"]),
  /** Always positive: `direction` says which way it moved. */
  amount: Money,
  createdAt: z.string(),
  /** Credit given that expires: when. */
  expiresAt: z.string().optional(),
});
export type StoreCreditEntry = z.infer<typeof StoreCreditEntry>;

export const StoreCreditHistory = listOf(StoreCreditEntry);
export type StoreCreditHistory = z.infer<typeof StoreCreditHistory>;
