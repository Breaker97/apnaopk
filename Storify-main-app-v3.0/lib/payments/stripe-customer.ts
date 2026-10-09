import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { User } from "@/models";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
} from "@/lib/payments/stripe";

/**
 * The shopper's Stripe Customer — the thing a card can be saved against.
 *
 * Storify takes deposits and pay-later pre-orders, then asks the shopper to
 * come back and pay the balance themselves. The reason it has to ask is here:
 * a card can only be charged again without the shopper present if it was
 * saved (`setup_future_usage` / a SetupIntent), and a card can only be saved
 * against a **Customer**. Every shopper-facing PaymentIntent this codebase has
 * ever created was made without one, so there has never been anywhere for a
 * card to go.
 *
 * This module is that missing half, and only that half. Nothing here saves a
 * card: charging a shopper off-session needs their explicit consent collected
 * at checkout (Stripe requires the mandate text, and so does the law in most
 * markets this ships to), and consent belongs with the UI that asks for it.
 * What this does is make sure that by the time that consent exists, every
 * shopper already has a Customer for the card to hang off — including the ones
 * who paid last month.
 *
 * Until then a Customer still earns its keep: Stripe groups the shopper's
 * payments, Radar scores them as a returning buyer rather than a stranger, and
 * refunds and disputes arrive attached to a person instead of an orphan charge.
 *
 * **Best-effort, always.** A shopper's payment must never fail because their
 * Customer could not be minted, so every error here ends as `undefined` and
 * the charge goes out unattached, exactly as it did before this existed.
 */

type ResolveParams = {
  /** Resolved Stripe secret key, as every other Stripe caller passes it. */
  secretKey?: string;
  /**
   * The id the order will carry. A guest's is their CART, not a user — the
   * lookup below simply finds no user and the caller gets `undefined`, which
   * is the honest answer: there is no account to hang a saved card off.
   */
  userId?: string;
  email?: string;
  name?: string;
};

/**
 * Stripe's answer when an id belongs to no customer on this account.
 *
 * Three different situations wear it, and all three want the same fix — mint a
 * new one: the customer was deleted in the dashboard, the store moved to a
 * different Stripe account, or the store switched between test and live keys
 * (ids do not cross that line, and there is no mode flag stored anywhere to
 * warn us in advance — the key itself is the mode).
 */
function isMissingCustomer(err: unknown): boolean {
  const candidate = err as { code?: string; statusCode?: number } | null;
  return candidate?.code === "resource_missing" || candidate?.statusCode === 404;
}

async function getOrCreateStripeCustomer(
  params: ResolveParams,
): Promise<string | undefined> {
  if (!isStripeSecretKeyConfigured(params.secretKey)) return undefined;

  const userId = String(params.userId || "");
  if (!Types.ObjectId.isValid(userId)) return undefined;

  const user = await User.findById(userId)
    .select("stripeCustomerId email name")
    .lean();
  if (!user) return undefined;

  const stripe = getStripeForSecretKey(params.secretKey);
  const stored = String(user.stripeCustomerId || "").trim();

  /** The id being replaced, when the stored one turned out to be unusable. */
  let staleId: string | undefined;

  if (stored) {
    try {
      const existing = await stripe.customers.retrieve(stored);
      if (!("deleted" in existing && existing.deleted)) {
        // Keep the address on the Customer current. It is not decoration: the
        // hosted Checkout Session now identifies the shopper by Customer
        // instead of by `customer_email`, so a Customer still carrying an
        // email from six months ago is the email the shopper is shown — and
        // the one their receipt goes to. Best-effort and swallowed on its own:
        // a stale email is worth far less than the Customer it hangs on.
        const email = params.email?.trim();
        if (email && email.toLowerCase() !== (existing.email || "").toLowerCase()) {
          await stripe.customers
            .update(existing.id, { email })
            .catch((err) =>
              console.error("Failed to refresh a Stripe customer's email:", err),
            );
        }
        return existing.id;
      }
      staleId = stored;
    } catch (err) {
      // Only "this account has never heard of that id" justifies minting a
      // second Customer. A timeout or a rate limit says nothing about whether
      // the mapping is good, and treating it as gone would leave a trail of
      // duplicate Customers behind every bad minute Stripe has.
      if (!isMissingCustomer(err)) return stored;
      staleId = stored;
    }
  }

  const created = await stripe.customers.create(
    {
      email: params.email || user.email || undefined,
      name: params.name || user.name || undefined,
      // The way back from a Customer to the account it belongs to, for support
      // and for finding orphans left by a lost claim below.
      metadata: { userId },
    },
    {
      // Two checkouts opened in two tabs both find no stored id and both
      // create; the key makes Stripe answer the second with the first's
      // Customer instead of minting a twin.
      //
      // The stale id is part of the key for the same reason the balance intent
      // names its own previous attempt: a replayed key returns the ORIGINAL
      // response, so recreating after a deletion under the plain key would
      // hand back the very customer we just found to be gone, and go on doing
      // so for the 24 hours Stripe remembers it.
      idempotencyKey: staleId
        ? `stripe-customer:${userId}:after:${staleId}`
        : `stripe-customer:${userId}`,
    },
  );

  // Claim it. A concurrent request that stored first keeps its write — but
  // thanks to the key above it stored this same id, so the loser has nothing
  // to correct. The guard is what stops a late reply from overwriting a newer
  // mapping with an older one.
  await User.updateOne(
    {
      _id: user._id,
      $or: [
        { stripeCustomerId: null },
        { stripeCustomerId: "" },
        { stripeCustomerId: { $exists: false } },
        { stripeCustomerId: created.id },
        ...(staleId ? [{ stripeCustomerId: staleId }] : []),
      ],
    },
    { $set: { stripeCustomerId: created.id } },
  );

  return created.id;
}

