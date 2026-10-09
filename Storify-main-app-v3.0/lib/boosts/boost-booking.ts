import { addDays, enumerateDays } from "@/lib/boosts/boost-days";

/**
 * Pure helpers behind the shared boost booking dialog — the admin's offline
 * booking and the vendor's checkout draw the same screen.
 *
 * The two areas load different availability payloads: the admin's carries who
 * holds each day, the vendor's is anonymised and marks the vendor's own days.
 * Both are normalised into `BookingCalendarData` here, so the ladder list and
 * the calendar read one shape and cannot drift apart.
 */

export type BookingSurface = "home" | "listing" | "productPage";

const BOOKING_SURFACES: readonly BookingSurface[] = [
  "home",
  "listing",
  "productPage",
];

export interface BookingRung {
  position: number;
  label: string;
  pricePerDay: number;
  /** The rung's own currency — a stale rung is listed precisely because it differs. */
  currency: string;
  reach: Record<BookingSurface, boolean>;
  /** Why the rung cannot be booked right now, or null when it can. */
  blocked: "unreachable" | "stale" | null;
}

export interface BookingCalendarData {
  /** The server's UTC day; the browser's clock is never trusted. */
  today: string;
  /** The last bookable day, inclusive. */
  lastDay: string;
  /** Days sold on each position, to anyone — this product's own days excluded. */
  taken: Map<number, Set<string>>;
  /**
   * Days this product already holds on ANY position. The {productId, day}
   * unique index refuses them everywhere, so every rung treats them as blocked.
   */
  productDays: Set<string>;
  /** Vendor view: the vendor's other products' days on each position. */
  own: Map<number, Set<string>>;
  /** Admin view: who holds each day, per position ("Store — Product"). */
  holders: Map<number, Map<string, string>>;
}

export interface AdminAvailabilityPayload {
  today: string;
  positions: Array<{
    position: number;
    days: Array<{ day: string; productId?: string; store: string; product: string }>;
  }>;
}

export interface VendorAvailabilityPayload {
  today: string;
  positions: Array<{ position: number; takenDays: string[]; ownDays: string[] }>;
  productBookedDays?: string[];
}

const EMPTY = new Set<string>();

/** The admin payload, split around the product being booked. */
export function fromAdminAvailability(
  payload: AdminAvailabilityPayload,
  productId: string | null,
  lastDay: string,
): BookingCalendarData {
  const taken = new Map<number, Set<string>>();
  const holders = new Map<number, Map<string, string>>();
  const productDays = new Set<string>();
  for (const row of payload.positions) {
    const sold = new Set<string>();
    const who = new Map<string, string>();
    for (const entry of row.days) {
      who.set(entry.day, [entry.store, entry.product].filter(Boolean).join(" — "));
      if (productId && entry.productId === productId) productDays.add(entry.day);
      else sold.add(entry.day);
    }
    taken.set(row.position, sold);
    holders.set(row.position, who);
  }
  return { today: payload.today, lastDay, taken, productDays, own: new Map(), holders };
}

/** The vendor payload: `takenDays` already includes the vendor's own days. */
export function fromVendorAvailability(
  payload: VendorAvailabilityPayload,
  lastDay: string,
): BookingCalendarData {
  const productDays = new Set(payload.productBookedDays ?? []);
  const taken = new Map<number, Set<string>>();
  const own = new Map<number, Set<string>>();
  for (const row of payload.positions) {
    taken.set(row.position, new Set(row.takenDays.filter((day) => !productDays.has(day))));
    own.set(row.position, new Set(row.ownDays.filter((day) => !productDays.has(day))));
  }
  return { today: payload.today, lastDay, taken, productDays, own, holders: new Map() };
}

export function isDayBlocked(
  data: BookingCalendarData,
  position: number,
  day: string,
): boolean {
  return data.productDays.has(day) || (data.taken.get(position) ?? EMPTY).has(day);
}

/** Every blocked day on one rung inside the bookable window. */
export function blockedDays(data: BookingCalendarData, position: number): string[] {
  const out = new Set<string>(data.productDays);
  for (const day of data.taken.get(position) ?? EMPTY) out.add(day);
  return [...out].filter((day) => day >= data.today && day <= data.lastDay).sort();
}

/** First bookable day on a rung, or null when the whole window is sold. */
export function nextFreeDay(data: BookingCalendarData, position: number): string | null {
  for (let day = data.today; day <= data.lastDay; day = addDays(day, 1)) {
    if (!isDayBlocked(data, position, day)) return day;
  }
  return null;
}

/** The days of a picked range this rung cannot sell. */
export function clashingDays(
  data: BookingCalendarData,
  position: number,
  startDay: string,
  endDay: string,
): string[] {
  return enumerateDays(startDay, endDay).filter((day) =>
    isDayBlocked(data, position, day),
  );
}

/** Sorted days folded into contiguous runs: [["2026-10-08", "2026-10-10"], …]. */
export function dayRuns(days: readonly string[]): Array<[string, string]> {
  const runs: Array<[string, string]> = [];
  for (const day of [...days].sort()) {
    const last = runs[runs.length - 1];
    if (last && addDays(last[1], 1) === day) last[1] = day;
    else runs.push([day, day]);
  }
  return runs;
}

/**
 * The surfaces a rung does NOT reach, among the ones switched on. A surface
 * that is off for everyone is no reason to single out one rung.
 */
export function missingSurfaces(
  reach: Record<BookingSurface, boolean>,
  enabled: Record<BookingSurface, boolean>,
): BookingSurface[] {
  return BOOKING_SURFACES.filter((surface) => enabled[surface] && !reach[surface]);
}
