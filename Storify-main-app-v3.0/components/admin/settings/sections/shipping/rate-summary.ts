import type { Settings } from "@/components/admin/settings/types";
import {
  countryCodeForValue,
  countryNameForCode,
} from "@/lib/intl/country-availability";

export type ShippingZone = Settings["shipping"]["zones"][number];
export type ShippingRate = ShippingZone["rates"][number];

/**
 * The pure half of the rates table in Settings → Shipping & Delivery: what a
 * rate's row says, and what a zone's header says. The rules follow
 * `lib/shipping/shipping.ts` — a range is inclusive at both ends, a missing
 * or zero minimum is no lower bound, and a missing maximum is no upper bound
 * (a maximum of 0 is a real bound of 0).
 */

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const lowerBound = (value: unknown) => {
  const parsed = num(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

/**
 * True when a rate is quoted for every cart that reaches its zone.
 *
 * `free_over` is only emitted at or above its threshold, and range rates only
 * inside their bounds. A zone built entirely from those quotes nothing at all
 * for a cart that misses them — the shopper drops to the fallback rate or is
 * told shipping is unavailable, with nothing in the editor to say the zone
 * was the reason.
 */
export function rateAppliesToEveryCart(rate: ShippingRate): boolean {
  if (rate.active === false) return false;
  switch (rate.type ?? "flat") {
    case "flat":
      return true;
    case "subtotal_range":
      return (
        lowerBound(rate.minSubtotal) === undefined &&
        num(rate.maxSubtotal) === undefined
      );
    case "weight_range":
      return (
        lowerBound(rate.minWeight) === undefined &&
        num(rate.maxWeight) === undefined
      );
    default:
      return false;
  }
}

/** What a rate asks of an order before checkout offers it. */
export type RateCondition =
  | { kind: "any" }
  | { kind: "freeFrom"; amount: number }
  | { kind: "subtotal"; min?: number; max?: number }
  | { kind: "weight"; min?: number; max?: number };

export function rateCondition(rate: ShippingRate): RateCondition {
  switch (rate.type ?? "flat") {
    case "free_over":
      return { kind: "freeFrom", amount: Math.max(0, num(rate.freeOver) ?? 0) };
    case "subtotal_range": {
      const min = lowerBound(rate.minSubtotal);
      const max = num(rate.maxSubtotal);
      return min === undefined && max === undefined
        ? { kind: "any" }
        : { kind: "subtotal", min, max };
    }
    case "weight_range": {
      const min = lowerBound(rate.minWeight);
      const max = num(rate.maxWeight);
      return min === undefined && max === undefined
        ? { kind: "any" }
        : { kind: "weight", min, max };
    }
    default:
      return { kind: "any" };
  }
}

/** What a rate costs: free, a flat amount, or a base plus a per-weight part. */
export type RatePrice =
  | { kind: "free" }
  | { kind: "amount"; amount: number }
  | { kind: "perWeight"; amount: number; perUnit: number };

export function ratePrice(rate: ShippingRate): RatePrice {
  if ((rate.type ?? "flat") === "free_over") return { kind: "free" };
  const amount = Math.max(0, num(rate.price) ?? 0);
  const perUnit = Math.max(0, num(rate.pricePerWeightUnit) ?? 0);
  if (rate.type === "weight_range" && perUnit > 0) {
    return { kind: "perWeight", amount, perUnit };
  }
  return amount === 0 ? { kind: "free" } : { kind: "amount", amount };
}

/** The delivery window a rate promises, before the store's processing time. */
export type DeliveryWindow =
  | { kind: "none" }
  | { kind: "days"; days: number }
  | { kind: "range"; min: number; max: number };

export function deliveryWindow(minDays: unknown, maxDays: unknown): DeliveryWindow {
  const min = Math.max(0, Math.trunc(num(minDays) ?? 0));
  const max = Math.max(0, Math.trunc(num(maxDays) ?? 0));
  if (min === 0 && max === 0) return { kind: "none" };
  if (min === 0 || max === 0 || min === max) {
    return { kind: "days", days: Math.max(min, max) };
  }
  return { kind: "range", min: Math.min(min, max), max: Math.max(min, max) };
}

/** A country value as stored on a zone (ISO code, or a legacy name) → its name. */
export function countryLabel(value: string): string {
  return countryNameForCode(countryCodeForValue(value)) ?? value;
}

/** The first few of a list and how many were left out. */
export function firstFew<T>(items: readonly T[], shown = 3) {
  return { shown: items.slice(0, shown), more: Math.max(0, items.length - shown) };
}
