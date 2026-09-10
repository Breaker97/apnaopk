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

/** Column/dropdown wording for each status. */
export const QUOTE_REQUEST_STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  new: "New",
  in_progress: "In progress",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

export function isQuoteRequestStatus(
  value: unknown,
): value is QuoteRequestStatus {
  return QUOTE_REQUEST_STATUSES.includes(value as QuoteRequestStatus);
}
