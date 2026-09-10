import {
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { randomBytes } from "node:crypto";
import { ServiceUnavailableError } from "@/lib/api/errors";

/**
 * AES-256-GCM at rest, for credentials that must not sit in plain sight.
 *
 * Lifted out of `lib/conversations/secret-box.ts`, which owned it while
 * messaging was the only feature encrypting anything. It is parameterised by
 * key-name so a second feature can use a key of its own without inheriting
 * messaging's rotation schedule — rotating one key should never silently brick
 * the other.
 *
 * Note that the *settings* credentials (payment gateways, SMTP, S3, carriers)
 * are deliberately still plaintext: they all share one blast radius, and
 * encrypting only the newest one is theatre. Moving all of them behind this
 * box is a separate, single sweep.
 */

export interface EncryptedSecret {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
}

type SecretKeyName =
  | "MESSAGING_ENCRYPTION_KEY"
  | "CARRIER_ENCRYPTION_KEY";

/**
 * Resolve the key material.
 *
 * `CARRIER_ENCRYPTION_KEY` falls back to the messaging key so an existing
 * deployment gains vendor carrier credentials without a new environment
 * variable — and a deployment that wants them separated simply sets it.
 */
function encryptionKey(keyName: SecretKeyName) {
  const configured =
    process.env[keyName] ||
    (keyName === "CARRIER_ENCRYPTION_KEY"
      ? process.env.MESSAGING_ENCRYPTION_KEY
      : undefined);

  if (!configured || configured.length < 32) {
    throw new ServiceUnavailableError(
      `${keyName} is not configured`,
      undefined,
      `${keyName}_NOT_CONFIGURED`,
    );
  }
  return createHash("sha256").update(configured, "utf8").digest();
}

export function encryptSecret(
  plaintext: string,
  keyName: SecretKeyName = "MESSAGING_ENCRYPTION_KEY",
): EncryptedSecret {
  if (!plaintext.trim()) throw new Error("Secret cannot be empty");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyName), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptSecret(
  secret: EncryptedSecret | undefined | null,
  keyName: SecretKeyName = "MESSAGING_ENCRYPTION_KEY",
): string {
  // Callers routinely hold a record whose credential was revoked, so the
  // absent case is forced on them rather than dereferenced blindly.
  if (!secret) {
    throw new Error("No encrypted credential is stored");
  }
  if (secret.version !== 1 || secret.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported encrypted secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(keyName),
    Buffer.from(secret.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when a value looks like something `decryptSecret` can open. */
export function isEncryptedSecret(value: unknown): value is EncryptedSecret {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EncryptedSecret>;
  return (
    candidate.version === 1 &&
    candidate.algorithm === "aes-256-gcm" &&
    typeof candidate.iv === "string" &&
    typeof candidate.ciphertext === "string" &&
    typeof candidate.authTag === "string"
  );
}
