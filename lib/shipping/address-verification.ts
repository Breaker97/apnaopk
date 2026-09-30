import "server-only";

import { createHash } from "node:crypto";
import { getSettings, type ISettings } from "@/models/settings.model";
import type { Address } from "@/types";
import { normalizeCheckoutSettings } from "@/lib/checkout/checkout-config";
import { toCarrierAddress } from "@/lib/shipping/carriers/address";
import {
  enabledCarrierProviders,
  resolveCarrierContext,
} from "@/lib/shipping/carriers/credentials";
import { checkShippoAddress } from "@/lib/shipping/carriers/shippo";

/**
 * Can a courier deliver to this address?
 *
 * One answer for every place that asks — checkout's "Did you mean…", the check
 * after an order is placed, and a customer or merchant correcting an address —
 * so a correction that satisfies one satisfies them all.
 *
 * Two layers. The free one runs everywhere: every field a courier needs is
 * there, and a postcode has the shape its country uses. A missing postcode is
 * only a fault where the store needs one (`isPostcodeRequired`). The carrier
 * one runs when Shippo is connected: its address validation, which is what
 * actually finds a street that does not exist or a ZIP from another city. A
 * store on Shiprocket alone, or with no carrier, gets the free layer only.
 *
 * `unknown` is not `invalid`. A carrier that could not be reached, or returned
 * no verdict, says nothing about the address — and holding an order on that
 * would stop real parcels because a lookup failed.
 */

export type AddressVerdict = "valid" | "invalid" | "unknown";

export interface AddressVerification {
  verdict: AddressVerdict;
  /** Why it is invalid, in words a customer can act on. */
  messages: string[];
  /** A corrected street/city/postcode, when the carrier offered one. */
  suggestion?: {
    street: string;
    apartment?: string;
    city: string;
    postalCode: string;
  };
  /** Which layer decided. */
  checkedWith: "format" | "carrier";
}

type CheckableAddress = Partial<
  Pick<
    Address,
    "fullName" | "firstName" | "lastName" | "street" | "apartment" | "city" | "state" | "postalCode" | "country" | "phone"
  >
>;

const FIELD_LABELS: Record<string, string> = {
  street1: "street address",
  city: "city",
  postalCode: "postal code",
  country: "country",
  state: "state or region",
  name: "name",
  "country (unrecognised)": "a country we recognise",
};

/**
 * A stable key for an address, so a check is not repeated for one that has not
 * changed. Only the fields a courier reads.
 */
export function addressKey(address: CheckableAddress | null | undefined): string {
  const parts = [
    address?.street,
    address?.apartment,
    address?.city,
    address?.state,
    address?.postalCode,
    address?.country,
  ].map((part) => String(part || "").trim().toLowerCase().replace(/\s+/g, " "));
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/**
 * Does a delivery address in this store need a postcode?
 *
 * Yes when a carrier is connected, because none will buy a label without one.
 * Yes when the store's checkout requires one. Otherwise no: a store that ships
 * by hand and made the postcode optional or hidden has orders without one, and
 * refusing a corrected address for lacking it leaves the customer nothing true
 * to type. The check after checkout skips such a store for the same reason
 * (`sweepAddressChecks`).
 */
export async function isPostcodeRequired(settings: ISettings): Promise<boolean> {
  const checkout = normalizeCheckoutSettings(settings.checkout);
  if (checkout.fields.postalCode.visibility === "required") return true;
  return (await enabledCarrierProviders(settings)).length > 0;
}

/**
 * The free layer: fields present and a postcode of the right shape. Pure.
 * A postcode that is there always has to fit its country; one that is absent
 * only counts when `requirePostcode` says so.
 */
function checkAddressFormat(
  address: CheckableAddress | null | undefined,
  options: { requirePostcode: boolean },
): {
  ok: boolean;
  messages: string[];
} {
  const readiness = toCarrierAddress(address || undefined, {
    fallbackName: "Customer",
  });
  const missing = readiness.missing
    .filter((field) => field !== "name")
    .filter((field) => options.requirePostcode || field !== "postalCode")
    .map((field) => FIELD_LABELS[field] || field);
  const messages = [
    ...(missing.length ? [`Add the ${missing.join(", ")}`] : []),
    ...readiness.invalid,
  ];
  return { ok: messages.length === 0, messages };
}

function sameText(a?: string, b?: string) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

export async function verifyDeliveryAddress(
  address: CheckableAddress | null | undefined,
  options: { settings?: ISettings; useCarrier?: boolean } = {},
): Promise<AddressVerification> {
  const settings = options.settings ?? (await getSettings());
  const format = checkAddressFormat(address, {
    requirePostcode: await isPostcodeRequired(settings),
  });
  if (!format.ok) {
    return { verdict: "invalid", messages: format.messages, checkedWith: "format" };
  }
  if (options.useCarrier === false) {
    return { verdict: "unknown", messages: [], checkedWith: "format" };
  }

  let token: string | undefined;
  try {
    const context = await resolveCarrierContext({ provider: "shippo", settings });
    token = context.token;
  } catch {
    // Shippo is not connected, switched off, or carriers are off entirely.
    token = undefined;
  }
  if (!token) return { verdict: "unknown", messages: [], checkedWith: "format" };

  const carrierAddress = toCarrierAddress(address || undefined, {
    fallbackName: "Customer",
  }).address;
  const check = await checkShippoAddress(token, carrierAddress);
  if (!check) return { verdict: "unknown", messages: [], checkedWith: "carrier" };

  const normalized = check.normalized;
  const suggestion =
    normalized &&
    (!sameText(normalized.street1, carrierAddress.street1) ||
      !sameText(normalized.city, carrierAddress.city) ||
      !sameText(normalized.postalCode, carrierAddress.postalCode))
      ? {
          street: normalized.street1,
          apartment: normalized.street2 || carrierAddress.street2,
          city: normalized.city,
          postalCode: normalized.postalCode,
        }
      : undefined;

  return {
    verdict: check.valid ? "valid" : "invalid",
    messages: check.valid ? [] : check.messages,
    // A suggestion is only worth offering against an address that failed.
    ...(check.valid || !suggestion ? {} : { suggestion }),
    checkedWith: "carrier",
  };
}
