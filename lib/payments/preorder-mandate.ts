/**
 * The shopper's authorisation to keep their card and charge the rest to it.
 *
 * A deposit or pay-later pre-order ends with money still owing, and the only
 * way to collect it without making the shopper come back and type their card
 * again is to save it (`setup_future_usage` on the deposit, a SetupIntent when
 * nothing is charged today). Saving a card for a later charge the shopper will
 * not be present for is not something a store may simply decide to do: Stripe
 * requires the agreement to be shown and obtained, card-network rules require
 * it, and in most markets this ships to so does the law.
 *
 * So this module owns the sentence they agree to, and it is deliberately ONE
 * function used by both sides. The checkout page renders it; the server
 * composes it again from its own figures and stores what it composed on the
 * order. Neither trusts the other's copy — the client sends a bare `true` and
 * nothing else — yet both produce the same string, because the builder formats
 * its own amount and date rather than taking them pre-formatted from a caller.
 * That is what makes the stored text evidence of what was actually on screen.
 *
 * The wording only claims things the code already does: the balance reminders
 * go out at T-7 and T-1 (`lib/orders/preorder-cron.ts`), and a cancellation
 * refunds in full whoever triggers it (`lib/orders/preorder-cancel-refund.ts`).
 * If either of those ever stops being true, this sentence is the first thing
 * that has to change.
 *
 * English only, like the pre-order terms it sits under. A mandate is a record
 * of an agreement, and one canonical wording is easier to stand behind than a
 * dozen translations nobody has checked. Translating it means translating the
 * stored copy too, not just the rendered one.
 */

/**
 * Tags the SetupIntent that collects a card for a pre-order whose whole total
 * falls due later, so the route that turns it into an order can tell it from
 * any other SetupIntent the account may hold.
 */
export const PREORDER_CARD_SETUP_KIND = "preorder_card_setup";

/** Formatted the same way in Node and in the browser — see the module note. */
function formatMandateAmount(amount: number, currency: string): string {
  const code = String(currency || "USD")
    .trim()
    .toUpperCase();
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    // An unknown code throws rather than falling back, and a mandate with no
    // amount in it is worse than one with an unlovely amount.
    return `${amount.toFixed(2)} ${code}`;
  }
}

function formatMandateDate(value?: Date | string | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * Whether this cart needs a mandate at all.
 *
 * A pre-order paid in full leaves nothing to collect later, so there is nothing
 * to authorise and no card to keep — asking would be collecting a permission
 * the store has no use for.
 */
export function preorderMandateRequired(outstandingAmount: number): boolean {
  return Number(outstandingAmount) > 0;
}

export function buildPreorderMandateText(params: {
  outstandingAmount: number;
  currency: string;
  releaseDate?: Date | string | null;
}): string {
  const amount = formatMandateAmount(
    Math.max(0, Number(params.outstandingAmount) || 0),
    params.currency,
  );
  const date = formatMandateDate(params.releaseDate);
  return (
    `I authorise this store to securely save my card and charge the remaining ${amount} to it ` +
    `when my pre-order is ready to ship${date ? `, expected around ${date}` : ""}. ` +
    `I will be told before the balance is taken, and I can cancel before it ships for a full refund.`
  );
}

/**
 * What the shopper is told when they try to check out without agreeing.
 *
 * Lives here rather than with the guard that throws it because the guard is
 * server-only (`lib/payments/deferred-balance.ts` — it answers with an HTTP
 * error) while this module is imported by the checkout page itself. Nothing
 * else in here may reach for a server import for the same reason.
 */
export const PREORDER_MANDATE_REQUIRED_MESSAGE =
  "Please authorise the remaining balance to be charged to your card when your pre-order ships.";