/**
 * The Customer id to put on a shopper's charge, or `undefined` to leave it off.
 *
 * Never throws: see the module note. Callers spread it in
 * (`...(id ? { customer: id } : {})`) so an absent one changes nothing about
 * the request that goes to Stripe.
 */
export async function resolveStripeCustomerId(
  params: ResolveParams,
): Promise<string | undefined> {
  try {
    return await getOrCreateStripeCustomer(params);
  } catch (err) {
    console.error("Failed to resolve a Stripe customer for a shopper:", err);
    return undefined;
  }
}

/**
 * A Stripe Customer for a guest checkout, minted against their cart.
 *
 * A guest has no user account to keep a Customer on, which is why their card
 * used to be kept nowhere: a saved card has to hang off a Customer, and the
 * only Customers this module made were ones it could store on a user. So a
 * guest who left a balance owing could never be charged for it off-session —
 * the store had to ask them to come back and pay, and the ones who did not
 * were cancelled at the grace deadline.
 *
 * The Customer is therefore owned by the ORDER, not by a person. It is minted
 * here, travels on the PaymentIntent (or SetupIntent) the checkout creates,
 * and is stamped on the order the webhook builds — `Order.stripeCustomerId` —
 * which is where the balance charge reads it back from.
 *
 * **Deliberately not reused across checkouts**, not even for the same email.
 * Looking a guest's Customer up by what they typed would let anyone who knows
 * an address attach a checkout to a stranger's Customer, and a Customer
 * carries saved cards. One Customer per cart keeps a guest's cards reachable
 * only from the order they paid for.
 *
 * Keyed on the cart for idempotency: every "Pay" click on the same checkout
 * mints a fresh intent, and without the key each one would leave another
 * Customer behind. Best-effort like everything else here — an undefined
 * result leaves the charge unattached and the balance collected by link.
 */
/** A short, stable stand-in for an email inside an idempotency key. */
function emailKey(email?: string): string {
  return createHash("sha256")
    .update(String(email || "").trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export async function resolveGuestStripeCustomerId(params: {
  secretKey?: string;
  /** The guest's cart — the id their order will carry as its customer. */
  cartId?: string;
  email?: string;
  name?: string;
}): Promise<string | undefined> {
  if (!isStripeSecretKeyConfigured(params.secretKey)) return undefined;
  const cartId = String(params.cartId || "").trim();
  if (!cartId) return undefined;
  try {
    const created = await getStripeForSecretKey(params.secretKey).customers.create(
      {
        email: params.email || undefined,
        name: params.name || undefined,
        // How a Customer with no user behind it is traced back to the checkout
        // that made it — support has nothing else to go on.
        metadata: { cartId, guest: "true" },
      },
      {
        // The email is in the key as well as the cart. Stripe refuses a key
        // replayed with different parameters, so a guest whose card was
        // declined, who then corrected a typo in their email and paid again,
        // got no Customer at all on the second try — and their card was
        // silently not kept. A changed email now mints afresh; the Customer
        // left behind by the typo has no card on it and costs nothing.
        idempotencyKey: `stripe-customer-guest:${cartId}:${emailKey(params.email)}`,
      },
    );
    return created.id;
  } catch (err) {
    console.error("Failed to mint a Stripe customer for a guest checkout:", err);
    return undefined;
  }
}
