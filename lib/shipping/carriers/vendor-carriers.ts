import "server-only";

import { decryptSecret, encryptSecret, isEncryptedSecret } from "@/lib/auth/secret-box";
import { maskSecretHint } from "@/lib/settings/credentials";
import type { VendorCarrierSettings, VendorEncryptedSecret } from "@/types";

/**
 * Reading and writing a vendor's own carrier credentials.
 *
 * `GET /api/vendor/settings` returns `vendor.shipping` verbatim, so an
 * encrypted blob would still be handed to the browser without a sanitizer —
 * and a plaintext one would be handed to the browser as plaintext. Both halves
 * of the problem are solved here so no route has to remember either.
 */

const CARRIER_KEY = "CARRIER_ENCRYPTION_KEY" as const;

/** What the vendor settings API is allowed to return. */
interface SanitizedVendorCarriers {
  mode: "platform" | "own";
  shippo: {
    enabled: boolean;
    mode: "test" | "live";
    testTokenSet: boolean;
    liveTokenSet: boolean;
    testTokenHint?: string;
    liveTokenHint?: string;
  };
  shiprocket: {
    enabled: boolean;
    email?: string;
    passwordSet: boolean;
    pickupLocationName?: string;
  };
}

function hintFor(secret: VendorEncryptedSecret | undefined): string | undefined {
  if (!isEncryptedSecret(secret)) return undefined;
  try {
    return maskSecretHint(decryptSecret(secret, CARRIER_KEY));
  } catch {
    // A key rotation makes old blobs unreadable. Reporting "set, but we cannot
    // show it" is more useful than pretending nothing is stored.
    return undefined;
  }
}

export function sanitizeVendorCarriers(
  carriers: VendorCarrierSettings | undefined | null,
): SanitizedVendorCarriers {
  return {
    mode: carriers?.mode === "own" ? "own" : "platform",
    shippo: {
      enabled: Boolean(carriers?.shippo?.enabled),
      mode: carriers?.shippo?.mode === "live" ? "live" : "test",
      testTokenSet: isEncryptedSecret(carriers?.shippo?.testToken),
      liveTokenSet: isEncryptedSecret(carriers?.shippo?.liveToken),
      testTokenHint: hintFor(carriers?.shippo?.testToken),
      liveTokenHint: hintFor(carriers?.shippo?.liveToken),
    },
    shiprocket: {
      enabled: Boolean(carriers?.shiprocket?.enabled),
      email: carriers?.shiprocket?.email,
      passwordSet: isEncryptedSecret(carriers?.shiprocket?.password),
      pickupLocationName: carriers?.shiprocket?.pickupLocationName,
    },
  };
}

/** What a vendor may submit; tokens arrive as plaintext or not at all. */
interface VendorCarriersInput {
  mode?: "platform" | "own";
  shippo?: {
    enabled?: boolean;
    mode?: "test" | "live";
    testToken?: string;
    liveToken?: string;
  };
  shiprocket?: {
    enabled?: boolean;
    email?: string;
    password?: string;
    pickupLocationName?: string;
  };
}

function nextSecret(
  submitted: string | undefined,
  existing: VendorEncryptedSecret | undefined,
): VendorEncryptedSecret | undefined {
  // Blank means "leave it alone": the form renders empty by design (its value
  // lives only in the masked hint), so an untouched field must not clear a
  // stored credential. Same rule the admin settings save uses.
  if (submitted === undefined || submitted.trim() === "") return existing;
  return encryptSecret(submitted.trim(), CARRIER_KEY);
}

/**
 * Merge a submitted carrier block onto what is stored.
 *
 * The vendor shipping save `$set`s the whole `shipping` object, so without
 * this the credentials would be erased on every unrelated save — the client
 * never receives them and therefore cannot echo them back.
 */
