/**
 * One vocabulary for "why the payment did not go through".
 *
 * Every gateway says it differently — Stripe's `insufficient_funds`, Razorpay's
 * `payment_failed` with a reason beneath it, PayPal's `INSTRUMENT_DECLINED`,
 * MTN's `PAYER_LIMIT_REACHED` — and until now whichever string arrived was
 * what the shopper saw. A shopper cannot act on `BAD_REQUEST_ERROR`, and a
 * merchant cannot count what has forty spellings.
 *
 * So the gateway's own code is kept (`gatewayCode`, shown to staff) and a
 * normalized one is stored beside it: the shopper reads a sentence written for
 * the normalized code, the admin counts by it, and the card-testing rule asks
 * whether it is the kind of refusal a script produces.
 *
 * Deliberately free of `server-only` and of any import: the checkout page maps
 * a code to its message with the same table the server writes it with.
 */

export const PAYMENT_FAILURE_CODE = {
  /** The card is fine, the money is not there. */
  INSUFFICIENT_FUNDS: "insufficient_funds",
  /** The issuer said no without saying why — the commonest answer of all. */
  CARD_DECLINED: "card_declined",
  EXPIRED_CARD: "expired_card",
  INCORRECT_CVC: "incorrect_cvc",
  INCORRECT_NUMBER: "incorrect_number",
  /** 3-D Secure was started and not finished. */
  AUTHENTICATION_FAILED: "authentication_failed",
  /** The billing address or postcode did not match the card. */
  ADDRESS_CHECK_FAILED: "address_check_failed",
  /** The gateway's own risk rules stopped it. */
  BLOCKED_BY_RISK: "blocked_by_risk",
  /**
   * The provider does not take this card at all — issued abroad on an account
   * that accepts domestic cards only, or a card type or currency it does not
   * support. Neither a retry nor the bank will change that; another card or
   * method will. Not an outage either: the gateway is working as configured.
   */
  CARD_NOT_SUPPORTED: "card_not_supported",
  /** The shopper closed the gateway's page or the mobile prompt. */
  CANCELLED_BY_SHOPPER: "cancelled_by_shopper",
  /** A mobile-money prompt nobody answered in time. */
  WINDOW_CLOSED: "window_closed",
  /** The gateway refused the REQUEST — nothing was ever put to the payer. */
  GATEWAY_REFUSED_REQUEST: "gateway_refused_request",
  /** The gateway broke, timed out, or answered something unreadable. */
  PROCESSING_ERROR: "processing_error",
  UNKNOWN: "unknown",
} as const;

type PaymentFailureCode =
  (typeof PAYMENT_FAILURE_CODE)[keyof typeof PAYMENT_FAILURE_CODE];

/**
 * The refusals a card-testing run produces.
 *
 * A script feeding stolen numbers gets these and almost nothing else, while a
 * real shopper's bad afternoon looks like `insufficient_funds` and
 * `authentication_failed`. Counting only these keeps an honest customer who
 * mistypes a CVC three times out of the blocked bucket.
 */
export const CARD_TESTING_FAILURE_CODES: readonly PaymentFailureCode[] = [
  PAYMENT_FAILURE_CODE.CARD_DECLINED,
  PAYMENT_FAILURE_CODE.INCORRECT_NUMBER,
  PAYMENT_FAILURE_CODE.INCORRECT_CVC,
  PAYMENT_FAILURE_CODE.EXPIRED_CARD,
  PAYMENT_FAILURE_CODE.BLOCKED_BY_RISK,
];

/**
 * Every gateway's own spelling, in one table.
 *
 * Matched on the code first and the message second, because several gateways
 * send one code for everything and put the real answer in the sentence (Razorpay
 * `BAD_REQUEST_ERROR` + "insufficient funds"). Anything unrecognised becomes
 * `unknown` rather than being guessed at: a wrong sentence shown to a shopper
 * is worse than a vague one, and `unknown` is what tells us the table needs
 * another row.
 */
