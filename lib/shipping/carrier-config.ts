/**
 * Shared carrier constants and defaults.
 *
 * Imported by the Settings model, the admin settings tab and the adapters
 * alike, so it must stay free of `server-only` imports and of anything that
 * reaches the network or the database — exactly the rule
 * `lib/settings/credential-fields.ts` follows for the same reason.
 * `country-availability` is pure lookup data over `country-options`, so it
 * satisfies that rule.
 */

import {
  countryCodeForValue,
  countryNameForCode,
} from "@/lib/intl/country-availability";

export const CARRIER_PROVIDERS = ["shippo", "shiprocket"] as const;
export type CarrierProvider = (typeof CARRIER_PROVIDERS)[number];

export const CARRIER_PROVIDER_LABELS: Record<CarrierProvider, string> = {
  shippo: "Shippo",
  shiprocket: "Shiprocket",
};

/**
 * Where each provider is allowed to dispatch from.
 *
 * Shiprocket is an Indian aggregator: its whole API assumes an Indian pickup
 * postcode, so offering it to a store shipping from anywhere else would only
 * produce opaque 422s at label time.
 *
 * Shippo is deliberately unrestricted. It is tempting to gate it on the
 * countries its own carrier accounts collect from — see
 * `SHIPPO_MASTER_ACCOUNT_ORIGINS` — but that is coverage of the *default*
 * accounts, not of Shippo. DHL Express, FedEx and UPS are global through
 * Shippo on a merchant's own account, and Shippo documents no origin limit for
 * one. Gating on the master list would refuse, before ever asking, exactly the
 * merchant who had done the work to make their lane shippable.
 *
 * An empty list means "no restriction".
 */
const CARRIER_ORIGIN_COUNTRIES: Record<CarrierProvider, string[]> = {
  shippo: [],
  shiprocket: ["IN"],
};

/**
 * Where Shippo's *own* carrier accounts will collect a parcel.
 *
 * The accounts every Shippo account starts with, and all a merchant who has
 * connected nothing of their own has. Outside this list they hold no carrier at
 * all, which Shippo answers not with an error but with an empty rate list and
 * one refusal per master account — fifteen sentences in which the one naming
 * the real problem ("Shipment origin is out of service area") is
 * indistinguishable from the fourteen that do not.
 *
 * So this explains a failure; it never prevents a request. A store here can
 * still be shipping on its own DHL Express or FedEx account from anywhere those
 * carriers operate, and only Shippo can say whether it is.
 *
 * https://docs.goshippo.com/carriers/carrier-capabilities
 */
const SHIPPO_MASTER_ACCOUNT_ORIGINS = [
  "AU",
  "CA",
  "DE",
  "ES",
  "FR",
  "GB",
  "IT",
  "US",
] as const;

/**
 * Whether this provider may dispatch from `originCountry`.
 *
 * The country is resolved through `countryCodeForValue` rather than compared
 * raw. `CountrySelect` defaults to `valueFormat="name"`, and the shipping-origin
 * field uses that default — so `settings.shipping.origin.country` holds
 * **"India"**, not `"IN"`. An uppercase string compare then answered `false` for
 * every store that had done exactly what was asked of it: the Shiprocket toggle
 * stayed permanently disabled, `enabledCarrierProviders` filtered the carrier
 * out, and `resolveCarrierContext` refused with *"Set your shipping origin
 * country to India to use it"* — to a merchant who had.
 *
 * Bridging both shapes here rather than migrating the stored value keeps every
 * other reader of that field working, and matches what `carriers/address.ts`
 * already does for the addresses themselves.
 */
export function carrierSupportsOrigin(
  provider: CarrierProvider,
  originCountry: string | undefined,
): boolean {
  const allowed = CARRIER_ORIGIN_COUNTRIES[provider];
  if (allowed.length === 0) return true;
  return allowed.includes(originCountryCode(originCountry));
}

