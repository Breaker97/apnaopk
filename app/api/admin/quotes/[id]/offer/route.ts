import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { Order, QuoteRequest } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { serializeRows } from "@/lib/api/list-query";
import { buildQuoteScopeFilter, type QuoteRequestRow } from "@/lib/quotes/quotes";
import { mergeScopeFilter } from "@/lib/access/staff-scope";
import { deriveQuoteOfferState } from "@/lib/quotes/quote-offer";
import { notifyQuoteOffer } from "@/lib/notifications/notifications";
import { sendQuoteOfferEmail } from "@/lib/email/quote-emails";
import { roundMoney } from "@/lib/intl/money";

/**
 * Answering a quote with a price.
 *
 * This is the one write that turns a lead into something buyable: from here
 * the shopper sees the number on the product page and can put it in the cart
 * at that price (lib/quotes/quote-offer.ts owns the rules on the other side).
 * It is kept off the generic PATCH because it is not a field edit — it
 * notifies the shopper, emails them, and moves the quote through its pipeline.
 *
 * Offers are only ever *replaced*, never edited in place: re-quoting is how a
 * negotiation moves, so the previous number is pushed onto `offerHistory`
 * rather than overwritten, and the merchant can see what they already offered.
 */

const OFFER_HISTORY_LIMIT = 10;

const SendOfferSchema = z.object({
  /**
   * Per unit, and above zero: a zero here would let the shopper place a real
   * order for nothing, which is never what "I have not decided a price yet"
   * should do.
   */
  unitPrice: z.number().positive().max(100_000_000),
  quantity: z.number().int().min(1).max(1_000_000),
  note: z.string().trim().max(2000).optional().default(""),
  /**
   * How long the price is held. 0 (or absent) means it does not expire —
   * some merchants quote standing prices and a forced deadline would be a
   * worse default than none.
   */
  expiresInDays: z.number().int().min(0).max(365).optional().default(0),
});

type QuoteDoc = {
  _id: unknown;
  productName?: string;
  variantName?: string;
  name?: string;
  email?: string;
  userId?: unknown;
  status?: string;
  offer?: {
    unitPrice?: number;
    quantity?: number;
    note?: string;
    expiresAt?: Date;
    offeredAt?: Date;
    offeredBy?: unknown;
    withdrawnAt?: Date;
  } | null;
  orderId?: unknown;
};

/**
 * A quote whose offer has already been spent on a live order is closed to
 * re-pricing: the shopper is mid-purchase at the old number, and handing them
 * a second live offer would let the same negotiation be bought twice. The
 * merchant cancels the order first if that is really what they want.
 */
async function assertOfferNotOnLiveOrder(quote: QuoteDoc) {
  if (!quote.orderId) return;
  const order = await Order.findById(quote.orderId)
    .select("status orderNumber")
    .lean<{ status?: string; orderNumber?: string } | null>();
  if (!order || order.status === ORDER_STATUS.CANCELLED) return;
  throw new ValidationError(
    `This quote has already been ordered${
      order.orderNumber ? ` (${order.orderNumber})` : ""
    }. Cancel that order before quoting a new price.`,
  );
}

async function loadScopedQuote(
  id: string,
  scope: Parameters<typeof buildQuoteScopeFilter>[0],
): Promise<QuoteDoc> {
  // Scoped in the query rather than after the read: a staff member limited to
  // one vendor must not be able to reach another vendor's quote by pasting its
  // id, which is exactly what a find-then-check would allow if the check were
  // ever skipped.
  const quote = await QuoteRequest.findOne(
    mergeScopeFilter({ _id: id }, buildQuoteScopeFilter(scope)),
  ).lean<QuoteDoc | null>();
  if (!quote) throw new NotFoundError("Quote request");
  return quote;
}

/**
 * The row shape the admin table re-renders from, with its derived state.
 *
 * Both writes here run behind `assertOfferNotOnLiveOrder`, so the bound order
 * is either absent or cancelled — which is exactly what "not live" means, and
 * why the state can be derived without another read.
 */
function offerRow(quote: unknown) {
  return {
    ...serializeRows<QuoteRequestRow>(quote),
    offerState: deriveQuoteOfferState(quote as QuoteDoc, false),
  };
}

export const POST = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_ORDERS],
    rateLimit: { action: "admin:quotes:offer", preset: "moderate" },
  },
  async ({ request, params, staff, session }) => {
    const body = await validateBody(request, SendOfferSchema);
    const quote = await loadScopedQuote(params.id, staff?.scope);
    await assertOfferNotOnLiveOrder(quote);

    const now = new Date();
    const expiresAt = body.expiresInDays
      ? new Date(now.getTime() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const offer = {
      unitPrice: roundMoney(body.unitPrice),
      quantity: body.quantity,
      note: body.note || undefined,
      expiresAt,
      offeredAt: now,
      offeredBy: session?.user?.id,
    };

    const update: Record<string, unknown> = {
      $set: {
        offer,
        // Answering a request is what moves it out of the queue. A quote that
        // was marked won is left alone: the merchant is re-quoting a repeat
        // order, not undoing the sale they already made.
        ...(quote.status === "won" ? {} : { status: "quoted" }),
      },
    };
    if (quote.offer?.unitPrice !== undefined) {
      update.$push = {
        offerHistory: {
          $each: [quote.offer],
          $slice: -OFFER_HISTORY_LIMIT,
        },
      };
    }

    const updated = await QuoteRequest.findByIdAndUpdate(params.id, update, {
      returnDocument: "after",
      runValidators: true,
    }).lean<QuoteDoc | null>();
    if (!updated) throw new NotFoundError("Quote request");

    // Telling the shopper is the whole point, but a store with no SMTP set up
    // must still be able to quote: both channels are best-effort and the price
    // is already saved by the time either is attempted.
    await Promise.allSettled([
      updated.userId
        ? notifyQuoteOffer({
            quoteId: String(updated._id),
            userId: String(updated.userId),
            productName: updated.productName ?? "your item",
          })
        : Promise.resolve(),
      updated.email
        ? sendQuoteOfferEmail({
            quoteId: String(updated._id),
            productName: updated.productName ?? "",
            variantName: updated.variantName,
            quantity: offer.quantity,
            unitPrice: offer.unitPrice,
            name: updated.name ?? "",
            email: updated.email,
            note: offer.note,
            expiresAt,
          })
        : Promise.resolve(),
    ]);

    return successResponse(offerRow(updated));
  },
);

/**
 * Withdraw the price — a PATCH rather than a DELETE because nothing is
 * removed: the offer stays on the record, stamped with when it was pulled, so
 * the history of the negotiation survives. It stops resolving immediately, and
 * a line already in the shopper's cart is dropped on their next cart read.
 */
export const PATCH = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_ORDERS],
    rateLimit: { action: "admin:quotes:offer", preset: "moderate" },
  },
  async ({ params, staff }) => {
    const quote = await loadScopedQuote(params.id, staff?.scope);
    if (quote.offer?.unitPrice === undefined) {
      throw new ValidationError("There is no price to withdraw");
    }
    if (quote.offer.withdrawnAt) {
      throw new ValidationError("This price has already been withdrawn");
    }
    await assertOfferNotOnLiveOrder(quote);

    const updated = await QuoteRequest.findByIdAndUpdate(
      params.id,
      { $set: { "offer.withdrawnAt": new Date() } },
      { returnDocument: "after", runValidators: true },
    ).lean<QuoteDoc | null>();
    if (!updated) throw new NotFoundError("Quote request");

    return successResponse(offerRow(updated));
  },
);
