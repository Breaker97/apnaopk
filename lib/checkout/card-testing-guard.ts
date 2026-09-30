import { PaymentTransaction } from "@/models";
import { CARD_TESTING_FAILURE_CODES } from "@/lib/payments/failure-codes";

/**
 * What to do about a checkout that keeps being refused.
 *
 * Card testing is somebody feeding stolen numbers through a shop's checkout to
 * find which ones still work. The store is not the target — it is the tool —
 * and the damage lands on it anyway: a surge of declines drags the whole
 * shop's authorisation rate down with the banks for weeks afterwards, so
 * honest shoppers start being refused too.
 *
 * Three steps, deliberately in this order:
 *
 *  1. **Nothing at all** for the first couple of refusals. A real shopper
 *     mistypes a CVC, tries the other card in their wallet, and must not be
 *     made to prove anything.
 *  2. **A human check** once the refusals look like a script's (see
 *     `CARD_TESTING_FAILURE_CODES`). Cheap for a person, expensive for a bot.
 *  3. **A pause** after that — and only for this checkout session and this
 *     email address.
 *
 * **Why the block is never keyed on the IP alone.** In Bangladesh, and across
 * much of Africa and South Asia, a mobile carrier puts thousands of shoppers
 * behind one address. Blocking it blocks a town. So an IP only ever RAISES the
 * check to a captcha — the pause itself follows the session and the email,
 * which a script has to churn to get past, and churning them is what the
 * captcha is there for.
 *
 * Counted from the payment log, which every gateway already writes to
 * (`recordChargeFailure`), so this needs no store of its own.
 */

/** Refusals within this window count towards the thresholds. */
const WINDOW_MS = 30 * 60 * 1000;

/** How long a paused checkout waits. */
const BLOCK_MS = 30 * 60 * 1000;

type CardTestingThresholds = {
  /** Refusals before a human check is asked for. */
  captchaAfter: number;
  /** Refusals before the checkout is paused. */
  blockAfter: number;
  /**
   * Refusals from one address before a human check is asked of everyone
   * behind it. Higher than the others on purpose — see the note above.
   */
  captchaAfterFromAddress: number;
};

export const DEFAULT_CARD_TESTING_THRESHOLDS: CardTestingThresholds = {
  captchaAfter: 3,
  blockAfter: 6,
  captchaAfterFromAddress: 12,
};

type CheckoutIdentity = {
  /** The cart's own token — the closest thing to "this checkout". */
  checkoutToken?: string | null;
  email?: string | null;
  clientIp?: string | null;
};

type CardTestingVerdict = {
  /** Refusals counted against this shopper in the window. */
  failures: number;
  /** A human check is required before another payment is started. */
  requireCaptcha: boolean;
  /** No payment may be started at all yet. */
  blocked: boolean;
  /** When the pause lifts, if it is on. */
  retryAt?: Date;
};

/**
 * How many refusals of the card-testing kind this shopper has collected, and
 * what that means for the next attempt.
 *
 * Reads three counts because a script changes whatever is cheapest to change:
 * a new cart token costs nothing, a new email address costs little, a new
 * address costs real money. Each has its own threshold, and the address's is
 * high because it is shared.
 */
export async function assessCardTesting(
  identity: CheckoutIdentity,
  thresholds: CardTestingThresholds = DEFAULT_CARD_TESTING_THRESHOLDS,
): Promise<CardTestingVerdict> {
  const since = new Date(Date.now() - WINDOW_MS);
  const base = {
    type: "charge",
    status: "failed",
    createdAt: { $gte: since },
    failureCode: { $in: [...CARD_TESTING_FAILURE_CODES] },
  } as const;

  const email = String(identity.email || "").trim().toLowerCase();
  const [byCheckout, byEmail, byAddress] = await Promise.all([
    identity.checkoutToken
      ? PaymentTransaction.countDocuments({
          ...base,
          checkoutToken: identity.checkoutToken,
        })
      : 0,
    email
      ? PaymentTransaction.countDocuments({
          ...base,
          customerEmail: email,
        })
      : 0,
    identity.clientIp
      ? PaymentTransaction.countDocuments({
          ...base,
          clientIp: identity.clientIp,
        })
      : 0,
  ]);

  // The worst of the three that follows this shopper: a script that starts a
  // fresh cart for every card is still the same email address.
  const failures = Math.max(byCheckout, byEmail);

  const blocked = failures >= thresholds.blockAfter;
  return {
    failures,
    blocked,
    requireCaptcha:
      blocked ||
      failures >= thresholds.captchaAfter ||
      byAddress >= thresholds.captchaAfterFromAddress,
    ...(blocked ? { retryAt: new Date(Date.now() + BLOCK_MS) } : {}),
  };
}

/** What a paused shopper is told. Never says how the pause is decided. */
export const CARD_TESTING_BLOCKED_MESSAGE =
  "Too many payment attempts have been refused. Please wait about half an hour and try again, or contact us and we will help you complete the order.";

/** What a shopper is told when the human check fails or is missing. */
export const CARD_TESTING_CAPTCHA_MESSAGE =
  "Please complete the check below to confirm you are not a robot, then try the payment again.";
