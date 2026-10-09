import { randomBytes } from "node:crypto";
import { ValidationError } from "@/lib/api/errors";

/**
 * Vendors' offers on abandoned checkouts — the rules, kept free of models and
 * the database so they can be tested on plain objects. The writes live in
 * `lib/orders/abandoned-offers.ts`.
 *
 * An offer is a vendor's discount to a shopper who left its goods in a
 * checkout. The store sends it (the vendor never learns who the shopper is),
 * as a single-use code only that shopper can redeem, on that vendor's goods,
 * at that vendor's cost.
 */

/** A recovery link stops working fourteen days after the cart was last touched. */
export const OFFER_MAX_VALID_DAYS = 14;
/** An offer is not sent to someone the store emailed a marketing mail this recently. */
export const OFFER_QUIET_HOURS = 24;

export type OfferType = "percentage" | "fixed";
export type OfferKind = "manual" | "automatic";
export type OfferStatus =
  | "pending"
  | "sent"
  | "queued"
  | "failed"
  | "suppressed"
  | "used";
/** What an offer amounts to now: its stored status, or `expired` once lapsed unused. */
export type OfferState = OfferStatus | "expired";

/** Statuses of an offer that may still be redeemed. */
export const LIVE_OFFER_STATUSES: readonly OfferStatus[] = ["pending", "sent", "queued"];

export interface OfferInput {
  type: OfferType;
  value: number;
  validDays: number;
}

export interface AbandonedOfferPolicy {
  /** Vendors may send offers at all (Vendors → Configuration). */
  enabled: boolean;
  /** ...and may set a standing offer the store's recovery email carries. */
  automatic: boolean;
  /** The most an offer may take off the vendor's goods, in percent. */
  maxPercent: number;
  /** Offers one vendor may send in a day. */
  maxPerVendorPerDay: number;
  /** The longest an offer may stay valid, in days. */
  maxValidDays: number;
}

export interface StoredOffer {
  _id?: unknown;
  vendorId?: unknown;
  couponId?: unknown;
  code?: string | null;
  kind?: OfferKind | string | null;
  type?: OfferType | string | null;
  value?: number | null;
  validUntil?: Date | string | null;
  status?: OfferStatus | string | null;
  createdAt?: Date | string | null;
  sentAt?: Date | string | null;
}

type PolicySettings =
  | {
      multiVendorMode?: { enabled?: boolean | null } | null;
      vendorConfig?: {
        showAbandonedCheckoutsToVendors?: boolean | null;
        abandonedOffers?: {
          enabled?: boolean | null;
          automatic?: boolean | null;
          maxPercent?: number | null;
          maxPerVendorPerDay?: number | null;
          maxValidDays?: number | null;
        } | null;
      } | null;
    }
  | null
  | undefined;

