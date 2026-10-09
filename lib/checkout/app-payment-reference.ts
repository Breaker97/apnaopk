import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Types } from "mongoose";

/**
 * The `reference` the shopper app is handed when it starts a payment on a
 * gateway's own page (POST /checkout/redirect), and sends back to verify it.
 *
 * It names the payment method and the record the payment lands on — the
 * pending order, or the checkout attempt that stands in for it — and it is
 * bound to whoever started it: a hash of the request's idempotency scope
 * (`user:<id>`, or `cart:<X-Cart-Token>` for a guest). The website scopes a
 * guest's verify by nothing but the gateway's reference; the app is held to
 * more: a reference minted for another shopper or another cart reads as
 * nothing at all.
 *
 * It is also the key to the Razorpay pay page (app/[locale]/app/pay/razorpay),
 * which the in-app browser opens with no session, so it must not be
 * guessable: an HMAC under the app's auth secret, like the pay links
 * (lib/payments/preorder-balance-link.ts). The scope rides as a hash, never
 * the cart token itself, since the reference travels in a URL.
 *
 * Nothing is stored: the record holds the gateway's own references, and the
 * signature is what makes this one trustworthy. Rotating
 * `BETTER_AUTH_SECRET` turns every reference in flight into nothing; the
 * gateways' webhooks and callbacks still settle those payments.
 */

const VERSION = "ar1";
const LABEL = "app-redirect-payment";

export type AppPaymentRecordKind = "order" | "attempt";

export interface AppPaymentReference {
  /** The checkout payment method ("paypal", "orange_money", …). */
  method: string;
  kind: AppPaymentRecordKind;
  /** The order's or the attempt's id. */
  id: string;
}

function signingSecret(): string | undefined {
  const secret = process.env.BETTER_AUTH_SECRET;
  return secret && secret.trim() ? secret : undefined;
}

/** The scope as it appears in a reference: hashed, never raw. */
function scopeTag(scope: string): string {
  return createHash("sha256").update(`${LABEL}:scope:${scope}`).digest("base64url").slice(0, 22);
}

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${LABEL}:${body}`).digest("base64url");
}

export function mintAppPaymentReference(input: AppPaymentReference & { scope: string }): string {
  const secret = signingSecret();
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  const body = [VERSION, input.method, input.kind === "order" ? "o" : "a", input.id, scopeTag(input.scope)].join(".");
  return `${body}.${signature(body, secret)}`;
}

/**
 * The reference, when this store minted it — and, given a `scope`, minted for
 * that scope. Anything else (tampered, another store's, another shopper's) is
 * null.
 */
export function readAppPaymentReference(reference: string, scope?: string): AppPaymentReference | null {
  const secret = signingSecret();
  if (!secret) return null;
  const parts = reference.split(".");
  if (parts.length !== 6 || parts[0] !== VERSION) return null;
  const [, method, kind, id, tag, given] = parts;
  const expected = Buffer.from(signature(parts.slice(0, 5).join("."), secret));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if ((kind !== "o" && kind !== "a") || !Types.ObjectId.isValid(id) || !/^[a-z_]{1,32}$/.test(method)) {
    return null;
  }
  if (scope !== undefined && tag !== scopeTag(scope)) return null;
  return { method, kind: kind === "o" ? "order" : "attempt", id };
}