export function mergeVendorCarriers(
  input: VendorCarriersInput | undefined,
  existing: VendorCarrierSettings | undefined | null,
): VendorCarrierSettings | undefined {
  if (!input && !existing) return undefined;

  return {
    mode: input?.mode ?? existing?.mode ?? "platform",
    shippo: {
      enabled: input?.shippo?.enabled ?? existing?.shippo?.enabled ?? false,
      mode: input?.shippo?.mode ?? existing?.shippo?.mode ?? "test",
      testToken: nextSecret(input?.shippo?.testToken, existing?.shippo?.testToken),
      liveToken: nextSecret(input?.shippo?.liveToken, existing?.shippo?.liveToken),
    },
    shiprocket: {
      enabled:
        input?.shiprocket?.enabled ?? existing?.shiprocket?.enabled ?? false,
      email: input?.shiprocket?.email ?? existing?.shiprocket?.email,
      password: nextSecret(
        input?.shiprocket?.password,
        existing?.shiprocket?.password,
      ),
      pickupLocationName:
        input?.shiprocket?.pickupLocationName ??
        existing?.shiprocket?.pickupLocationName,
    },
  };
}

/**
 * Whether a vendor's own Shiprocket block is complete enough to dispatch on.
 *
 * The pickup nickname counts: Shiprocket ships from a registered location, not
 * an address, so a login without one cannot book anything. Treating a
 * half-filled override as "connected" would take a vendor off a working
 * platform account and strand it.
 *
 * Reads the stored shape without decrypting, so the carrier-selection path can
 * ask before it knows which provider it wants. `vendorShiprocketOverrideApplies`
 * is the authority on whether the override is actually *used* — a blob that
 * survives a key rotation unreadable looks fine here and is not usable there.
 */
export function vendorShiprocketIsUsable(
  carriers: VendorCarrierSettings | undefined | null,
): boolean {
  if (carriers?.mode !== "own" || !carriers.shiprocket?.enabled) return false;
  return Boolean(
    carriers.shiprocket.email?.trim() &&
      isEncryptedSecret(carriers.shiprocket.password) &&
      carriers.shiprocket.pickupLocationName?.trim(),
  );
}

/**
 * Whether a vendor's *resolved* Shiprocket credentials replace the platform's.
 *
 * One copy, used by both the "which providers are available" question and the
 * "which account does this call use" one. Two spellings of the same rule is how
 * a store ends up offering a carrier it then refuses to ship with.
 */
export function vendorShiprocketOverrideApplies(
  own: ResolvedVendorCarrierCredentials | null,
): boolean {
  return Boolean(
    own?.shiprocket?.email &&
      own?.shiprocket?.password &&
      own?.shiprocket?.pickupLocationName,
  );
}

/**
 * The pickup nickname a vendor dispatches from, when it ships on its own
 * account. Read without decrypting anything — the nickname is not a secret, and
 * the carrier-selection path needs it before it knows which provider it wants.
 */
export function vendorShiprocketPickupLocation(
  carriers: VendorCarrierSettings | undefined | null,
): string | undefined {
  if (!vendorShiprocketIsUsable(carriers)) return undefined;
  return carriers!.shiprocket!.pickupLocationName?.trim();
}

interface ResolvedVendorCarrierCredentials {
  shippo?: { token?: string; mode: "test" | "live" };
  shiprocket?: { email?: string; password?: string; pickupLocationName?: string };
}

/**
 * The plaintext credentials for a vendor shipping on its own account, or null
 * when it ships on the platform's.
 */
export function resolveVendorCarrierCredentials(
  carriers: VendorCarrierSettings | undefined | null,
): ResolvedVendorCarrierCredentials | null {
  if (carriers?.mode !== "own") return null;

  const open = (secret: VendorEncryptedSecret | undefined) => {
    if (!isEncryptedSecret(secret)) return undefined;
    try {
      return decryptSecret(secret, CARRIER_KEY);
    } catch {
      return undefined;
    }
  };

  const mode = carriers.shippo?.mode === "live" ? "live" : "test";
  return {
    shippo: carriers.shippo?.enabled
      ? {
          mode,
          token: open(
            mode === "live" ? carriers.shippo.liveToken : carriers.shippo.testToken,
          ),
        }
      : undefined,
    shiprocket: carriers.shiprocket?.enabled
      ? {
          email: carriers.shiprocket.email,
          password: open(carriers.shiprocket.password),
          pickupLocationName: carriers.shiprocket.pickupLocationName,
        }
      : undefined,
  };
}
