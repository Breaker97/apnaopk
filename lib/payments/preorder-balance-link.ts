import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { Types } from "mongoose";
import { appBaseUrl } from "@/lib/app-url";

/**
 * The link that lets a shopper pay a pre-order balance without signing in.
 *
 * Guests were refused a deposit pre-order at checkout for one reason: their
 * order's `customerId` is a CART, not a user, so the page that collects the
 * balance had no way to recognise them and no way to let them in. That was an
 * honest refusal — taking a deposit nobody could ever top up would have been
 * worse — but it cost every guest sale of every pre-order that leaves money
 * owing. This is the route in.
 *
 * **Derived, not stored.** The token is an HMAC of the order id under the
 * app's own auth secret, so:
 *
 *  - the same order always produces the same link, and a T-7 reminder does not
 *    kill the link sent with the T-1 one (a stored random token would have to
 *    be re-minted to be re-sent, or kept in plaintext to be re-read — one
 *    breaks the link, the other puts a working payment credential in the
 *    database);
 *  - there is no token lifecycle to get wrong: nothing to mint, expire, clean
 *    up, or leave behind on a cancelled order;
 *  - a database dump contains no payment links.
 *
 * **What it authorises, and for how long.** Only paying this one order's
 * balance, and only while a balance is actually due — the routes behind it
 * re-check that on every call, so a link stops working the moment the balance
 * is settled or the order is cancelled. It is deliberately not a login: it
 * cannot see another order, change an address, or start a refund.
 *
 * It cannot be revoked individually. Rotating `BETTER_AUTH_SECRET` invalidates
 * every link at once, which is the same blast radius as every session, and is
 * the right lever for the same kind of incident.
 */

/**
 * What a signed link may do, one purpose per token.
 *
 * The purpose is signed INTO the token, so a link minted for one job is
 * useless for another — the two are different HMACs over the same order id:
 *
 *  - `balance` pays the balance and nothing else. It is the link in every
 *    payment-due email and reminder, which get forwarded and screenshotted,
 *    and a leaked one can do no harm beyond settling a stranger's balance.
 *  - `manage` also cancels the pre-order and changes where it ships. That is
 *    a shopper's own business, so it only goes out where they need it — the
 *    delay notice, where cancelling is the point — and address changes it
 *    makes are confined (`changePreorderShippingAddress`) and announced to the
 *    order's email, so a leaked link cannot quietly redirect a parcel.
 *
 * `balance` keeps the exact label it was first signed with. Links already
 * sitting in inboxes are HMACs of that string, and renaming it would kill
 * every one of them.
 */
type LinkPurpose = "balance" | "manage";

const PURPOSE_LABEL: Record<LinkPurpose, string> = {
  balance: "preorder-balance-link",
  manage: "preorder-manage-link",
};

function signingSecret(): string | undefined {
  const secret = process.env.BETTER_AUTH_SECRET;
  return secret && secret.trim() ? secret : undefined;
}

function signature(orderId: string, secret: string, purpose: LinkPurpose): string {
  return createHmac("sha256", secret)
    .update(`${PURPOSE_LABEL[purpose]}:${orderId}`)
    .digest("base64url");
}

function createLinkToken(orderId: string, purpose: LinkPurpose): string | undefined {
  const secret = signingSecret();
  if (!secret) return undefined;
  const id = String(orderId);
  if (!Types.ObjectId.isValid(id)) return undefined;
  return `${id}.${signature(id, secret, purpose)}`;
}

function readLinkToken(
  token: string | null | undefined,
  purpose: LinkPurpose,
): string | null {
  const secret = signingSecret();
  if (!secret || !token) return null;
  const separator = String(token).indexOf(".");
  if (separator <= 0) return null;
  const orderId = String(token).slice(0, separator);
  const presented = String(token).slice(separator + 1);
  if (!Types.ObjectId.isValid(orderId) || !presented) return null;

  const expected = signature(orderId, secret, purpose);
  // Both sides are base64url of a SHA-256 digest, so they are the same length
  // whenever the token is well formed; a wrong-length one is rejected before
  // `timingSafeEqual`, which would throw on it.
  const presentedBuffer = Buffer.from(presented, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (presentedBuffer.length !== expectedBuffer.length) return null;
  return timingSafeEqual(presentedBuffer, expectedBuffer) ? orderId : null;
}

/**
 * The token for an order, or `undefined` when the app has no secret to sign
 * with.
 *
 * Callers treat absence as "this store cannot hand out payment links" rather
 * than crashing: a misconfigured secret is already fatal to sessions, and a
 * notification is not the place to discover it.
 */
export function createPreorderBalanceToken(orderId: string): string | undefined {
  return createLinkToken(orderId, "balance");
}

/**
 * The order a token names, if it really signed it.
 *
 * Returns the id rather than a boolean because the id IS the claim — the token
 * carries it, so a caller never has to be told separately which order it is
 * for, and can never be told a different one.
 */
export function readPreorderBalanceToken(
  token: string | null | undefined,
): string | null {
  return readLinkToken(token, "balance");
}

/**
 * The token that lets a shopper manage a pre-order without signing in —
 * cancel it, or change where it ships. See `LinkPurpose` for why it is not the
 * balance token.
 */
export function createPreorderManageToken(orderId: string): string | undefined {
  return createLinkToken(orderId, "manage");
}

/** The order a manage token names, if it really signed it for that purpose. */
export function readPreorderManageToken(
  token: string | null | undefined,
): string | null {
  return readLinkToken(token, "manage");
}

/** Where the manage link points, relative — for an in-app notification. */
export function preorderManageLinkPath(
  orderId: string,
  locale?: string,
): string | undefined {
  const token = createPreorderManageToken(orderId);
  if (!token) return undefined;
  const prefix = locale ? `/${locale}` : "";
  return `${prefix}/pre-order/manage/${token}`;
}

/** Where the link points, relative — for an in-app notification. */
export function preorderBalanceLinkPath(
  orderId: string,
  locale?: string,
): string | undefined {
  const token = createPreorderBalanceToken(orderId);
  if (!token) return undefined;
  const prefix = locale ? `/${locale}` : "";
  return `${prefix}/pre-order/balance/${token}`;
}

/**
 * The absolute link, for an email.
 *
 * Built from the configured origin rather than a request, because the caller
 * is a notification or a background sweep with no request to read.
 */
export function preorderBalanceLinkUrl(
  orderId: string,
  locale?: string,
): string | undefined {
  const path = preorderBalanceLinkPath(orderId, locale);
  return path ? `${appBaseUrl()}${path}` : undefined;
}
