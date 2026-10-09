import { audit, type AuditContext } from "@/lib/audit";

/**
 * What staff — and the vendor whose product it is — do to a quote request:
 * price it, pull the price back, close it, reopen it, annotate it, delete it
 * (that last one the store's alone). A vendor's route passes its vendor in the
 * audit context, so the row lands in the vendor's Activity log too.
 *
 * A quote is how a "price on request" product gets its price, so the number an
 * admin typed and the shopper was sent is the record that matters — it is what
 * the shopper can put in their cart. Written in the voice of
 * `lib/orders/audit-order.ts`: the summary is a whole sentence that stands on
 * its own in the list.
 */

interface QuoteRef {
  _id: unknown;
  productName?: string;
  /** The shopper who asked. */
  name?: string;
}

interface OfferFigures {
  unitPrice?: number | null;
  quantity?: number | null;
  expiresAt?: Date | string | null;
}

/** What the list calls it, and how a sentence opens about it. */
const subject = (quote: QuoteRef) =>
  quote.productName ? `Quote for ${quote.productName}` : "Quote request";

function ref(quote: QuoteRef) {
  return { resourceId: String(quote._id), resourceName: subject(quote) };
}

/** The same, in the middle of a sentence. */
const forProduct = (quote: QuoteRef) =>
  quote.productName ? `the quote for ${quote.productName}` : "the quote request";

const money = (amount: number) => (Number.isFinite(amount) ? amount.toFixed(2) : "0.00");

/** "3.00 each for 608 units": the offer as the shopper reads it. */
function price(offer: OfferFigures) {
  const quantity = Number(offer.quantity ?? 0);
  return `${money(Number(offer.unitPrice ?? 0))} each for ${quantity} unit${quantity === 1 ? "" : "s"}`;
}

function day(value?: Date | string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function offerSnapshot(offer: OfferFigures) {
  return {
    unitPrice: Number(offer.unitPrice ?? 0),
    quantity: Number(offer.quantity ?? 0),
    expiresAt: day(offer.expiresAt),
  };
}

/**
 * A price sent. A re-quote says what it replaced, because the old figure is
 * pushed into the quote's history and the new one is what the shopper sees.
 */
export function auditQuoteOffer(
  context: AuditContext,
  quote: QuoteRef,
  details: {
    offer: OfferFigures;
    previous?: OfferFigures | null;
    status: { from?: string; to?: string };
    /** The shopper's other open prices for the same line, withdrawn in its favour. */
    replacedOffers?: number;
  },
) {
  const expires = day(details.offer.expiresAt);
  const statusChanged = (details.status.from ?? null) !== (details.status.to ?? null);
  return audit(context, {
    action: "UPDATE",
    resource: "quote",
    ...ref(quote),
    changes: {
      before: {
        offer: details.previous ? offerSnapshot(details.previous) : null,
        ...(statusChanged ? { status: details.status.from ?? null } : {}),
      },
      after: {
        offer: offerSnapshot(details.offer),
        ...(statusChanged ? { status: details.status.to ?? null } : {}),
      },
      fields: ["offer", ...(statusChanged ? ["status"] : [])],
      summary: `Quote offer sent to ${quote.name || "the customer"} for ${
        quote.productName || "a product"
      }: ${price(details.offer)}${expires ? `, valid until ${expires}` : ""}${
        details.previous ? ` (was ${price(details.previous)})` : ""
      }`,
    },
    metadata: details.replacedOffers ? { replacedOffers: details.replacedOffers } : undefined,
  });
}

/** A price pulled back. It stays on the record, stamped, so this is an update. */
export function auditQuoteOfferWithdrawn(
  context: AuditContext,
  quote: QuoteRef,
  details: { offer: OfferFigures },
) {
  return audit(context, {
    action: "UPDATE",
    resource: "quote",
    ...ref(quote),
    changes: {
      before: { offerWithdrawn: false },
      after: { offerWithdrawn: true },
      fields: ["offerWithdrawn"],
      summary: `Quote offer of ${price(details.offer)} withdrawn on ${forProduct(quote)}`,
    },
    metadata: { offer: offerSnapshot(details.offer) },
  });
}

/** Closed as lost, or taken back into the queue. */
export function auditQuoteStatus(
  context: AuditContext,
  quote: QuoteRef,
  details: { from?: string; to: string; offerWithdrawn?: boolean },
) {
  const closing = details.to === "lost";
  return audit(context, {
    action: "STATUS_CHANGE",
    resource: "quote",
    ...ref(quote),
    changes: {
      before: { status: details.from ?? null },
      after: { status: details.to },
      fields: ["status"],
      summary: closing
        ? `${subject(quote)} marked lost${
            details.offerWithdrawn ? " and its open offer withdrawn" : ""
          }`
        : `${subject(quote)} reopened (status ${details.from ?? "none"} → ${details.to})`,
    },
    metadata: details.offerWithdrawn ? { offerWithdrawn: true } : undefined,
  });
}

/**
 * A note edited: the store's internal one, or the vendor's own. Its text is
 * the writer's own and is left out: the row records that it changed and by
 * whom.
 */
export function auditQuoteNote(
  context: AuditContext,
  quote: QuoteRef,
  details: { cleared: boolean; field?: "adminNote" | "vendorNote" },
) {
  const field = details.field ?? "adminNote";
  const label = field === "vendorNote" ? "Vendor note" : "Internal note";
  return audit(context, {
    action: "UPDATE",
    resource: "quote",
    ...ref(quote),
    changes: {
      fields: [field],
      summary: `${label} ${details.cleared ? "cleared" : "updated"} on ${forProduct(quote)}`,
    },
  });
}

/** A request deleted, which the route allows only for one that never became an order. */
export function auditQuoteDeleted(
  context: AuditContext,
  quote: QuoteRef,
  details: { status?: string; quantity?: number; offer?: OfferFigures | null },
) {
  return audit(context, {
    action: "DELETE",
    resource: "quote",
    ...ref(quote),
    changes: {
      before: {
        status: details.status ?? null,
        quantity: details.quantity ?? null,
        offer: details.offer ? offerSnapshot(details.offer) : null,
      },
      summary: `Quote request from ${quote.name || "a customer"} for ${
        quote.productName || "a product"
      } deleted`,
    },
  });
}
