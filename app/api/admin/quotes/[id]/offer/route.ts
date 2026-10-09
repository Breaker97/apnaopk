import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { QuoteRequest } from "@/models";
import {
  buildQuoteScopeFilter,
  fetchAdminQuoteDetail,
} from "@/lib/quotes/quotes";
import { mergeScopeFilter } from "@/lib/access/staff-scope";
import { withdrawSupersededOffers } from "@/lib/quotes/quote-offer";
import {
  announceQuoteOffer,
  assertOfferNotOnLiveOrder,
  buildOfferUpdate,
  loadOfferProduct,
  resolveOfferVariant,
  SendOfferSchema,
  type QuoteDoc,
} from "@/lib/quotes/quote-offer-write";
import { quoteOfferRole } from "@/lib/quotes/quote-status";
import { noticeQuoteWithdrawn } from "@/lib/quotes/quote-notices";
import {
  auditQuoteOffer,
  auditQuoteOfferWithdrawn,
} from "@/lib/quotes/audit-quote";
import { createAuditContext } from "@/lib/audit";
import { notifyVendorQuotePriceChanged } from "@/lib/notifications/notifications";

/**
 * The store answering a quote with a price.
 *
 * This is the one write that turns a lead into something buyable: from here
 * the shopper sees the number on the product page and can put it in the cart
 * at that price (lib/quotes/quote-offer.ts owns the rules on the other side).
 * It is kept off the generic PATCH because it is not a field edit — it
 * notifies the shopper, emails them, and moves the quote through its pipeline.
 *
 * The store's price is final. The vendor whose product it is may price its
 * own quotes (`/api/vendor/quotes/[id]/offer`), but a price the store sends
 * replaces the vendor's, and from then on the price is the store's to set —
 * so the store may always price here, and the vendor is told when its own
 * price is replaced or withdrawn.
 */

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

/** The vendor's own price, still standing, about to be overridden by the store. */
function vendorPriceStanding(quote: QuoteDoc): boolean {
  return quoteOfferRole(quote.offer) === "vendor" && !quote.offer?.withdrawnAt;
}

/**
 * What the admin page re-renders from: the same detail the sheet reads, so
 * the row's stage and the sheet agree the moment the write lands.
 */
async function offerResponse(
  id: string,
  scope: Parameters<typeof buildQuoteScopeFilter>[0],
  extra: { replacedOffers?: number } = {},
) {
  const detail = await fetchAdminQuoteDetail(id, scope);
  if (!detail) throw new NotFoundError("Quote request");
  return successResponse({ ...detail, ...extra });
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
    const handedBack = await assertOfferNotOnLiveOrder(quote);
    const product = await loadOfferProduct(quote);
    const variant = resolveOfferVariant(quote, product, body.variantId);

    const now = new Date();
    const { offer, update } = buildOfferUpdate({
      quote,
      body,
      variant,
      handedBack,
      actor: { userId: session?.user?.id, role: "admin" },
      now,
    });

    const updated = await QuoteRequest.findByIdAndUpdate(params.id, update, {
      returnDocument: "after",
      runValidators: true,
    }).lean<QuoteDoc | null>();
    if (!updated) throw new NotFoundError("Quote request");

    // One open price per shopper per line: this one replaces any other the
    // same shopper holds for this product and variant.
    const replacedOffers = await withdrawSupersededOffers(updated, now, "admin").catch(
      (err) => {
        console.error("Failed to withdraw superseded quote offers:", err);
        return 0;
      },
    );

    // The price is the record: it is what the shopper can now put in their cart.
    // A re-quote names the one it replaced, which moved into the history above.
    await auditQuoteOffer(createAuditContext(request, session), updated, {
      offer,
      previous: quote.offer?.unitPrice !== undefined ? quote.offer : null,
      status: { from: quote.status, to: updated.status },
      replacedOffers,
    });

    await Promise.allSettled([
      announceQuoteOffer(updated, offer),
      vendorPriceStanding(quote)
        ? notifyVendorQuotePriceChanged({
            quoteId: String(updated._id),
            vendorId: updated.vendorId,
            productName: updated.productName ?? "",
            kind: "replaced",
          })
        : Promise.resolve(),
    ]);

    return offerResponse(params.id, staff?.scope, { replacedOffers });
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
  async ({ request, params, staff, session }) => {
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
      {
        $set: {
          "offer.withdrawnAt": new Date(),
          "offer.withdrawnByRole": "admin",
        },
      },
      { returnDocument: "after", runValidators: true },
    ).lean<QuoteDoc | null>();
    if (!updated) throw new NotFoundError("Quote request");

    await auditQuoteOfferWithdrawn(createAuditContext(request, session), updated, {
      offer: quote.offer,
    });

    // The shopper was told the price; they are told it is gone, too. So is
    // the vendor, when the price was theirs.
    await Promise.allSettled([
      noticeQuoteWithdrawn(updated),
      vendorPriceStanding(quote)
        ? notifyVendorQuotePriceChanged({
            quoteId: String(updated._id),
            vendorId: updated.vendorId,
            productName: updated.productName ?? "",
            kind: "withdrawn",
          })
        : Promise.resolve(),
    ]);

    return offerResponse(params.id, staff?.scope);
  },
);
