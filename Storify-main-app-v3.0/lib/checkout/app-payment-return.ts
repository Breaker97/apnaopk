import { appBaseUrl } from "@/lib/app-url";
import { buildLocalePath } from "@/lib/i18n/locale-prefix";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";

/**
 * The way back from a gateway's page to the shopper app.
 *
 * The app opens the gateway in the in-app browser
 * (`openAuthSessionAsync`), which has none of the app's session. The gateway
 * sends the browser back to the store — to the return bridge,
 * `/{locale}/app/payment-return/{provider}` — and the bridge answers a 303 to
 * the app link `{scheme}://checkout/return/{provider}`, carrying the few
 * values the gateway handed back that the app's verify needs, and nothing
 * else. The browser closes on that link; the app verifies with its own
 * session (POST /checkout/redirect/verify).
 *
 * The bridge verifies nothing and writes nothing, as the website's Razorpay
 * callback (app/api/payments/razorpay/callback/route.ts) does not: it only
 * ever redirects to the scheme the store set for its app, never to anything a
 * request names, and never repeats a gateway's text — only values that match
 * a gateway's id formats.
 */

export const APP_PAYMENT_RETURN_PROVIDERS = [
  "paypal",
  "razorpay",
  "paystack",
  "pesapal",
  "orange_money",
  // ioTec's card page (session P2's push work): no values, only `status`.
  "iotec",
] as const;
export type AppPaymentReturnProvider = (typeof APP_PAYMENT_RETURN_PROVIDERS)[number];

/** Whether the payer finished at the gateway or gave up there. */
export type AppPaymentReturnStatus = "return" | "cancel";

export function isAppPaymentReturnProvider(value: string): value is AppPaymentReturnProvider {
  return (APP_PAYMENT_RETURN_PROVIDERS as readonly string[]).includes(value);
}

/** The bridge, as the URL a gateway is told to send the payer to. */
export async function appPaymentReturnUrl(
  locale: string,
  provider: AppPaymentReturnProvider,
  status: AppPaymentReturnStatus = "return",
): Promise<string> {
  const { storeDefault } = await getLocaleRouting();
  const path = buildLocalePath(locale, `/app/payment-return/${provider}`, storeDefault);
  return `${appBaseUrl()}${path}?status=${status}`;
}

/**
 * The store's Razorpay pay page for one payment (app/[locale]/app/pay/razorpay):
 * Razorpay has no hosted page, so the in-app browser opens this, which runs
 * Razorpay Checkout with the bridge as its `callback_url`.
 */
export async function appRazorpayPayPageUrl(locale: string, reference: string): Promise<string> {
  const { storeDefault } = await getLocaleRouting();
  const path = buildLocalePath(locale, "/app/pay/razorpay", storeDefault);
  return `${appBaseUrl()}${path}?reference=${encodeURIComponent(reference)}`;
}

/** The app link the bridge sends the browser on to (`openAuthSessionAsync`'s redirect URL). */
export function appPaymentReturnLink(scheme: string, provider: AppPaymentReturnProvider): string {
  return `${scheme}://checkout/return/${provider}`;
}

const STATUS = /^(return|cancel)$/;
const PAYPAL_ID = /^[A-Za-z0-9]{1,64}$/;
const RAZORPAY_ID = /^[A-Za-z0-9_]{1,100}$/;
const RAZORPAY_SIGNATURE = /^[a-f0-9]{64}$/i;
const RAZORPAY_REASON = /^[a-z0-9_]{1,64}$/i;
const REFERENCE = /^[A-Za-z0-9._-]{1,100}$/;

/** Per provider, the values passed on and the form each must have. Everything else is dropped. */
const PASSED_ON: Record<AppPaymentReturnProvider, Record<string, RegExp>> = {
  // PayPal adds its order id and the payer's id to the return URL.
  paypal: { status: STATUS, token: PAYPAL_ID, PayerID: PAYPAL_ID },
  // Razorpay posts its three fields, or an `error[…]` (read separately).
  razorpay: {
    status: STATUS,
    razorpay_payment_id: RAZORPAY_ID,
    razorpay_order_id: RAZORPAY_ID,
    razorpay_signature: RAZORPAY_SIGNATURE,
  },
  // Paystack adds our reference twice.
  paystack: { status: STATUS, reference: REFERENCE, trxref: REFERENCE },
  // Pesapal adds its tracking id and our merchant reference.
  pesapal: { status: STATUS, OrderTrackingId: REFERENCE, OrderMerchantReference: REFERENCE },
  // The app holds the reference already.
  orange_money: { status: STATUS },
  iotec: { status: STATUS },
};

const RAZORPAY_FIELDS = ["razorpay_payment_id", "razorpay_order_id", "razorpay_signature"] as const;

/**
 * The app link for one return: what the gateway sent (`query` of the bridge
 * URL, `fields` of a form POST — Razorpay's), filtered to what this provider
 * passes on. A Razorpay post without its three fields is a payment that did
 * not go through: it carries `error` with Razorpay's reason code (snake_case
 * only, never its description), as the website's callback does.
 */
export function appPaymentReturnLocation(input: {
  scheme: string;
  provider: AppPaymentReturnProvider;
  query: URLSearchParams;
  fields: URLSearchParams;
}): string {
  const out = new URLSearchParams();
  for (const [name, pattern] of Object.entries(PASSED_ON[input.provider])) {
    const value = (input.fields.get(name) ?? input.query.get(name))?.trim();
    if (value && pattern.test(value)) out.set(name, value);
  }

  if (input.provider === "razorpay") {
    const complete = RAZORPAY_FIELDS.every((name) => out.has(name));
    if (!complete && input.fields.size > 0) {
      for (const name of RAZORPAY_FIELDS) out.delete(name);
      const reason = [input.fields.get("error[reason]"), input.fields.get("error[code]")]
        .map((value) => value?.trim())
        .find((value) => value && RAZORPAY_REASON.test(value));
      out.set("error", (reason ?? "payment_failed").toLowerCase());
    }
  }

  const query = out.toString();
  return `${appPaymentReturnLink(input.scheme, input.provider)}${query ? `?${query}` : ""}`;
}
