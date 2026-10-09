import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { QuoteRequest } from "@/models";
import {
  buildVendorQuoteFilter,
  fetchVendorQuoteDetail,
  type VendorQuoteView,
} from "@/lib/quotes/quotes";
import {
  assertVendorQuoteMove,
  requireVendorQuoteView,
} from "@/lib/quotes/vendor-quote-access";
import {
  holdsLiveStorePrice,
  withdrawSupersededOffers,
} from "@/lib/quotes/quote-offer";
import {
  announceQuoteOffer,
  assertOfferNotOnLiveOrder,
  buildOfferUpdate,
  loadOfferProduct,
  OFFER_QUOTE_FIELDS,
  resolveOfferVariant,
  SendOfferSchema,
  unchangedSinceRead,
  type QuoteDoc,
} from "@/lib/quotes/quote-offer-write";
import { quotePricedByAdmin } from "@/lib/quotes/quote-status";
import { noticeQuoteWithdrawn } from "@/lib/quotes/quote-notices";
import {
  auditQuoteOffer,
  auditQuoteOfferWithdrawn,
} from "@/lib/quotes/audit-quote";
import { createAuditContext } from "@/lib/audit";

/**
 * The vendor answering a quote for its own product with a price — the same
 * offer the store sends (lib/quotes/quote-offer-write.ts), checked, written
 * and announced the same way, so the shopper cannot tell which side sent it.
 *
 * The store's price is final. Once the store has priced the quote, pulled a
 * price back or closed it, the vendor can only read it (`vendorQuoteMoves`);
 * and every write here lands only on the quote as it was read, so a store
 * move made in between makes the vendor's write miss rather than undo it.
 */

const CHANGED =
  "This quote changed while you were working on it. Reload it and try again.";

/**
 * The vendor's copy of the quote, for the rules, and the quote itself, for the
 * write. Whether the store has priced it is asked of both — the database's
 * answer and the stored offers' — so neither can let a vendor past the
 * store's price on its own.
 */
async function loadVendorQuote(id: string, view: VendorQuoteView) {
  const [detail, quote] = await Promise.all([
    fetchVendorQuoteDetail(id, view),
    QuoteRequest.findOne({ _id: id, ...buildVendorQuoteFilter(view.vendorId) })
      .select(OFFER_QUOTE_FIELDS)
      .lean<QuoteDoc | null>(),
  ]);
  if (!detail || !quote) throw new NotFoundError("Quote request");
  return {
    detail: {
      ...detail,
      pricedByAdmin: detail.pricedByAdmin || quotePricedByAdmin(quote),
    },
    quote,
  };
}

async function offerResponse(
  id: string,
  view: VendorQuoteView,
  extra: { replacedOffers?: number } = {},
) {
  const detail = await fetchVendorQuoteDetail(id, view);
  if (!detail) throw new NotFoundError("Quote request");
  return successResponse({ ...detail, ...extra });
}

export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:quotes:offer", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.EDIT_ORDERS,
      "You do not have permission to price quotes",
    );
    const body = await validateBody(request, SendOfferSchema);
    const view = await requireVendorQuoteView(session.user.id);
    const { detail, quote } = await loadVendorQuote(params.id, view);
    assertVendorQuoteMove(detail, "canSendPrice");

    const handedBack = await assertOfferNotOnLiveOrder(quote);
    const product = await loadOfferProduct(quote);
    // The quote went with the product when the store gave it to another
    // seller; one that stayed behind (it was on an order, or closed) is no
    // longer this vendor's to price.
    if (String(product.vendorId ?? "") !== String(view.vendorId)) {
      throw new ValidationError(
        "This product now belongs to another seller, so you can't price it.",
      );
    }
    const variant = resolveOfferVariant(quote, product, body.variantId);

    // A price the store already gave this shopper for the same line stands:
    // the vendor's would replace it.
    if (
      await holdsLiveStorePrice({
        ...quote,
        variantId: quote.variantId ?? variant?._id,
      })
    ) {
      throw new ValidationError(
        "The store has already sent this customer a price for this product, and the store's price stands.",
      );
    }

    const now = new Date();
    const { offer, update } = buildOfferUpdate({
      quote,
      body,
      variant,
      handedBack,
      actor: { userId: session.user.id, role: "vendor" },
      now,
    });

    const updated = await QuoteRequest.findOneAndUpdate(
      {
        _id: params.id,
        ...buildVendorQuoteFilter(view.vendorId),
        ...unchangedSinceRead(quote),
      },
      update,
      { returnDocument: "after", runValidators: true },
    ).lean<QuoteDoc | null>();
    if (!updated) throw new ConflictError(CHANGED);

    const replacedOffers = await withdrawSupersededOffers(
      updated,
      now,
      "vendor",
    ).catch((err) => {
      console.error("Failed to withdraw superseded quote offers:", err);
      return 0;
    });

    await auditQuoteOffer(
      createAuditContext(request, session, { vendorId: view.vendorId }),
      updated,
      {
        offer,
        previous: quote.offer?.unitPrice !== undefined ? quote.offer : null,
        status: { from: quote.status, to: updated.status },
        replacedOffers,
      },
    );

    await announceQuoteOffer(updated, offer);

    return offerResponse(params.id, view, { replacedOffers });
  },
);

/** Withdraw the vendor's own open price. The offer stays on the record. */
export const PATCH = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:quotes:offer", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.EDIT_ORDERS,
      "You do not have permission to price quotes",
    );
    const view = await requireVendorQuoteView(session.user.id);
    const { detail, quote } = await loadVendorQuote(params.id, view);
    assertVendorQuoteMove(detail, "canWithdraw");
    if (quote.offer?.unitPrice === undefined || quote.offer.withdrawnAt) {
      throw new ValidationError("There is no open price to withdraw.");
    }
    await assertOfferNotOnLiveOrder(quote);

    const updated = await QuoteRequest.findOneAndUpdate(
      {
        _id: params.id,
        ...buildVendorQuoteFilter(view.vendorId),
        ...unchangedSinceRead(quote),
      },
      {
        $set: {
          "offer.withdrawnAt": new Date(),
          "offer.withdrawnByRole": "vendor",
        },
      },
      { returnDocument: "after", runValidators: true },
    ).lean<QuoteDoc | null>();
    if (!updated) throw new ConflictError(CHANGED);

    await auditQuoteOfferWithdrawn(
      createAuditContext(request, session, { vendorId: view.vendorId }),
      updated,
      { offer: quote.offer },
    );

    // The shopper was told the price; they are told it is gone, too.
    await noticeQuoteWithdrawn(updated);

    return offerResponse(params.id, view);
  },
);
