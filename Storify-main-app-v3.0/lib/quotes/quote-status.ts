/**
 * The quote-request lifecycle, kept out of the Mongoose model on purpose.
 *
 * The admin table renders the status dropdown from this list, and it is a
 * client component — importing the constant from `models/quote-request.model`
 * dragged mongoose (and through it the whole mongodb driver) into the browser
 * bundle. The model imports these from here instead, so there is still exactly
 * one list.
 */

export const QUOTE_REQUEST_STATUSES = [
  "new",
  "in_progress",
  "quoted",
  "won",
  "lost",
] as const;

export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

/**
 * How the merchant's price offer on a quote stands right now.
 *
 * Derived on read, never stored: only `offer.expiresAt`, `offer.withdrawnAt`
 * and the quote's `orderId` are persisted, and every state below falls out of
 * those three plus the bound order's own status. A stored copy would have to
 * be swept by a cron to turn `live` into `expired`, and would disagree with
 * reality for as long as the sweep was late — see lib/quotes/quote-offer.ts.
 */
export const QUOTE_OFFER_STATES = [
  "none",
  "live",
  "expired",
  "withdrawn",
  "ordered",
] as const;

export type QuoteOfferState = (typeof QUOTE_OFFER_STATES)[number];

/**
 * Where a quote stands for the shopper who asked for it — /account/quotes and
 * the shopper app read the same answer. Only what they can act on: the store's
 * own working labels ("In progress", "Won", "Lost") are for the merchant, and
 * a request the store closed reads `closed`, with a way to ask again.
 *
 *   awaiting   no price yet
 *   ready      the price is live: it can go in the cart
 *   ordered    an order holds the price
 *   expired    the price lapsed
 *   withdrawn  the store took the price back
 *   closed     the store closed the request without a price
 */
export const SHOPPER_QUOTE_STATES = [
  "awaiting",
  "ready",
  "ordered",
  "expired",
  "withdrawn",
  "closed",
] as const;

export type ShopperQuoteState = (typeof SHOPPER_QUOTE_STATES)[number];

export function shopperQuoteState(row: {
  offerState: QuoteOfferState;
  status: QuoteRequestStatus;
}): ShopperQuoteState {
  switch (row.offerState) {
    case "live":
      return "ready";
    case "ordered":
      return "ordered";
    case "expired":
      return "expired";
    case "withdrawn":
      return "withdrawn";
    default:
      return row.status === "lost" ? "closed" : "awaiting";
  }
}

/**
 * Where a quote stands, as the admin Quotes page shows it: one answer per
 * row, in place of the old staff dropdown plus a separate offer badge that
 * could say two different things at once ("Won" beside "Offer withdrawn").
 *
 * Derived on read, like the offer state above, from the stored `status`, the
 * offer and the order the offer was spent on — so it cannot disagree with
 * them. The only stored input a person sets is `lost`; everything else moves
 * because something happened (a price was sent, it lapsed, an order was
 * placed or paid). See `quoteStageExpression` in lib/quotes/quotes.ts.
 *
 *   needs_reply  asked, no price sent yet
 *   offer_sent   the price is live and buyable
 *   expired      the price lapsed without an order
 *   ordered      an order holds the price and is not paid yet
 *   won          that order is paid
 *   closed       marked lost, or the price was withdrawn
 */
export const QUOTE_STAGES = [
  "needs_reply",
  "offer_sent",
  "expired",
  "ordered",
  "won",
  "closed",
] as const;

export type QuoteStage = (typeof QUOTE_STAGES)[number];

/**
 * The admin list's tabs. `ordered` covers both stages an order can put a
 * quote in, paid or not: the tab answers "which of these became orders".
 */
const QUOTE_LIST_TABS = [
  "needs_reply",
  "offer_sent",
  "expired",
  "ordered",
  "closed",
] as const;

type QuoteListTab = (typeof QUOTE_LIST_TABS)[number];

export function isQuoteListTab(value: unknown): value is QuoteListTab {
  return QUOTE_LIST_TABS.includes(value as QuoteListTab);
}

