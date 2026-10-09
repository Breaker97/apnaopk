import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import {
  QuoteListQuery,
  ShopperQuoteList,
  type ShopperQuote,
  type ShopperQuoteOffer,
} from "@/contracts/mobile/shop/v1/quotes";
import { defineRoute } from "@/lib/api-core/registry";
import type { Currency } from "@/lib/intl/currencies";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import { shopperQuoteState } from "@/lib/quotes/quote-status";
import { fetchCustomerQuotes, type QuoteRequestRow } from "@/lib/quotes/quotes";
import { toMoney } from "../money";
import { afterTimeCursor, encodeTimeCursor } from "../time-cursor";

function iso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * A request as the contract shows it; the contact details stay behind (the
 * merchant's note is never read). `currency` prices the offer, when there is one.
 */
export function toShopperQuote(
  row: QuoteRequestRow,
  currency: Pick<Currency, "code" | "locale"> | null,
): ShopperQuote {
  return {
    id: String(row._id),
    productId: String(row.productId),
    productName: row.productName,
    ...(row.productSlug ? { slug: row.productSlug } : {}),
    ...(row.variantId ? { variantId: String(row.variantId) } : {}),
    ...(row.variantName ? { variantName: row.variantName } : {}),
    quantity: row.quantity,
    askedAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    state: shopperQuoteState(row),
    ...(row.offer && currency ? { offer: toShopperOffer(row.offer, currency) } : {}),
    ...(row.orderId ? { orderId: String(row.orderId) } : {}),
  };
}

function toShopperOffer(
  offer: NonNullable<QuoteRequestRow["offer"]>,
  currency: Pick<Currency, "code" | "locale">,
): ShopperQuoteOffer {
  const expiresAt = iso(offer.expiresAt);
  return {
    unitPrice: toMoney(offer.unitPrice, currency),
    quantity: offer.quantity,
    // The lot the price is for, as the website's quote list prices it.
    total: toMoney(offer.unitPrice * offer.quantity, currency),
    ...(offer.note ? { note: offer.note } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

/**
 * GET /me/quotes: the shopper's quote requests, newest first — the website's
 * /account/quotes, from the same reader (`fetchCustomerQuotes`), so whether a
 * price is still good is the store's one answer.
 */
export const myQuotesRoute = defineRoute({
  id: "me.quotes.list",
  method: "GET",
  path: "/me/quotes",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  input: QuoteListQuery,
  output: ShopperQuoteList,
  handler: async ({ input, session }) => {
    const limit = input.limit ?? LIST_DEFAULT_LIMIT;
    const rows = await fetchCustomerQuotes(session.user.id, limit + 1, {
      after: input.cursor ? afterTimeCursor(input.cursor) : undefined,
    });
    const page = rows.slice(0, limit);
    // Quoted in the store's currency, like every price the store sets.
    const currency = page.some((row) => row.offer) ? await getStoreCurrency() : null;
    return {
      items: page.map((row) => toShopperQuote(row, currency)),
      nextCursor: rows.length > limit ? encodeTimeCursor(rows[limit - 1] as QuoteRequestRow) : null,
    };
  },
});
