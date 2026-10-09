/**
 * The two answers a multi-seller cart is really asking for.
 *
 * A cart holding six sellers is rated six times, so checkout used to ask the
 * shopper six separate questions — every seller's full rate list stacked, one
 * radio group each. Shopify's split shipping asks one: "Lowest price" or
 * "Fastest", each one a *combination* of per-shipment choices, with the
 * individual shipments still changeable underneath.
 *
 * This module is that combination logic, kept out of the component so the rules
 * that decide what a shopper is charged can be read and tested on their own.
 * It never talks to the server: the groups it works on are the ones the quote
 * endpoint already returns, and the payment routes re-resolve every selection
 * with the same engine, so nothing here is trusted with a price.
 */

export type ShipmentRateOption = {
  id: string;
  name: string;
  cost: number;
  deliveryDays?: { min: number; max: number };
};

export type ShipmentRateGroup = {
  vendorId: string;
  vendorName?: string;
  /** The server's own default for this seller — cheapest, then fastest. */
  selectedOptionId?: string;
  cost: number;
  options: ShipmentRateOption[];
};

type ShippingPreset = "lowest" | "fastest";
type ShippingPresetState = ShippingPreset | "custom";

export type VendorSelections = Record<string, string>;

/**
 * A window worth printing, or nothing.
 *
 * The admin rate form stores 0/0 for a rate nobody gave a window to, and the
 * product page already reads that as "no promise" rather than "same day"
 * (`deliveryWindowFromShipping`). Anything that ranks or labels speed has to
 * agree, or "Fastest" becomes a guess dressed up as a fact.
 */
export function optionDays(
  option?: ShipmentRateOption | null,
): { min: number; max: number } | null {
  const days = option?.deliveryDays;
  if (!days) return null;
  const min = Number(days.min);
  const max = Number(days.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return null;
  return { min: Math.max(0, min), max: Math.max(min, max) };
}

/**
 * The option a group is currently showing: the shopper's own choice, else the
 * server's default, else the first rate. The two fallbacks are what keep a
 * stale selection — an id from the zone the address used to be in — from
 * blanking a row that is still being charged for.
 */
export function selectedOptionFor(
  group: ShipmentRateGroup,
  selections?: VendorSelections | null,
): ShipmentRateOption | undefined {
  const wanted = selections?.[group.vendorId];
  return (
    (wanted ? group.options.find((option) => option.id === wanted) : undefined) ||
    group.options.find((option) => option.id === group.selectedOptionId) ||
    group.options[0]
  );
}

/**
 * Cheapest, tie broken by the faster window — deliberately the same comparison
 * as `pickSelected` in the rate engine, because the server applies that one to
 * anything the client does not name. If the two ever disagreed, "Lowest price"
 * would be selected on screen while a different rate was charged.
 */
function cheapestOption(options: ShipmentRateOption[]) {
  return [...options].sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    const aMax = optionDays(a)?.max ?? Number.POSITIVE_INFINITY;
    const bMax = optionDays(b)?.max ?? Number.POSITIVE_INFINITY;
    return aMax - bMax;
  })[0];
}

/** Soonest arrival, tie broken by price. Only defined where windows exist. */
function fastestOption(options: ShipmentRateOption[]) {
  return [...options].sort((a, b) => {
    const aMax = optionDays(a)?.max ?? Number.POSITIVE_INFINITY;
    const bMax = optionDays(b)?.max ?? Number.POSITIVE_INFINITY;
    if (aMax !== bMax) return aMax - bMax;
    const aMin = optionDays(a)?.min ?? Number.POSITIVE_INFINITY;
    const bMin = optionDays(b)?.min ?? Number.POSITIVE_INFINITY;
    if (aMin !== bMin) return aMin - bMin;
    return a.cost - b.cost;
  })[0];
}

/** One preset's pick for every shipment, as a selections map. */
export function presetPicks(
  groups: ShipmentRateGroup[],
  preset: ShippingPreset,
): VendorSelections {
  const picks: VendorSelections = {};
  for (const group of groups) {
    if (group.options.length === 0) continue;
    const pick =
      preset === "fastest"
        ? fastestOption(group.options)
        : cheapestOption(group.options);
    if (pick) picks[group.vendorId] = pick.id;
  }
  return picks;
}

/** What the current selection totals, and when the whole order is complete. */
export function presetTotals(
  groups: ShipmentRateGroup[],
  selections?: VendorSelections | null,
) {
  let cost = 0;
  let minDays = 0;
  let maxDays = 0;
  let everyShipmentHasDays = groups.length > 0;

  for (const group of groups) {
    const option = selectedOptionFor(group, selections);
    // An unrated seller is the reason the whole quote is unavailable; it adds
    // nothing to the total rather than silently costing the group's `cost`.
    if (!option) {
      everyShipmentHasDays = false;
      continue;
    }
    cost += option.cost;
    const days = optionDays(option);
    if (!days) {
      everyShipmentHasDays = false;
      continue;
    }
    // The order is complete when its LAST parcel lands, so the window is the
    // slowest shipment's, never the sum or the average.
    if (days.min > minDays) minDays = days.min;
    if (days.max > maxDays) maxDays = days.max;
  }

  return { cost, minDays, maxDays, hasDays: everyShipmentHasDays && maxDays > 0 };
}