function clampWhole(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (value === null || value === undefined || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * The store's rules for vendors' offers. Off unless the store turned them on
 * — its own recovery emails never offer money off, so whether its sellers may
 * is a marketplace's decision — and off wherever vendors cannot see their
 * abandoned checkouts at all.
 */
export function abandonedOfferPolicy(settings: PolicySettings): AbandonedOfferPolicy {
  const raw = settings?.vendorConfig?.abandonedOffers ?? {};
  const pageOn =
    Boolean(settings?.multiVendorMode?.enabled) &&
    settings?.vendorConfig?.showAbandonedCheckoutsToVendors !== false;
  return {
    enabled: pageOn && raw.enabled === true,
    automatic: raw.automatic !== false,
    maxPercent: clampWhole(raw.maxPercent, 1, 90, 30),
    maxPerVendorPerDay: clampWhole(raw.maxPerVendorPerDay, 1, 1000, 20),
    maxValidDays: clampWhole(raw.maxValidDays, 1, OFFER_MAX_VALID_DAYS, OFFER_MAX_VALID_DAYS),
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/** What the vendor's own lines in the checkout come to. */
export function ownSubtotal(lines: ReadonlyArray<{ price?: number | null; quantity?: number | null }>) {
  return roundMoney(
    lines.reduce((sum, line) => sum + (Number(line.price) || 0) * (Number(line.quantity) || 0), 0),
  );
}

/** The most a fixed-amount offer may take off: the store's maximum share of the vendor's goods. */
export function maxOfferAmount(subtotal: number, policy: Pick<AbandonedOfferPolicy, "maxPercent">) {
  return roundMoney((subtotal * policy.maxPercent) / 100);
}

/**
 * A vendor's offer as typed, checked against the store's limits. Refuses
 * rather than adjusts: the vendor is looking at the number and should send
 * the one it chose or none.
 */
export function checkOfferInput(
  input: OfferInput,
  policy: AbandonedOfferPolicy,
  subtotal: number,
): OfferInput {
  const value = Number(input.value);
  const validDays = Math.round(Number(input.validDays));
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError({ value: ["Enter a discount above zero"] });
  }
  if (input.type === "percentage" && value > policy.maxPercent) {
    throw new ValidationError({
      value: [`The store allows at most ${policy.maxPercent}% off`],
    });
  }
  if (input.type === "fixed") {
    const max = maxOfferAmount(subtotal, policy);
    if (value > max) {
      throw new ValidationError({
        value: [
          `The store allows at most ${policy.maxPercent}% of your items here, which is ${max}`,
        ],
      });
    }
  }
  if (!Number.isFinite(validDays) || validDays < 1 || validDays > policy.maxValidDays) {
    throw new ValidationError({
      validDays: [`Choose between 1 and ${policy.maxValidDays} days`],
    });
  }
  return {
    type: input.type === "fixed" ? "fixed" : "percentage",
    value: input.type === "fixed" ? roundMoney(value) : value,
    validDays,
  };
}

/**
 * A vendor's standing offer fitted to one checkout and today's limits — the
 * store may have lowered its maximum since the vendor saved it. Null when
 * nothing would be left to offer.
 */
export function fitOfferInput(
  input: Partial<OfferInput> | null | undefined,
  policy: AbandonedOfferPolicy,
  subtotal: number,
): OfferInput | null {
  if (!input || subtotal <= 0) return null;
  const type: OfferType = input.type === "fixed" ? "fixed" : "percentage";
  const ceiling = type === "fixed" ? maxOfferAmount(subtotal, policy) : policy.maxPercent;
  const value = Math.min(Number(input.value) || 0, ceiling);
  if (!(value > 0)) return null;
  const validDays = clampWhole(input.validDays, 1, policy.maxValidDays, Math.min(3, policy.maxValidDays));
  return { type, value: type === "fixed" ? roundMoney(value) : value, validDays };
}

/** When an offer made now for `validDays` stops working. */
export function offerValidUntil(now: Date, validDays: number) {
  return new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);
}

/** What an offer amounts to at `now`. */
export function offerState(offer: StoredOffer, now: Date = new Date()): OfferState {
  const status = (offer.status || "pending") as OfferStatus;
  if (LIVE_OFFER_STATUSES.includes(status)) {
    const until = offer.validUntil ? new Date(offer.validUntil).getTime() : 0;
    if (!(until > now.getTime())) return "expired";
  }
  return status;
}

/**
 * The offer the shopper can still redeem on this checkout, whoever made it.
 * One at a time: an order carries a single coupon, so a second offer would
 * only compete with the first.
 */
export function liveOfferOf(
  record: { offers?: StoredOffer[] | null },
  now: Date = new Date(),
): StoredOffer | undefined {
  return (record.offers ?? []).find((offer) =>
    LIVE_OFFER_STATUSES.includes(offerState(offer, now) as OfferStatus),
  );
}

/** A vendor's own most recent offer on a checkout. */
export function latestOfferBy(
  record: { offers?: StoredOffer[] | null },
  vendorId: string,
): StoredOffer | undefined {
  return (record.offers ?? [])
    .filter((offer) => offer.vendorId != null && String(offer.vendorId) === vendorId)
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    )[0];
}

/**
 * Which rung of the store's recovery ladder carries a vendor's standing
 * offer: the second, so the first stays a plain reminder — or the only one,
 * when the store sends a single email.
 */
export function offerRungStep(rungs: ReadonlyArray<{ step: number }> | null | undefined) {
  const steps = (rungs ?? []).map((rung) => rung.step).sort((a, b) => a - b);
  return steps.length >= 2 ? steps[1] : (steps[0] ?? 1);
}

/**
 * Whose standing offer a multi-seller checkout carries: the vendor with the
 * most at stake in it. One offer per email, because the order can take only
 * one of them.
 */
export function chooseAutomaticOfferVendor<T extends { ownSubtotal: number }>(
  candidates: readonly T[],
): T[] {
  return [...candidates]
    .filter((candidate) => candidate.ownSubtotal > 0)
    .sort((a, b) => b.ownSubtotal - a.ownSubtotal);
}

/**
 * Letters and digits a shopper cannot misread: no I or O, no 0 or 1. Exactly
 * 32 of them, so a random byte maps onto them evenly.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A one-off offer code: `OFR` and eight random characters. */
export function generateOfferCode(bytes: Uint8Array = randomBytes(8)): string {
  return `OFR${Array.from(bytes.slice(0, 8), (byte) => CODE_ALPHABET[byte % 32]).join("")}`;
}
