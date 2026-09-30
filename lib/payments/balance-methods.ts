/**
 * The payment methods that can take the rest of a pre-order after checkout.
 *
 * Why the list is this short, and what earns a method its place on it, is in
 * `lib/payments/deferred-balance.ts`. Kept here, free of server imports, so the
 * checkout page and the server guard read one list: the page offered every
 * gateway and let the shopper fill in the form before refusing the one they
 * chose.
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

export function canCollectDeferredBalance(paymentMethod?: string | null) {
  return METHODS_THAT_CAN_COLLECT_A_BALANCE.has(
    String(paymentMethod || "")
      .trim()
      .toLowerCase(),
  );
}
