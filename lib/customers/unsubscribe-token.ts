import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * The unsubscribe link for an address the store keeps no customer record for.
 *
 * Most people an abandoned-checkout reminder goes to typed an email into the
 * checkout and left before paying, so there is no customer row to keep an
 * unsubscribe token on — and creating one just to hold it would put everyone
 * who ever abandoned a cart in the customer list. Without a token those
 * emails went out with no unsubscribe link and no `List-Unsubscribe` header:
 * the shoppers least likely to want the email were the ones with no way to
 * stop it, and a sender that offers no way out is the one mailbox providers
 * file as spam.
 *
 * So this token carries the address itself, sealed with AES-256-GCM under a
 * key derived from the app's auth secret:
 *
 *  - **Nothing is stored until someone uses it.** Clicking it writes a
 *    `MarketingSuppression`; sending it needs nothing at all.
 *  - **Sealed, not merely signed.** A signed token would carry the address in
 *    the clear, and the page it opens runs the store's analytics — every visit
 *    would hand the shopper's email to whichever tracker the store installed.
 *    The GCM tag still makes it unforgeable: change one byte and it opens as
 *    nothing.
 *  - **One purpose.** The key is derived for this job alone and the purpose is
 *    bound in as associated data, so no other token made from the same secret
 *    (a pay link, a session) opens here. The double opt-in confirmation never
 *    accepts it either, or an unsubscribe link could subscribe someone.
 *
 * It does not expire: an unsubscribe link has to work for as long as the email
 * that carried it might still be read. Rotating `BETTER_AUTH_SECRET` retires
 * every one at once, as it does every session and pay link.
 *
 * No dots anywhere in it — the locale proxy skips any path that looks like a
 * file (`.*\..*`), and this token is a path segment of the unsubscribe page.
 */

/** Marks a sealed token: never valid hex, so it cannot pass for a stored one. */
const TOKEN_PREFIX = "u1";
const PURPOSE = "marketing-unsubscribe:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** The longest address SMTP allows. */
const MAX_EMAIL_LENGTH = 254;

function sealingKey(): Buffer | null {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || !secret.trim()) return null;
  return createHash("sha256").update(`${PURPOSE}:${secret}`, "utf8").digest();
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.includes("@") && email.length <= MAX_EMAIL_LENGTH ? email : null;
}

/**
 * A sealed unsubscribe token for this address, or null when there is no
 * secret to seal it with (the app cannot sign anyone in without one either).
 * A fresh one each call — nothing ties two emails' links together.
 */
export function createEmailUnsubscribeToken(rawEmail: string): string | null {
  const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : null;
  const key = sealingKey();
  if (!email || !key) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(PURPOSE, "utf8"));
  const sealed = Buffer.concat([cipher.update(email, "utf8"), cipher.final()]);
  return (
    TOKEN_PREFIX +
    Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString("base64url")
  );
}

/** The address a sealed token was made for, or null for anything else. */
export function readEmailUnsubscribeToken(token: string): string | null {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  const body = token.slice(TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  const key = sealingKey();
  if (!key) return null;

  const raw = Buffer.from(body, "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      raw.subarray(0, IV_BYTES),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(Buffer.from(PURPOSE, "utf8"));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const email = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
    return normalizeEmail(email);
  } catch {
    // A forged, truncated or re-keyed token: it opens as nothing.
    return null;
  }
}
