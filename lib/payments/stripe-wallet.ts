import type Stripe from "stripe";
import { STRIPE_API_VERSION, getStripeForSecretKey } from "@/lib/payments/stripe";
import { detectKeyMode } from "@/lib/settings/credential-fields";

/**
 * What Stripe's mobile PaymentSheet needs beside a PaymentIntent to offer the
 * phone's wallet (Apple Pay, Google Pay) and a signed-in shopper's saved
 * cards: the merchant's country, whether the keys are test keys, and the
 * shopper's Customer with a short-lived secret that lets the sheet list,
 * save and remove that Customer's cards.
 *
 * Best-effort, like the Customer itself (`resolveStripeCustomerId`): what
 * cannot be had is left out, and the sheet behaves as it did without it.
 */

const ACCOUNT_COUNTRY_TTL_MS = 60 * 60 * 1000;
const accountCountry = new Map<string, { country?: string; until: number }>();

/**
 * The Stripe account's country: Apple Pay and Google Pay are offered by the
 * country of the merchant who takes the money. Read from Stripe, an hour at a
 * time per key, so a store never has to type it.
 */
async function stripeMerchantCountry(secretKey: string | undefined): Promise<string | undefined> {
  const cacheKey = secretKey || "env";
  const cached = accountCountry.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.country;
  let country: string | undefined;
  try {
    const account = await getStripeForSecretKey(secretKey).accounts.retrieveCurrent();
    country = account.country ? account.country.toUpperCase() : undefined;
  } catch (error) {
    console.error("Could not read the Stripe account's country:", error);
  }
  accountCountry.set(cacheKey, { country, until: Date.now() + (country ? ACCOUNT_COUNTRY_TTL_MS : 5 * 60 * 1000) });
  return country;
}

export interface PaymentSheetCustomer {
  id: string;
  /** PaymentSheet's `customerSessionClientSecret`. */
  customerSessionClientSecret?: string;
  /** PaymentSheet's `customerEphemeralKeySecret`, when a customer session could not be made. */
  ephemeralKeySecret?: string;
}

/**
 * A secret that lets PaymentSheet show, save and remove the Customer's cards:
 * a CustomerSession for the mobile Payment Element; an ephemeral key when
 * Stripe would not make one (an older account setup).
 */
async function paymentSheetCustomer(
  secretKey: string | undefined,
  customerId: string,
): Promise<PaymentSheetCustomer> {
  const stripe = getStripeForSecretKey(secretKey);
  try {
    const session = await stripe.customerSessions.create({
      customer: customerId,
      components: {
        mobile_payment_element: {
          enabled: true,
          features: {
            payment_method_save: "enabled",
            payment_method_redisplay: "enabled",
            payment_method_remove: "enabled",
          },
        },
      } as Stripe.CustomerSessionCreateParams.Components,
    });
    return { id: customerId, customerSessionClientSecret: session.client_secret };
  } catch (error) {
    console.error("Could not make a Stripe customer session; trying an ephemeral key:", error);
  }
  try {
    // Stripe makes an ephemeral key only for a stated API version: the one
    // this server's client is pinned to (lib/payments/stripe.ts).
    const key = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: STRIPE_API_VERSION },
    );
    return key.secret ? { id: customerId, ephemeralKeySecret: key.secret } : { id: customerId };
  } catch (error) {
    console.error("Could not make a Stripe ephemeral key:", error);
    return { id: customerId };
  }
}

/** The Customer a PaymentIntent belongs to, as an id. */
export function intentCustomerId(intent: Pick<Stripe.PaymentIntent, "customer">): string | undefined {
  const customer = intent.customer;
  if (!customer) return undefined;
  return typeof customer === "string" ? customer : customer.id;
}

export interface PaymentSheetExtras {
  merchantCountryCode?: string;
  testMode?: boolean;
  customer?: PaymentSheetCustomer;
}

/**
 * Everything the sheet takes beside the intent. `customerId` only for a
 * signed-in shopper's own Customer: a guest's sheet stays as it is.
 */
export async function paymentSheetExtras(params: {
  secretKey: string | undefined;
  publishableKey: string;
  customerId?: string;
}): Promise<PaymentSheetExtras> {
  const mode = detectKeyMode(params.publishableKey) ?? detectKeyMode(params.secretKey);
  const [country, customer] = await Promise.all([
    stripeMerchantCountry(params.secretKey),
    params.customerId ? paymentSheetCustomer(params.secretKey, params.customerId) : undefined,
  ]);
  return {
    ...(country ? { merchantCountryCode: country } : {}),
    ...(mode ? { testMode: mode === "test" } : {}),
    ...(customer ? { customer } : {}),
  };
}