/** The stages each tab lists. */
export const QUOTE_TAB_STAGES: Record<QuoteListTab, QuoteStage[]> = {
  needs_reply: ["needs_reply"],
  offer_sent: ["offer_sent"],
  expired: ["expired"],
  ordered: ["ordered", "won"],
  closed: ["closed"],
};

/**
 * Payment statuses that make the order an offer was spent on a paid one —
 * money arrived, even if some of it later went back.
 */
export const QUOTE_WON_PAYMENT_STATUSES = [
  "paid",
  "partially_refunded",
  "refunded",
] as const;

/**
 * Who moved a quote: the store (an admin or the platform's staff) or the
 * vendor whose product it is.
 *
 * Stored on each offer (`offeredByRole`, `withdrawnByRole`) and on a quote
 * closed as lost (`lostByRole`). Absent reads as `admin`: every price, every
 * withdrawal and every close written before vendors could answer quotes came
 * from the store.
 */
export const QUOTE_ACTOR_ROLES = ["admin", "vendor"] as const;

export type QuoteActorRole = (typeof QUOTE_ACTOR_ROLES)[number];

type OfferRoleSource = {
  unitPrice?: number | null;
  offeredByRole?: string | null;
  withdrawnAt?: string | Date | null;
  withdrawnByRole?: string | null;
} | null;

/** Who sent this offer; null when there is none. */
export function quoteOfferRole(offer: OfferRoleSource | undefined): QuoteActorRole | null {
  if (!offer || typeof offer.unitPrice !== "number") return null;
  return offer.offeredByRole === "vendor" ? "vendor" : "admin";
}

/** Who pulled this offer back; null while it has not been. */
export function quoteOfferWithdrawnRole(
  offer: OfferRoleSource | undefined,
): QuoteActorRole | null {
  if (!offer?.withdrawnAt) return null;
  return offer.withdrawnByRole === "vendor" ? "vendor" : "admin";
}

/**
 * Whether the store has taken this quote's price into its own hands: sent a
 * price, now or earlier, or pulled one back — the vendor's included.
 *
 * The store's price is final. Once it has acted on the price, the price is
 * the store's to set, and the vendor can read it but no longer re-price,
 * withdraw or close the quote — otherwise a vendor could put back a price the
 * store had just taken away.
 */
export function quotePricedByAdmin(quote: {
  offer?: OfferRoleSource;
  offerHistory?: OfferRoleSource[] | null;
}): boolean {
  return [quote.offer, ...(quote.offerHistory ?? [])].some(
    (offer) =>
      quoteOfferRole(offer) === "admin" ||
      quoteOfferWithdrawnRole(offer) === "admin",
  );
}

/**
 * What the vendor may do to one of its own quotes, given where it stands. The
 * vendor's routes refuse what this refuses, and the vendor's screens offer
 * only what it allows, so neither can drift from the other.
 *
 *   - Nothing once the store has priced it (`pricedByAdmin`), and nothing to a
 *     quote the store closed as lost: the store's word is final.
 *   - Nothing that touches the price while an order holds it.
 *   - The vendor's own note is always theirs to write.
 */
export function vendorQuoteMoves(quote: {
  stage: QuoteStage;
  status: QuoteRequestStatus;
  pricedByAdmin: boolean;
  lostByRole?: QuoteActorRole | null;
  offer?: { withdrawnAt?: string | Date | null } | null;
}) {
  const onOrder = quote.stage === "ordered" || quote.stage === "won";
  const lost = quote.status === "lost";
  const lostByStore = lost && quote.lostByRole !== "vendor";
  const lockedByStore = quote.pricedByAdmin || lostByStore;
  const open =
    quote.stage === "needs_reply" ||
    quote.stage === "offer_sent" ||
    quote.stage === "expired";
  const canReopen = !lockedByStore && lost && !quote.offer?.withdrawnAt;

  return {
    /** The store priced or closed it, so the vendor only reads it. */
    lockedByStore,
    canSendPrice: !lockedByStore && !onOrder && !canReopen,
    canWithdraw: !lockedByStore && quote.stage === "offer_sent",
    canMarkLost: !lockedByStore && open,
    canReopen,
  };
}