const CODE_PATTERNS: Array<[RegExp, PaymentFailureCode]> = [
  [/insufficient[_\s-]?funds|not[_\s-]?enough[_\s-]?(funds|balance)|low[_\s-]?balance|NOT_ENOUGH_FUNDS/i, PAYMENT_FAILURE_CODE.INSUFFICIENT_FUNDS],
  [/expired[_\s-]?card|card[_\s-]?expired/i, PAYMENT_FAILURE_CODE.EXPIRED_CARD],
  [/incorrect[_\s-]?cvc|invalid[_\s-]?cvc|cvv|security[_\s-]?code/i, PAYMENT_FAILURE_CODE.INCORRECT_CVC],
  [/incorrect[_\s-]?number|invalid[_\s-]?number|invalid[_\s-]?card[_\s-]?number/i, PAYMENT_FAILURE_CODE.INCORRECT_NUMBER],
  [/authentication|3ds|three[_\s-]?d[_\s-]?secure|CONFIRMATION_REJECTED/i, PAYMENT_FAILURE_CODE.AUTHENTICATION_FAILED],
  [/postal|zip|avs|address[_\s-]?(check|mismatch)|incorrect[_\s-]?address/i, PAYMENT_FAILURE_CODE.ADDRESS_CHECK_FAILED],
  [/fraud|risk|blocked|suspect|do[_\s-]?not[_\s-]?honou?r/i, PAYMENT_FAILURE_CODE.BLOCKED_BY_RISK],
  [/cancel|abandon|payer[_\s-]?action|user[_\s-]?denied|PAYER_LIMIT/i, PAYMENT_FAILURE_CODE.CANCELLED_BY_SHOPPER],
  [/expired[_\s-]?(window|session)|timed?[_\s-]?out|window[_\s-]?closed|no[_\s-]?reference/i, PAYMENT_FAILURE_CODE.WINDOW_CLOSED],
  [/refused[_\s-]?request|out[_\s-]?of[_\s-]?stock|session[_\s-]?not[_\s-]?stored/i, PAYMENT_FAILURE_CODE.GATEWAY_REFUSED_REQUEST],
  // Before the catch-all refusals below: Razorpay's
  // `international_transaction_not_allowed` ("International cards are not
  // supported") used to fall through to `unknown`, which the outage check
  // counts — a store taking many foreign cards on a domestic-only account was
  // one busy hour from being told its gateway was down.
  [/international|not[_\s-]?supported|unsupported|transaction[_\s-]?not[_\s-]?(allowed|permitted)/i, PAYMENT_FAILURE_CODE.CARD_NOT_SUPPORTED],
  [/declin|card[_\s-]?error|INSTRUMENT_DECLINED|payment[_\s-]?failed/i, PAYMENT_FAILURE_CODE.CARD_DECLINED],
  [/processing[_\s-]?error|try[_\s-]?again|internal|unavailable|5\d\d/i, PAYMENT_FAILURE_CODE.PROCESSING_ERROR],
];

/**
 * The normalized code for what a gateway said.
 *
 * Reads the code and the message together: `rawCode` is checked first because
 * a code is precise, then the message, which is where several gateways hide
 * the real reason.
 */
export function normalizeFailureCode(
  rawCode?: string | null,
  rawMessage?: string | null,
): PaymentFailureCode {
  for (const source of [rawCode, rawMessage]) {
    const text = String(source || "").trim();
    if (!text) continue;
    for (const [pattern, code] of CODE_PATTERNS) {
      if (pattern.test(text)) return code;
    }
  }
  return PAYMENT_FAILURE_CODE.UNKNOWN;
}

/** Whether this refusal is of the kind a card-testing script produces. */
export function isCardTestingFailure(code?: string | null): boolean {
  return (CARD_TESTING_FAILURE_CODES as readonly string[]).includes(
    String(code || ""),
  );
}

/**
 * What the shopper is told, in English, when no translation is loaded.
 *
 * Each one says what happened and what to do about it — a message a shopper
 * can act on is the difference between a retry and an abandoned cart. The
 * translated versions live under `checkout.paymentFailure.<code>`.
 */
export const FAILURE_MESSAGE_FALLBACK: Record<PaymentFailureCode, string> = {
  [PAYMENT_FAILURE_CODE.INSUFFICIENT_FUNDS]:
    "Your card does not have enough funds for this payment. Try another card or another payment method.",
  [PAYMENT_FAILURE_CODE.CARD_DECLINED]:
    "Your bank declined this payment. They can tell you why — or you can try another card.",
  [PAYMENT_FAILURE_CODE.EXPIRED_CARD]:
    "That card has expired. Try another card.",
  [PAYMENT_FAILURE_CODE.INCORRECT_CVC]:
    "The security code did not match the card. Check the three digits on the back and try again.",
  [PAYMENT_FAILURE_CODE.INCORRECT_NUMBER]:
    "That card number does not look right. Check it and try again.",
  [PAYMENT_FAILURE_CODE.AUTHENTICATION_FAILED]:
    "Your bank's verification was not completed, so the payment was stopped. Try again and finish the check your bank shows you.",
  [PAYMENT_FAILURE_CODE.ADDRESS_CHECK_FAILED]:
    "The billing address does not match the one your bank has for this card. Correct it and try again.",
  [PAYMENT_FAILURE_CODE.BLOCKED_BY_RISK]:
    "This payment was stopped by a security check. Try another payment method, or contact us and we will help.",
  [PAYMENT_FAILURE_CODE.CARD_NOT_SUPPORTED]:
    "This card can't be used for this payment — often because it was issued in another country. Try another card or another payment method.",
  [PAYMENT_FAILURE_CODE.CANCELLED_BY_SHOPPER]:
    "The payment was cancelled before it finished. Nothing has been charged — you can try again.",
  [PAYMENT_FAILURE_CODE.WINDOW_CLOSED]:
    "The payment was not completed in time and the session closed. Nothing has been charged — start it again.",
  [PAYMENT_FAILURE_CODE.GATEWAY_REFUSED_REQUEST]:
    "The payment provider could not start this payment. Try again, or choose another payment method.",
  [PAYMENT_FAILURE_CODE.PROCESSING_ERROR]:
    "The payment provider had a problem and could not finish. Nothing has been charged — please try again.",
  [PAYMENT_FAILURE_CODE.UNKNOWN]:
    "The payment did not go through. Nothing has been charged — try again, or use another payment method.",
};