/** A stored origin as an alpha-2 code, accepting either shape. */
function originCountryCode(originCountry: string | undefined): string {
  return (
    countryCodeForValue(originCountry)?.toUpperCase() ||
    // A value the catalog does not know is still compared as written: an origin
    // already stored as a bare code stays valid even if it ever left the list.
    String(originCountry || "")
      .trim()
      .toUpperCase()
  );
}

/** Whether Shippo's default carrier accounts can collect from `originCountry`. */
function shippoMasterAccountsCoverOrigin(
  originCountry: string | undefined,
): boolean {
  return (SHIPPO_MASTER_ACCOUNT_ORIGINS as readonly string[]).includes(
    originCountryCode(originCountry),
  );
}

/**
 * Why Shippo returned no rates at all, when the likely reason is the origin.
 *
 * Read only *after* Shippo has refused, never before: a store outside the
 * master-account countries may hold its own carrier account and be perfectly
 * shippable, and the rate list is the only thing that knows. What this adds is
 * the sentence Shippo never sends — that the accounts it tried are the default
 * ones, and that connecting a carrier of the merchant's own is the way out.
 */
export function shippoOriginHint(
  originCountry: string | undefined,
): string | undefined {
  if (shippoMasterAccountsCoverOrigin(originCountry)) return undefined;

  // Sorted by name, not by the code the list is keyed on: "Australia, Canada,
  // Germany, Spain, France…" is alphabetical only to whoever knows it is really
  // AU, CA, DE, ES, FR, and reads as unordered to everyone else.
  const served = SHIPPO_MASTER_ACCOUNT_ORIGINS.map(
    (code) => countryNameForCode(code) || code,
  ).sort((a, b) => a.localeCompare(b));
  const from =
    countryNameForCode(originCountryCode(originCountry)) ||
    String(originCountry || "").trim();

  return [
    from
      ? `Shippo's own carrier accounts do not collect from ${from} —`
      : "Shippo's own carrier accounts do not collect from this address —",
    `they ship from ${new Intl.ListFormat("en", {
      type: "conjunction",
    }).format(served)} only.`,
    "Connect your own carrier account in Shippo to ship from here;",
    "DHL Express, FedEx and UPS all originate worldwide on one.",
  ].join(" ");
}

/**
 * Why a provider will not quote this lane, in words a merchant can act on.
 *
 * A refusal that only says "cannot ship this route" tells a merchant nothing
 * they can change. Where a provider does declare an origin restriction this
 * names both the country being dispatched from and the ones it serves, so the
 * fix is legible from the message alone.
 *
 * Anything else — Shiprocket connected without a pickup location, say, or any
 * Shippo lane, which carries no static restriction — keeps the generic wording,
 * because guessing at a second reason would be worse than being vague about it.
 */
export function carrierRouteRefusal(
  provider: CarrierProvider,
  originCountry: string | undefined,
): string {
  const label = CARRIER_PROVIDER_LABELS[provider];
  if (carrierSupportsOrigin(provider, originCountry)) {
    return `${label} cannot ship this route.`;
  }

  const served = CARRIER_ORIGIN_COUNTRIES[provider]
    .map((code) => countryNameForCode(code) || code)
    .sort((a, b) => a.localeCompare(b));
  const from =
    countryNameForCode(originCountryCode(originCountry)) ||
    String(originCountry || "").trim();

  return [
    from
      ? `${label} cannot dispatch from ${from}.`
      : `${label} cannot dispatch from this address.`,
    `It ships only from ${new Intl.ListFormat("en", {
      type: "conjunction",
    }).format(served)}.`,
  ].join(" ");
}

export const CARRIER_MODES = ["test", "live"] as const;
export type CarrierMode = (typeof CARRIER_MODES)[number];

export const CARRIER_LABEL_FILE_TYPES = [
  "PDF",
  "PDF_4x6",
  "PNG",
  "ZPLII",
] as const;
export type CarrierLabelFileType = (typeof CARRIER_LABEL_FILE_TYPES)[number];

export const CARRIER_LABEL_STORAGE_MODES = ["carrier_url", "mirror"] as const;
export type CarrierLabelStorage = (typeof CARRIER_LABEL_STORAGE_MODES)[number];