/**
 * Which preset the current selection *is*, derived rather than remembered.
 *
 * Keeping a separate "active preset" state alongside the picks gives the screen
 * two sources of truth that drift the moment one row is changed by hand — the
 * header would still read "Lowest price" while a shipment was on Express.
 */
export function detectPreset(
  groups: ShipmentRateGroup[],
  selections?: VendorSelections | null,
): ShippingPresetState {
  const current: VendorSelections = {};
  for (const group of groups) {
    const option = selectedOptionFor(group, selections);
    if (option) current[group.vendorId] = option.id;
  }

  const matches = (picks: VendorSelections) =>
    Object.keys(current).every((vendorId) => current[vendorId] === picks[vendorId]);

  // Lowest wins a tie: when a shipment's cheapest rate is also its fastest,
  // the shopper has not asked to pay for speed.
  if (matches(presetPicks(groups, "lowest"))) return "lowest";
  if (matches(presetPicks(groups, "fastest"))) return "fastest";
  return "custom";
}

/** How many shipments were moved off their cheapest rate. */
export function upgradedShipmentCount(
  groups: ShipmentRateGroup[],
  selections?: VendorSelections | null,
) {
  const cheapest = presetPicks(groups, "lowest");
  return groups.reduce((count, group) => {
    const option = selectedOptionFor(group, selections);
    if (!option) return count;
    return option.id === cheapest[group.vendorId] ? count : count + 1;
  }, 0);
}

/**
 * What the "Fastest" preset actually buys: the extra cost, how many shipments
 * move, and how much sooner they arrive.
 *
 * "2 of 3 shipments arrive 2–3 days earlier" is the honest headline — a bare
 * "+৳130" leaves the shopper to work out whether the order as a whole gets any
 * sooner, and often it does not, because the slowest seller has one rate.
 */
export function fastestUpgradeSummary(groups: ShipmentRateGroup[]) {
  const lowest = presetPicks(groups, "lowest");
  const fastest = presetPicks(groups, "fastest");
  let changed = 0;
  let gainMin = Number.POSITIVE_INFINITY;
  let gainMax = 0;

  for (const group of groups) {
    const low = group.options.find((option) => option.id === lowest[group.vendorId]);
    const fast = group.options.find((option) => option.id === fastest[group.vendorId]);
    if (!low || !fast || low.id === fast.id) continue;
    changed += 1;
    const lowDays = optionDays(low);
    const fastDays = optionDays(fast);
    if (!lowDays || !fastDays) continue;
    const min = lowDays.min - fastDays.min;
    const max = lowDays.max - fastDays.max;
    if (min < gainMin) gainMin = min;
    if (max > gainMax) gainMax = max;
  }

  const lowestTotals = presetTotals(groups, lowest);
  const fastestTotals = presetTotals(groups, fastest);

  return {
    changed,
    shipments: groups.length,
    extraCost: Math.max(0, fastestTotals.cost - lowestTotals.cost),
    gainMin: Number.isFinite(gainMin) ? Math.max(0, gainMin) : 0,
    gainMax: Math.max(0, gainMax),
    /** True when paying more moves the date the whole order completes. */
    movesCompletion:
      lowestTotals.hasDays &&
      fastestTotals.hasDays &&
      fastestTotals.maxDays < lowestTotals.maxDays,
  };
}

/**
 * Whether the two preset cards may be offered at all.
 *
 * Not offered for a single shipment (the preset and the rate list would be the
 * same question twice), when nothing can be upgraded, and — the one that bites
 * — when there are no delivery windows to rank by, because the store switched
 * estimates off or its rates carry none. "Express" is a name, not a promise:
 * ranking by it would let checkout claim a speed nothing in the data supports.
 */
export function canOfferPresets(
  groups: ShipmentRateGroup[],
  options: { showEstimates: boolean },
) {
  if (!options.showEstimates) return false;
  if (groups.length < 2) return false;
  if (groups.some((group) => group.options.length === 0)) return false;
  if (!presetTotals(groups, presetPicks(groups, "lowest")).hasDays) return false;
  const lowest = presetPicks(groups, "lowest");
  const fastest = presetPicks(groups, "fastest");
  return Object.keys(lowest).some((vendorId) => lowest[vendorId] !== fastest[vendorId]);
}

/**
 * Drop selections the freshly quoted rates no longer contain.
 *
 * Rate ids are zone-and-rate scoped, so moving the address to another zone
 * replaces every id. The old map then matched nothing: the cost quietly fell
 * back to the server's default while no radio read as checked, and with presets
 * on screen it would also report "Custom" for a selection the shopper never
 * made. Reconciling on every quote is what keeps the two in step.
 */
export function reconcileVendorSelections(
  groups: ShipmentRateGroup[],
  selections: VendorSelections,
): VendorSelections {
  const next: VendorSelections = {};
  for (const group of groups) {
    const wanted = selections[group.vendorId];
    if (!wanted) continue;
    if (group.options.some((option) => option.id === wanted)) {
      next[group.vendorId] = wanted;
    }
  }
  return next;
}

/** True when the two maps hold the same entries — used to skip no-op writes. */
export function sameSelections(a: VendorSelections, b: VendorSelections) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}
