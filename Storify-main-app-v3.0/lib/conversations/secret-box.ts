import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ServiceUnavailableError } from "@/lib/api/errors";
import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
} from "@/lib/auth/secret-box";

/**
 * The AES-256-GCM implementation moved to `lib/secret-box.ts` when vendor
 * carrier credentials needed the same treatment under a key of their own.
 * These names stay here so every existing messaging call site — and
 * `models/channel-connection.model.ts` — is untouched.
 */
export type { EncryptedSecret };

export function encryptMessagingSecret(plaintext: string): EncryptedSecret {
  return encryptSecret(plaintext, "MESSAGING_ENCRYPTION_KEY");
}

export function decryptMessagingSecret(
  secret: EncryptedSecret | undefined,
): string {
  // A revoked connection keeps its `_id` but not its credential, so every
  // caller has to face the absent case rather than dereferencing undefined.
  if (!secret) {
    throw new Error("This channel connection no longer stores a credential");
  }
  return decryptSecret(secret, "MESSAGING_ENCRYPTION_KEY");
}

export function verifyMetaWebhookSignature(rawBody: string, signature?: string) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const received = signature.slice("sha256=".length).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(received)) return false;
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex"),
  );
}

interface MetaOnboardingState {
  userId: string;
  expiresAt: number;
  nonce: string;
}

function metaAppSecret() {
  const secret = process.env.META_APP_SECRET?.trim();
  if (!secret) {
    throw new ServiceUnavailableError(
      "META_APP_SECRET is not configured",
      undefined,
      "META_APP_SECRET_NOT_CONFIGURED",
    );
  }
  return secret;
}

/**
 * Mints a Telegram webhook secret and its stored hash.
 *
 * Only the hash is persisted; the plaintext goes to Telegram's setWebhook and
 * is then discarded, so the stored value cannot be replayed as a webhook.
 */
export function createTelegramWebhookSecret() {
  // Telegram restricts this to 1-256 chars of A-Z a-z 0-9 _ and -.
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashTelegramWebhookSecret(secret) };
}

export function hashTelegramWebhookSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function createMetaOnboardingState(userId: string) {
  const payload: MetaOnboardingState = {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
    nonce: randomBytes(18).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", metaAppSecret())
    .update(encoded, "utf8")
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyMetaOnboardingState(
  token: string,
  expectedUserId: string,
) {
  const [encoded, received] = token.split(".");
  if (!encoded || !received) return false;
  const expected = createHmac("sha256", metaAppSecret())
    .update(encoded, "utf8")
    .digest();
  let receivedBuffer: Buffer;
  try {
    receivedBuffer = Buffer.from(received, "base64url");
  } catch {
    return false;
  }
  if (
    receivedBuffer.length !== expected.length ||
    !timingSafeEqual(expected, receivedBuffer)
  ) {
    return false;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as MetaOnboardingState;
    return (
      payload.userId === expectedUserId &&
      Number.isFinite(payload.expiresAt) &&
      payload.expiresAt >= Date.now() &&
      typeof payload.nonce === "string" &&
      payload.nonce.length >= 20
    );
  } catch {
    return false;
  }
}