export const CARRIER_RATE_CHOICES = [
  "cheapest",
  "fastest",
  "fixed_service",
] as const;
export type CarrierRateChoice = (typeof CARRIER_RATE_CHOICES)[number];

export const DIMENSION_UNITS = ["cm", "in"] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

export const PARCEL_WEIGHT_UNITS = ["g", "kg", "lb", "oz"] as const;
export type ParcelWeightUnit = (typeof PARCEL_WEIGHT_UNITS)[number];

/**
 * Smallest billable parcel weight, per store weight unit.
 *
 * Carriers reject a zero-weight parcel outright, and an order of weightless
 * items (a merchant who never filled the field in) is common enough that
 * failing the whole shipment over it would be the wrong trade.
 */
export const MINIMUM_PARCEL_WEIGHT: Record<"kg" | "lb", number> = {
  kg: 0.1,
  lb: 0.25,
};

const DEFAULT_PACKAGE_PRESET_ID = "default";

/**
 * The box every store starts with, so the packer never has to invent one.
 * Shipped as a schema default rather than a seed script — a fresh install and
 * an upgraded one then behave identically.
 */
export const DEFAULT_PACKAGE_PRESET = {
  id: DEFAULT_PACKAGE_PRESET_ID,
  name: "Default box",
  length: 30,
  width: 20,
  height: 15,
  dimensionUnit: "cm" as DimensionUnit,
  emptyWeight: 0,
  weightUnit: "kg" as ParcelWeightUnit,
  isDefault: true,
  active: true,
};

/** Last-resort parcel when a store has deleted every preset. */
export const FALLBACK_PARCEL = {
  length: 30,
  width: 20,
  height: 15,
  dimensionUnit: "cm" as DimensionUnit,
};

/**
 * How long a carrier quote may sit before it must be re-fetched.
 *
 * Shippo rate objects expire, and redeeming a dead one fails at the worst
 * possible moment — after the merchant has clicked Buy. Thirty minutes is well
 * inside every provider's window while still letting a merchant walk away from
 * the dialog and come back.
 */
export const CARRIER_RATE_TTL_MS = 30 * 60 * 1000;

/**
 * How long a `purchasing` claim is honoured before another attempt may take it.
 *
 * The claim is a compare-and-set written *before* the carrier call, so a worker
 * that dies mid-purchase — a serverless timeout, a redeploy, an OOM — leaves it
 * set with nothing running. Without an expiry that parcel is stranded for good:
 * the dialog hides "Send to courier", the rate route refuses to re-quote, the
 * eligibility predicate reports `already_shipped`, and the retry job sees
 * `alreadyOwned` and marks itself done.
 *
 * Ten minutes is far longer than any real purchase (Shiprocket's four calls cap
 * out around eighty seconds) and far longer than the queue's own 60s lease, so
 * a live purchase is never reclaimed out from under itself. Reclaiming is safe
 * because the purchase is resumable: the provider handles are checkpointed, a
 * repeat Shippo buy recovers the existing transaction, and Shiprocket rejects a
 * duplicate order id.
 */
export const CARRIER_PURCHASE_CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * True when a `purchasing` claim is old enough to be treated as abandoned.
 *
 * Lives here rather than beside the purchase code because the same judgement is
 * made in four places — the claim itself, the re-quote guard, the auto-ship
 * predicate and the order screen — and a stale definition in any one of them
 * puts the parcel back in the state this exists to end.
 */
export function isPurchaseClaimStale(
  purchase:
    | { state?: string | null; startedAt?: Date | string | null }
    | null
    | undefined,
  now: number = Date.now(),
): boolean {
  if (purchase?.state !== "purchasing") return false;
  const startedAt = purchase.startedAt
    ? new Date(purchase.startedAt).getTime()
    : Number.NaN;
  // No timestamp means the row predates this field, or the process died between
  // writing the state and writing the clock. Neither is evidence of live work.
  if (!Number.isFinite(startedAt)) return true;
  return now - startedAt > CARRIER_PURCHASE_CLAIM_TTL_MS;
}
