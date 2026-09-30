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
