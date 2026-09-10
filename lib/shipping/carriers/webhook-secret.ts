import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Shared-secret handling for carrier webhooks.
 *
 * Shippo publishes no HMAC signature, so the secret travels in the callback
 * URL and is compared as a digest — the same shape the Telegram webhook uses
 * for the same reason. Shiprocket sends its token in a header instead, but the
 * comparison rule is identical, so both live here.
 */

export function createCarrierWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCarrierWebhookSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Constant-time comparison of a presented secret against a stored digest.
 *
 * Hashing both sides first means the buffers are always the same length, so
 * `timingSafeEqual` never throws on a wrong-length candidate — which would
 * itself leak the length.
 */
export function carrierWebhookSecretMatches(
  candidate: string | null | undefined,
  storedHash: string | null | undefined,
): boolean {
  if (!candidate || !storedHash) return false;
  const candidateHash = Buffer.from(hashCarrierWebhookSecret(candidate), "hex");
  const expected = Buffer.from(storedHash, "hex");
  if (candidateHash.length !== expected.length) return false;
  return timingSafeEqual(candidateHash, expected);
}

/** Compare a plaintext token (Shiprocket's `x-api-key`) without leaking timing. */
export function carrierWebhookTokenMatches(
  candidate: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!candidate || !expected) return false;
  return carrierWebhookSecretMatches(
    candidate,
    hashCarrierWebhookSecret(expected),
  );
}
