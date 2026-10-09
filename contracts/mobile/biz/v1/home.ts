/**
 * GET /home: the figures at the top of the business app, for the workspace in
 * `X-Workspace`.
 *
 * Each tile is there only when the operator may open what it counts (a tile
 * of orders needs `VIEW_ORDERS`). The client may group collected tiles into
 * one summary and count tiles into an attention grid, preserving the server's
 * order within each group. Skip a kind the app does not know. Tapping a tile
 * opens the list it counts:
 *
 * - `COLLECTED_TODAY`, `COLLECTED_THIS_MONTH`: Orders, `all`.
 * - `ORDERS_NEEDING_ACTION`: Orders, `needs_action`.
 * - `LOW_STOCK`: Products with `lowStock: true`.
 * - `OPEN_RETURNS`: Returns, `open`.
 * - `UNREAD_MESSAGES`: Inbox, unread only.
 *
 * "Today" and "this month" are the UTC day and month: the website's
 * dashboard's own "Today" and "This month" periods. Money is what was
 * collected, by the dashboard's own rule: for the store, the orders' totals
 * (its "In-store sales" plus "Website sales" cards); for a seller, their goods
 * (their dashboard's "Total revenue"), in the store's currency. The counts
 * are what the list a tile opens holds.
 *
 * Read it on opening Home, on pull to refresh and on returning to the
 * foreground; there is no live stream. Send the last `ETag` back as
 * `If-None-Match`: unchanged figures are a 304.
 */
import * as z from "zod";

import { Money } from "./common";

export const HOME_TILE_KINDS = [
  "COLLECTED_TODAY",
  "COLLECTED_THIS_MONTH",
  "ORDERS_NEEDING_ACTION",
  "LOW_STOCK",
  "OPEN_RETURNS",
  "UNREAD_MESSAGES",
] as const;

/**
 * Each tile is shown with this capability (GET /me), or not at all:
 * VIEW_ORDERS for the collected and order tiles, VIEW_PRODUCTS for LOW_STOCK,
 * VIEW_RETURNS for OPEN_RETURNS, VIEW_INBOX for UNREAD_MESSAGES. Collected
 * money is disclosed with VIEW_ORDERS in the existing web permission policy;
 * the client must not substitute a role-based financial visibility rule.
 */
export const HomeTile = z.object({
  kind: z.enum(HOME_TILE_KINDS),
  /** The collected tiles. */
  money: Money.optional(),
  /** The counting tiles. */
  count: z.number().int().optional(),
});
export type HomeTile = z.infer<typeof HomeTile>;

/** Daily collection on orders placed in the UTC day, using the tile's rule. */
export const HomeCollectionTrend = z.object({
  /** Ordered oldest first; days with no collection are explicit zero points. */
  points: z
    .array(
      z.object({
        day: z.string(),
        money: Money,
        /** Server-normalized chart height, 0..1; the client only maps it to pixels. */
        fraction: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(31),
  /** Server-formatted axis values in the same store currency. */
  maximum: Money,
  baseline: Money,
});
export type HomeCollectionTrend = z.infer<typeof HomeCollectionTrend>;

/** GET /home */
export const Home = z.object({
  /** The UTC day "today" means, `YYYY-MM-DD`. */
  day: z.string(),
  /** At or below this many units a product counts as low on stock. */
  lowStockThreshold: z.number().int(),
  tiles: z.array(HomeTile),
  /** Last seven UTC days including today; omitted without VIEW_ORDERS. */
  collectionTrend: HomeCollectionTrend.optional(),
});
export type Home = z.infer<typeof Home>;
