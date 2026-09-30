import "server-only";

import { sendQuoteWithdrawnEmail } from "@/lib/email/quote-emails";
import { notifyQuoteWithdrawn } from "@/lib/notifications/notifications";

/**
 * Tell a shopper the price they were holding is gone — by email to the
 * address they asked with, and in their account when the request belongs to
 * one. Best-effort on both channels: the withdrawal is already saved, and a
 * store without SMTP must still be able to pull a price back.
 */
export async function noticeQuoteWithdrawn(quote: {
  _id: unknown;
  productName?: string;
  variantName?: string;
  name?: string;
  email?: string;
  userId?: unknown;
}): Promise<void> {
  await Promise.allSettled([
    quote.userId
      ? notifyQuoteWithdrawn({
          quoteId: String(quote._id),
          userId: String(quote.userId),
          productName: quote.productName ?? "your item",
        })
      : Promise.resolve(),
    quote.email
      ? sendQuoteWithdrawnEmail({
          quoteId: String(quote._id),
          productName: quote.productName ?? "",
          variantName: quote.variantName,
          name: quote.name ?? "",
          email: quote.email,
        })
      : Promise.resolve(),
  ]);
}
