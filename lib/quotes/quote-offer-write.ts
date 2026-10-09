import "server-only";

import * as z from "zod";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { Order, Product } from "@/models";
import { PRODUCT_STATUS } from "@/config/app.config";
import { orderHoldsOffer } from "@/lib/quotes/quote-offer";
import type { QuoteActorRole } from "@/lib/quotes/quote-status";
import { notifyQuoteOffer } from "@/lib/notifications/notifications";
import { sendQuoteOfferEmail } from "@/lib/email/quote-emails";
import { roundMoney } from "@/lib/intl/money";

/**
 * Answering a quote with a price: the rules both the store's route
 * (`/api/admin/quotes/[id]/offer`) and the vendor's
 * (`/api/vendor/quotes/[id]/offer`) apply, so a price sent from either side is
 * checked, written and announced the same way. Who may send one at all —
 * the store's price is final — is each route's own question.
 *
 * Offers are only ever *replaced*, never edited in place: re-quoting is how a
 * negotiation moves, so the previous number is pushed onto `offerHistory`
 * rather than overwritten, and both sides can see what was already offered.
 */

const OFFER_HISTORY_LIMIT = 10;

export const SendOfferSchema = z.object({
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
  /**
   * Which variant the price is for, when the shopper asked about a product
   * with variants without picking one. The cart refuses a variant product
   * added without a variant, so a price with none attached could never be
   * bought. Ignored in favour of the quote's own when it already names one.
   */
  variantId: z.string().trim().max(64).optional(),
});

type SendOfferInput = z.infer<typeof SendOfferSchema>;

type QuoteOfferDoc = {
  unitPrice?: number;
  quantity?: number;
  note?: string;
  expiresAt?: Date;
  offeredAt?: Date;
  offeredBy?: unknown;
  offeredByRole?: string;
  withdrawnAt?: Date;
};

export type QuoteDoc = {
  _id: unknown;
  productId?: unknown;
  vendorId?: unknown;
  variantId?: unknown;
  productName?: string;
  variantName?: string;
  name?: string;
  email?: string;
  userId?: unknown;
  status?: string;
  lostByRole?: string;
  offer?: QuoteOfferDoc | null;
  offerHistory?: QuoteOfferDoc[] | null;
  orderId?: unknown;
};

/** The fields every offer route reads off the quote it is about to price. */
export const OFFER_QUOTE_FIELDS =
  "productId vendorId variantId productName variantName name email userId status lostByRole offer offerHistory orderId";

/**
 * The quote as it was read: same status, same offer, not withdrawn since.
 * Added to a vendor's write filter, so a price or a close the store made
 * between the vendor's read and its write makes the write miss instead of
 * being overwritten — the store's word is final, even by a millisecond.
 */
export function unchangedSinceRead(quote: QuoteDoc): Record<string, unknown> {
  return {
    status: quote.status,
    "offer.offeredAt": quote.offer?.offeredAt ?? { $exists: false },
    "offer.withdrawnAt": quote.offer?.withdrawnAt ?? { $exists: false },
  };
}

/**
 * A quote whose offer has already been spent on an order that still holds it
 * is closed to re-pricing: the shopper is mid-purchase at the old number, and
 * handing them a second live offer would let the same negotiation be bought
 * twice. The merchant cancels the order first if that is really what they want.
 *
 * Returns true when the quote points at an order that no longer holds it
 * (cancelled, deleted, or expired unpaid), so the caller can start the new
 * price unspent.
 */
export async function assertOfferNotOnLiveOrder(quote: QuoteDoc): Promise<boolean> {
  if (!quote.orderId) return false;
  const order = await Order.findById(quote.orderId)
    .select("status paymentStatus orderNumber")
    .lean<{
      status?: string;
      paymentStatus?: string;
      orderNumber?: string;
    } | null>();
  if (!orderHoldsOffer(order)) return true;
  throw new ValidationError(
    `This quote has already been ordered${
      order?.orderNumber ? ` (${order.orderNumber})` : ""
    }. Cancel that order before quoting a new price.`,
  );
}

type OfferProduct = {
  status?: string;
  vendorId?: unknown;
  variants?: Array<{ _id: unknown; name?: string }>;
};

