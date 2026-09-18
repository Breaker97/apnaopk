import { ValidationError } from "@/lib/api/errors";
import {
  PREORDER_MANDATE_REQUIRED_MESSAGE,
  preorderMandateRequired,
} from "@/lib/payments/preorder-mandate";

/**
 * Whether the rest of a pre-order can still be collected after checkout.
 *
 * A deposit or pay-later pre-order is a promise to take more money later, and
 * only a gateway that can be charged a second time against the same order can
 * keep that promise. Two can: `lib/payments/preorder-balance.ts` builds a
 * Stripe PaymentIntent for the outstanding amount (and can charge a saved card
 * off-session), and `lib/payments/preorder-balance-paypal.ts` raises a PayPal
 * order for it. No other gateway has an equivalent path yet.
 *
 * Checkout works out `paymentDueNow = total - outstanding` BEFORE it picks a
 * gateway, so until this guard a deposit pre-order could be placed on any of
 * them. The deposit was taken and then there was no way to ask for the rest:
 * the order sat `partially_paid` for good, its quota stayed reserved against a
 * sale that could never complete, and the vendor's earnings stayed held. The
 * customer had paid and could not finish paying.
 *
 * Refusing at checkout is the only honest answer while that is true — the
 * alternative is taking money for something the store cannot deliver on.
 *
 * Add a method to the set ONLY once a balance module can genuinely charge it
 * off-session or hand its customer a working payment page — and the refund
 * path can reach the balance it collects (`preorderRefundLegs` in
 * `lib/orders/order-refund.ts`); the set is the claim, not the intention.
 */
const METHODS_THAT_CAN_COLLECT_A_BALANCE: ReadonlySet<string> = new Set([
  // Stripe is called `card` on an order — that is the name checkout's own enum
  // uses (`lib/validations/index.ts`) and the one `payment-custody.ts` reads.
  // Listing only "stripe" here blocked every deposit pre-order at checkout,
  // including the one gateway that can actually collect the balance, because
  // no order has ever carried that string.
  "card",
  // The Stripe intent route names the gateway rather than the order field, so
  // both spellings resolve to the same capability.
  "stripe",
  // PayPal can hand its shopper a working payment page for the balance
  // (`lib/payments/preorder-balance-paypal.ts`): an order raised for exactly
  // what is owed, approved at PayPal, captured on return. It cannot take the
  // balance off-session — that needs PayPal's Vault, a separate merchant
  // approval — so a PayPal shopper is always asked, never charged unprompted.
  "paypal",
]);

/**
 * The name each gateway's settings block goes by, against the name an order
 * carries once it is paid on that gateway.
 *
 * Only Stripe differs, and that difference has already caused one outage of
 * its own: the settings key is `stripe` while every order says `card`.
 */
type GatewayKey =
  | "stripe"
  | "paypal"
  | "razorpay"
  | "paystack"
  | "pesapal"
  | "iotec"
  | "orange_money"
  | "mtn_momo";

const SETTINGS_KEY_TO_ORDER_METHOD: ReadonlyArray<readonly [GatewayKey, string]> = [
  ["stripe", "card"],
  ["paypal", "paypal"],
  ["razorpay", "razorpay"],
  ["paystack", "paystack"],
  ["pesapal", "pesapal"],
  ["iotec", "iotec"],
  ["orange_money", "orange_money"],
  ["mtn_momo", "mtn_momo"],
];

/**
 * Whether this store has ANY gateway switched on that could take the rest of a
 * pre-order later.
 *
 * Asked when a vendor saves a product, not when a shopper pays: a deposit or
 * pay-later pre-order on a store with no such gateway is a listing that can
 * never complete a sale. Refusing it at checkout protects the shopper's money
 * but tells the wrong person, weeks late — the vendor set it up and the
 * customer discovers it.
 *
 * Derived from the same allowlist as the checkout guard, so a gateway that
 * grows a balance path becomes selectable and payable in the same commit.
 */
export function storeCanCollectDeferredBalance(
  payment?: Partial<Record<GatewayKey, { enabled?: boolean } | undefined>> | null,
): boolean {
  return SETTINGS_KEY_TO_ORDER_METHOD.some(
    ([key, method]) =>
      Boolean(payment?.[key]?.enabled) && canCollectDeferredBalance(method),
  );
}

export function canCollectDeferredBalance(paymentMethod?: string | null) {
  return METHODS_THAT_CAN_COLLECT_A_BALANCE.has(
    String(paymentMethod || "")
      .trim()
      .toLowerCase(),
  );
}

/**
 * Refuse a checkout that would leave money owing nobody can collect.
 *
 * A no-op unless the cart actually leaves a balance — a pre-order paid in full
 * is a normal sale as far as the gateway is concerned, and every method may
 * take it.
 */
export function assertDeferredBalanceCollectable(params: {
  paymentMethod?: string | null;
  outstandingAmount: number;
}) {
  if (!(Number(params.outstandingAmount) > 0)) return;

  if (!canCollectDeferredBalance(params.paymentMethod)) {
    throw new ValidationError({
      paymentMethod: [
        "This payment method cannot collect the rest of a pre-order later. Pay by card or PayPal, or choose a pre-order that is paid in full.",
      ],
    });
  }

  // Guests used to be refused here. Their order's `customerId` is its CART,
  // not a user, so the balance page — which authenticates the caller and
  // matches that id — had no way to let them in, and taking a deposit nobody
  // could top up would have been worse than turning the sale away.
  //
  // `lib/payments/preorder-balance-link.ts` is the route in that was missing:
  // the "balance due" email carries a link signed for the order, and the two
  // balance routes accept it in place of a session. So the refusal is gone,
  // and nothing about the sale depends on whether an account stands behind it
  // any more — not even whether a card is kept (see the mandate guard below).
}

/**
 * Refuse a checkout that would keep a card nobody agreed to let it keep.
 *
 * The companion to `assertDeferredBalanceCollectable` above, and called beside
 * it: that one asks whether the rest of the money CAN be collected, this one
 * whether the store has been given leave to collect it the easy way. A no-op
 * when the cart owes nothing later, so an ordinary sale — and a pre-order paid
 * in full — never sees it, and a no-op for a checkout that keeps no card.
 *
 * Server-side only, which is why it is here and not with the wording it
 * enforces: the checkout page imports that module to render the sentence, and
 * `ValidationError` would drag `next/server` into the browser bundle with it.
 */
export function assertPreorderMandateAccepted(params: {
  outstandingAmount: number;
  accepted?: boolean;
  /**
   * Whether this checkout keeps a card at all. Only a card checkout does, so
   * only a card checkout is asked: a mandate taken at a PayPal checkout would
   * be permission to charge a card nobody entered.
   *
   * Required rather than defaulted, because both wrong defaults are bad. Assume
   * true and a non-card checkout is refused over a sentence about cards; assume
   * false and a card is kept unasked. Every caller has to know which it is.
   *
   * It used to be `isGuestOrder`, when a guest had no Customer to keep a card
   * on. They have one now (`resolveGuestStripeCustomerId`), so a guest paying
   * by card is asked exactly like anybody else — and a guest whose email
   * matched an account, who fell between the two rules and was refused over a
   * checkbox they were never shown, is no longer a special case at all.
   */
  savesCard: boolean;
}): void {
  if (!params.savesCard) return;
  if (!preorderMandateRequired(params.outstandingAmount)) return;
  if (params.accepted === true) return;
  throw new ValidationError({
    preorderMandateAccepted: [PREORDER_MANDATE_REQUIRED_MESSAGE],
  });
}
