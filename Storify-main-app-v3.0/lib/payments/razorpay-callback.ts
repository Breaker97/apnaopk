import { sanitizeReturnPath } from "@/lib/auth/return-path";

/**
 * Razorpay Checkout's return leg.
 *
 * Checkout runs in redirect mode (`callback_url` + `redirect: true`): the payer
 * leaves the store, and Razorpay brings them back with a form POST to the
 * callback URL, on success and on failure alike. Redirect mode is not a style
 * choice — Razorpay Curlec makes it mandatory for FPX, Malaysia's online
 * banking, and the payer picks FPX inside Razorpay's own window, after the
 * store has already opened it. With only a `handler` the bank sent FPX payers
 * back to nowhere: the money was captured and the order sat pending.
 *
 * The callback is a bridge and nothing more. Razorpay's POST comes from another
 * site, so the browser leaves out every SameSite=Lax cookie — the signed-in
 * session and `cart_session` — and settling the order there would lose the
 * customer scope, the cart it closes and the account email. The callback
 * therefore answers with a 303 to the page the payer started from, carrying
 * Razorpay's three fields, and that page calls its usual verify route: a
 * same-origin request, with every cookie.
 */

const RAZORPAY_CALLBACK_PATH = "/api/payments/razorpay/callback";

/** Query names a return page reads after the callback's redirect. */
export const RAZORPAY_RETURN_PARAM = {
  orderId: "razorpay_order_id",
  paymentId: "razorpay_payment_id",
  signature: "razorpay_signature",
  /** Set instead of the three above when the payment did not go through. */
  error: "razorpay_error",
} as const;

const SUCCESS_QUERY = "success";
const FAILURE_QUERY = "failure";

/** Razorpay ids are `order_…` / `pay_…`: letters, digits and underscores. */
const RAZORPAY_ID_PATTERN = /^[A-Za-z0-9_]{1,100}$/;
/** The signature is a hex HMAC-SHA256. */
const RAZORPAY_SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;
/** Razorpay's error codes and reasons are snake_case tokens. */
const RAZORPAY_REASON_PATTERN = /^[a-z0-9_]{1,64}$/i;
const UNKNOWN_FAILURE_REASON = "payment_failed";

function pathOf(url: URL): string {
  // An origin configured with a trailing slash builds `https://shop//en/...`;
  // a doubled leading slash is protocol-relative and the sanitizer drops it.
  return `${url.pathname.replace(/^\/+/, "/")}${url.search}`;
}

/**
 * The `callback_url` handed to Razorpay Checkout.
 *
 * Both return targets ride in its query (Razorpay keeps the query of a callback
 * URL), and the callback accepts them only as same-origin paths.
 */
export function buildRazorpayCallbackUrl(params: {
  /** Where the payer lands after paying; verifies the payment. */
  successUrl: string;
  /** Where the payer lands when the payment did not go through. */
  failureUrl: string;
}): string {
  const success = new URL(params.successUrl);
  const failure = new URL(params.failureUrl, success);
  const callback = new URL(RAZORPAY_CALLBACK_PATH, success.origin);
  callback.searchParams.set(SUCCESS_QUERY, pathOf(success));
  callback.searchParams.set(FAILURE_QUERY, pathOf(failure));
  return callback.toString();
}

function withParams(path: string, params: Record<string, string>): string {
  // `path` is already a same-origin path; the base only lets URL parse it.
  const url = new URL(path, "http://return.invalid");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

function readField(fields: URLSearchParams, name: string, pattern: RegExp) {
  const value = fields.get(name)?.trim();
  return value && pattern.test(value) ? value : null;
}

/**
 * The same-origin path the callback redirects the payer to.
 *
 * `query` is the callback URL's own query (the return targets); `fields` is what
 * Razorpay posted. A complete, well-formed success triple goes to the success
 * page. Anything else — a failure, or a post that is missing a field — goes to
 * the failure page marked with a reason token, never to the success page bare:
 * the storefront's success page without a payment to verify shows a confirmed
 * order.
 *
 * Only a snake_case reason is forwarded, never Razorpay's description, so a
 * crafted link cannot put words on the store's own pages.
 */
export function resolveRazorpayCallbackRedirect(input: {
  query: URLSearchParams;
  fields: URLSearchParams;
}): string {
  const successPath = sanitizeReturnPath(input.query.get(SUCCESS_QUERY));
  const failurePath =
    sanitizeReturnPath(input.query.get(FAILURE_QUERY)) ?? successPath;

  const orderId = readField(
    input.fields,
    RAZORPAY_RETURN_PARAM.orderId,
    RAZORPAY_ID_PATTERN,
  );
  const paymentId = readField(
    input.fields,
    RAZORPAY_RETURN_PARAM.paymentId,
    RAZORPAY_ID_PATTERN,
  );
  const signature = readField(
    input.fields,
    RAZORPAY_RETURN_PARAM.signature,
    RAZORPAY_SIGNATURE_PATTERN,
  );

  if (successPath && orderId && paymentId && signature) {
    return withParams(successPath, {
      [RAZORPAY_RETURN_PARAM.orderId]: orderId,
      [RAZORPAY_RETURN_PARAM.paymentId]: paymentId,
      [RAZORPAY_RETURN_PARAM.signature]: signature,
    });
  }

  if (!failurePath) return "/";

  const reason =
    readField(input.fields, "error[reason]", RAZORPAY_REASON_PATTERN) ??
    readField(input.fields, "error[code]", RAZORPAY_REASON_PATTERN) ??
    UNKNOWN_FAILURE_REASON;
  return withParams(failurePath, {
    [RAZORPAY_RETURN_PARAM.error]: reason.toLowerCase(),
  });
}