/**
 * The product the price is for, which has to be on sale: a price for a
 * product that is gone or unpublished could never be bought, yet it still
 * sent the shopper a "your quote is ready" email.
 */
export async function loadOfferProduct(quote: QuoteDoc): Promise<OfferProduct> {
  const product = await Product.findById(quote.productId)
    .select("status vendorId variants._id variants.name")
    .lean<OfferProduct | null>();
  if (!product || product.status !== PRODUCT_STATUS.ACTIVE) {
    throw new ValidationError(
      "This product is not on sale, so a price for it could never be bought. Publish the product first.",
    );
  }
  return product;
}

/**
 * The variant this price is for: the one the shopper picked, or — when they
 * picked none on a product that has variants — the one the merchant chooses
 * now. Null for a product without variants.
 */
export function resolveOfferVariant(
  quote: QuoteDoc,
  product: OfferProduct,
  requestedVariantId: string | undefined,
): { _id: unknown; name?: string } | null {
  if (quote.variantId) return null;

  const variants = product.variants ?? [];
  if (variants.length === 0) return null;

  if (!requestedVariantId) {
    throw new ValidationError(
      "This product has variants. Choose which one the price is for.",
    );
  }
  const variant = variants.find(
    (candidate) => String(candidate._id) === requestedVariantId,
  );
  if (!variant) throw new NotFoundError("Variant");
  return variant;
}

/**
 * The write that sends a price, and the offer it records.
 *
 * The previous offer moves into the history; the quote leaves the queue
 * (`quoted`) unless it was already won; a quote closed as lost is open again,
 * so who closed it is forgotten; and the order a handed-back price was spent
 * on is let go, so the new price starts unspent.
 */
export function buildOfferUpdate(params: {
  quote: QuoteDoc;
  body: SendOfferInput;
  variant: { _id: unknown; name?: string } | null;
  /** The quote's order no longer holds its old price (see assertOfferNotOnLiveOrder). */
  handedBack: boolean;
  actor: { userId?: string; role: QuoteActorRole };
  now: Date;
}) {
  const { quote, body, variant, handedBack, actor, now } = params;
  const expiresAt = body.expiresInDays
    ? new Date(now.getTime() + body.expiresInDays * 24 * 60 * 60 * 1000)
    : undefined;

  const offer = {
    unitPrice: roundMoney(body.unitPrice),
    quantity: body.quantity,
    note: body.note || undefined,
    expiresAt,
    offeredAt: now,
    offeredBy: actor.userId,
    offeredByRole: actor.role,
  };

  const update: Record<string, unknown> = {
    $set: {
      offer,
      // Answering a request is what moves it out of the queue. A quote that
      // was marked won is left alone: the merchant is re-quoting a repeat
      // order, not undoing the sale they already made.
      ...(quote.status === "won" ? {} : { status: "quoted" }),
      ...(variant
        ? { variantId: variant._id, variantName: variant.name }
        : {}),
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
  const unset: Record<string, ""> = {};
  // The order the old price was spent on no longer holds it, so the new
  // price starts unspent rather than tied to a cancelled order.
  if (handedBack) unset.orderId = "";
  if (quote.status === "lost") unset.lostByRole = "";
  if (Object.keys(unset).length > 0) update.$unset = unset;

  return { offer, update };
}

/**
 * Tell the shopper their price is ready. Telling them is the whole point, but
 * a store with no SMTP set up must still be able to quote: both channels are
 * best-effort and the price is already saved by the time either is attempted.
 */
export async function announceQuoteOffer(
  quote: QuoteDoc,
  offer: { unitPrice: number; quantity: number; note?: string; expiresAt?: Date },
): Promise<void> {
  await Promise.allSettled([
    quote.userId
      ? notifyQuoteOffer({
          quoteId: String(quote._id),
          userId: String(quote.userId),
          productName: quote.productName ?? "your item",
        })
      : Promise.resolve(),
    quote.email
      ? sendQuoteOfferEmail({
          quoteId: String(quote._id),
          productName: quote.productName ?? "",
          variantName: quote.variantName,
          quantity: offer.quantity,
          unitPrice: offer.unitPrice,
          name: quote.name ?? "",
          email: quote.email,
          note: offer.note,
          expiresAt: offer.expiresAt,
        })
      : Promise.resolve(),
  ]);
}
