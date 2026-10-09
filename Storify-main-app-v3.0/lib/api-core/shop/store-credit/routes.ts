import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import {
  StoreCredit,
  StoreCreditHistory,
  StoreCreditHistoryQuery,
  type StoreCreditEntry,
} from "@/contracts/mobile/shop/v1/store-credit";
import { defineRoute } from "@/lib/api-core/registry";
import { connectDB } from "@/lib/db";
import { storeCreditHistory, storeCreditSummary } from "@/lib/store-credit/store-credit";
import { toMoney } from "../money";
import { afterTimeCursor, encodeTimeCursor } from "../time-cursor";

/** A row of the ledger as `storeCreditHistory` reads it. */
type LedgerRow = {
  _id: unknown;
  type: "issue" | "redeem" | "expire";
  amount: number;
  currency: string;
  status?: "held" | "spent" | "released";
  source?: string;
  expiresAt?: Date | null;
  createdAt: Date;
};

/** What a row was, in the words of the website's list (/account/store-credit). */
function entryKind(row: LedgerRow): string {
  if (row.type === "expire") return "expired";
  if (row.type === "redeem") return row.status === "held" ? "held" : "spent";
  if (row.source === "return_refund") return "return_refund";
  if (row.source === "order_refund") return "order_refund";
  if (row.source === "order_refund_restore") return "refund_restored";
  return "from_store";
}

export function toStoreCreditEntry(row: LedgerRow): StoreCreditEntry {
  const expiresAt = row.type === "issue" && row.expiresAt ? new Date(row.expiresAt) : null;
  return {
    id: String(row._id),
    kind: entryKind(row),
    direction: row.type === "issue" ? "in" : "out",
    amount: toMoney(row.amount, row.currency),
    createdAt: new Date(row.createdAt).toISOString(),
    ...(expiresAt && !Number.isNaN(expiresAt.getTime()) ? { expiresAt: expiresAt.toISOString() } : {}),
  };
}

/**
 * GET /me/store-credit: what the shopper can spend, currency by currency, and
 * the part that expires next — the website's own reader (`storeCreditSummary`).
 */
export const myStoreCreditRoute = defineRoute({
  id: "me.storeCredit.get",
  method: "GET",
  path: "/me/store-credit",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  output: StoreCredit,
  handler: async ({ session }) => {
    await connectDB();
    const balances = await storeCreditSummary(session.user.id);
    return {
      balances: balances.map((entry) => ({
        balance: toMoney(entry.balance, entry.currency),
        ...(entry.nextExpiry
          ? {
              nextExpiry: {
                amount: toMoney(entry.nextExpiry.amount, entry.currency),
                expiresAt: entry.nextExpiry.expiresAt.toISOString(),
              },
            }
          : {}),
      })),
    };
  },
});

/**
 * GET /me/store-credit/history: what added to the credit or took from it,
 * newest first, from the website's reader (`storeCreditHistory`): a spend
 * given back is left out, as there.
 */
export const myStoreCreditHistoryRoute = defineRoute({
  id: "me.storeCredit.history",
  method: "GET",
  path: "/me/store-credit/history",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  input: StoreCreditHistoryQuery,
  output: StoreCreditHistory,
  handler: async ({ input, session }) => {
    const limit = input.limit ?? LIST_DEFAULT_LIMIT;
    await connectDB();
    const rows = (await storeCreditHistory(session.user.id, {
      limit: limit + 1,
      after: input.cursor ? afterTimeCursor(input.cursor) : undefined,
    })) as unknown as LedgerRow[];
    const page = rows.slice(0, limit);
    return {
      items: page.map(toStoreCreditEntry),
      nextCursor: rows.length > limit ? encodeTimeCursor(page[page.length - 1]) : null,
    };
  },
});
