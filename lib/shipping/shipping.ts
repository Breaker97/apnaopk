import { areCountryValuesEquivalent } from "@/lib/intl/country-availability";

type ShippingRateType =
  | "flat"
  | "free_over"
  | "subtotal_range"
  | "weight_range";

export const SHIPPING_UNAVAILABLE_MESSAGE =
  "Shipping is not available for this address.";

type WeightUnit = "kg" | "lb";

type InputWeightUnit = "g" | "kg" | "lb" | "oz";

/**
 * The unit every caller aggregates cart weight in before handing it to the rate
 * engine. The engine converts from this into whatever unit the store's rates are
 * written in, so call sites never need to know that unit — they only have to
 * agree with each other, which is what this constant enforces.
 */
export const CANONICAL_CART_WEIGHT_UNIT: InputWeightUnit = "kg";

type ShippingDutyMode = "DDP" | "DDU";

export type ShippingDestination = {
  country?: string;
  state?: string;
};

type ShippingDeliveryDefaults = {
  processingDaysMin?: number;
  processingDaysMax?: number;
  showEstimatedDelivery?: boolean;
};

type ShippingRate = {
  id?: string;
  name?: string;
  type?: ShippingRateType;
  price?: number;
  freeOver?: number;
  minSubtotal?: number;
  maxSubtotal?: number;
  // weight_range bounds, expressed in the store's configured weight unit
  minWeight?: number;
  maxWeight?: number;
  // optional incremental charge added per unit of weight (on top of price)
  pricePerWeightUnit?: number;
  minDays?: number;
  maxDays?: number;
  active?: boolean;
};

type ShippingZone = {
  id?: string;
  name?: string;
  countries?: string[];
  regions?: string[];
  rates?: ShippingRate[];
  /**
   * "Rest of the world": priced only when no ordinary zone matched the address.
   * Its countries/regions are ignored, and unlike the single `fallbackRate` it
   * supersedes it can carry several rates with conditions of their own.
   */
  isFallback?: boolean;
};

/**
 * A vendor's prices for one of the platform's zones.
 *
 * Vendors price the store's zones rather than drawing their own: geography is
 * the platform's to define (the Dokan/Mirakl split), so all a vendor supplies
 * is what they charge inside it. A zone they leave alone inherits the store's
 * rates, which is what keeps coverage complete no matter how little a vendor
 * configures.
 */
type VendorZoneRates = {
  zoneId: string;
  rates?: ShippingRate[];
};

type FallbackShippingRate = {
  enabled?: boolean;
  name?: string;
  price?: number;
  minDays?: number;
  maxDays?: number;
};

export type CustomsSettings = {
  enabled?: boolean;
  // DDP = duties collected at checkout; DDU/DAP = customer pays on delivery.
  dutyMode?: ShippingDutyMode;
  // estimated duty as a percentage of subtotal (used for DDP estimates)
  dutyRatePercent?: number;
  // orders at/below this subtotal are treated as duty-free (de minimis)
  deMinimis?: number;
};

export type ShippingSettings = {
  enabled?: boolean;
  weightUnit?: WeightUnit;
  delivery?: ShippingDeliveryDefaults;
  zones?: ShippingZone[];
  /**
   * Vendor profiles only: this vendor's prices for the platform's zones. The
   * platform profile itself never sets it.
   */
  zoneRates?: VendorZoneRates[];
  fallbackRate?: FallbackShippingRate;
  customs?: CustomsSettings;
  // when enabled, multi-vendor carts price each vendor's items against that
  // vendor's own shipping profile (falling back to this platform profile)
  vendorShipping?: { enabled?: boolean };
  origin?: ShippingDestination;
};

type LegacyOrderSettings = {
  freeShippingThreshold?: number;
  defaultShippingCost?: number;
};

type ShippingRateOptionSource = "zone" | "fallback" | "pickup" | "legacy";

export type ShippingRateOption = {
  id: string;
  name: string;
  cost: number;
  source: ShippingRateOptionSource;
  zoneId?: string;
  rateId?: string;
  deliveryDays?: { min: number; max: number };
};

export type ShippingCalculationResult = {
  available: boolean;
  // cost of the currently selected option (back-compat with callers that
  // only read shippingCost)
  shippingCost: number;
  source: "shipping" | "orders";
  zoneId?: string;
  rateId?: string;
  deliveryDays?: { min: number; max: number };
  // every option the customer may choose between at checkout
  options: ShippingRateOption[];
  // id of the option reflected in shippingCost above
  selectedOptionId?: string;
};

function n(value: unknown): number | undefined {
  const x = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(x)) return undefined;
  return x;
}

function normalizeToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function inRange(value: number, min?: number, max?: number) {
  if (typeof min === "number" && value < min) return false;
  if (typeof max === "number" && value > max) return false;
  return true;
}

function addDays(
  baseMin: number,
  baseMax: number,
  extraMin?: number,
  extraMax?: number,
) {
  const min = Math.max(0, baseMin + (extraMin ?? 0));
  const max = Math.max(min, baseMax + (extraMax ?? 0));
  return { min, max };
}

/**
 * How precisely a zone claims an address. Higher wins outright.
 *
 * Pooling every matching zone's rates together and letting the cheapest win
 * meant a country-wide zone could undercut the region zone written to override
 * it — an admin could not charge more for a remote province than for the rest
 * of the country. Ranking instead of pooling is what every other platform does
 * (WooCommerce matches exactly one zone, by hand-ordered specificity), and it
 * leaves room for a postcode tier above these two without touching callers.
 */
const ZONE_SPECIFICITY = {
  COUNTRY: 1,
  REGION: 2,
} as const;

/** The zone's specificity for this address, or null when it does not match. */
function zoneSpecificity(
  zone: ShippingZone,
  destinationCountry: string,
  destinationState: string,
): number | null {
  const countries = Array.isArray(zone.countries) ? zone.countries : [];
  if (!destinationCountry || countries.length === 0) return null;
  // By country, not by spelling: a zone saved as "USA" or "US" has to claim
  // the "United States" the checkout picker sends, or that zone ships nowhere.
  if (!countries.some((c) => areCountryValuesEquivalent(c, destinationCountry))) {
    return null;
  }

  const regions = Array.isArray(zone.regions) ? zone.regions : [];
  if (regions.length === 0) return ZONE_SPECIFICITY.COUNTRY;
  // A region-scoped zone is unreachable without a destination state — checkout
  // collects one for exactly this reason.
  if (!destinationState) return null;
  return regions.some((r) => normalizeToken(r) === destinationState)
    ? ZONE_SPECIFICITY.REGION
    : null;
}

/** Price every active rate in one zone against this cart. */
function zoneRateOptions(params: {
  zone: ShippingZone;
  subtotal: number;
  totalWeight: number;
  processingMin: number;
  processingMax: number;
  source: Extract<ShippingRateOptionSource, "zone" | "fallback">;
}): ShippingRateOption[] {
  const { zone, subtotal, totalWeight, processingMin, processingMax, source } =
    params;
  const options: ShippingRateOption[] = [];
  const rates = Array.isArray(zone.rates) ? zone.rates : [];

  for (const rate of rates) {
    if (rate && rate.active === false) continue;
    const type = rate.type ?? "flat";
    const base = {
      zoneId: zone.id,
      rateId: rate.id,
      name: rate.name || zone.name || "Shipping",
      source,
      deliveryDays: addDays(
        processingMin,
        processingMax,
        n(rate.minDays),
        n(rate.maxDays),
      ),
    };

    if (type === "flat") {
      options.push({
        ...base,
        id: rate.id || `${zone.id}-flat`,
        cost: Math.max(0, n(rate.price) ?? 0),
      });
      continue;
    }

    if (type === "free_over") {
      const freeOver = Math.max(0, n(rate.freeOver) ?? 0);
      if (subtotal >= freeOver) {
        options.push({
          ...base,
          id: rate.id || `${zone.id}-freeover`,
          cost: 0,
        });
      }
      continue;
    }

    if (type === "subtotal_range") {
      if (inRange(subtotal, n(rate.minSubtotal), n(rate.maxSubtotal))) {
        options.push({
          ...base,
          id: rate.id || `${zone.id}-subrange`,
          cost: Math.max(0, n(rate.price) ?? 0),
        });
      }
      continue;
    }

    if (type === "weight_range") {
      if (inRange(totalWeight, n(rate.minWeight), n(rate.maxWeight))) {
        const perUnit = Math.max(0, n(rate.pricePerWeightUnit) ?? 0);
        const cost = Math.max(0, n(rate.price) ?? 0) + perUnit * totalWeight;
        options.push({
          ...base,
          id: rate.id || `${zone.id}-weight`,
          cost: Math.max(0, cost),
        });
      }
      continue;
    }
  }

  return options;
}

function legacyShipping(subtotal: number, orders?: LegacyOrderSettings): number {
  const threshold = n(orders?.freeShippingThreshold) ?? 0;
  const base = Math.max(0, n(orders?.defaultShippingCost) ?? 5);
  return threshold > 0 && subtotal >= threshold ? 0 : base;
}

function pickSelected(
  options: ShippingRateOption[],
  selectedOptionId?: string,
): ShippingRateOption | undefined {
  if (options.length === 0) return undefined;
  if (selectedOptionId) {
    const match = options.find((o) => o.id === selectedOptionId);
    if (match) return match;
  }
  // default: cheapest, tiebreak by fastest max delivery
  return [...options].sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    const aMax = a.deliveryDays?.max ?? Number.POSITIVE_INFINITY;
    const bMax = b.deliveryDays?.max ?? Number.POSITIVE_INFINITY;
    return aMax - bMax;
  })[0];
}

export function calculateShipping(params: {
  subtotal: number;
  totalWeight?: number;
  totalWeightUnit?: InputWeightUnit;
  destination?: ShippingDestination;
  shipping?: ShippingSettings;
  orders?: LegacyOrderSettings;
  selectedOptionId?: string;
}): ShippingCalculationResult {
  const subtotal = Math.max(0, n(params.subtotal) ?? 0);
  const inputWeight = Math.max(0, n(params.totalWeight) ?? 0);
  const rateWeightUnit = params.shipping?.weightUnit ?? "kg";
  const gramsPerUnit: Record<InputWeightUnit, number> = {
    g: 1,
    kg: 1000,
    lb: 453.59237,
    oz: 28.349523125,
  };
  const totalWeight = params.totalWeightUnit
    ? (inputWeight * gramsPerUnit[params.totalWeightUnit]) /
      gramsPerUnit[rateWeightUnit]
    : inputWeight;

  const shippingEnabled = Boolean(params.shipping?.enabled);
  const destinationCountry = normalizeToken(params.destination?.country);
  const destinationState = normalizeToken(params.destination?.state);

  const processingMin = Math.max(
    0,
    n(params.shipping?.delivery?.processingDaysMin) ?? 0,
  );
  const processingMax = Math.max(
    processingMin,
    n(params.shipping?.delivery?.processingDaysMax) ?? processingMin,
  );

  if (!shippingEnabled) {
    const cost = legacyShipping(subtotal, params.orders);
    const option: ShippingRateOption = {
      id: "legacy",
      name: "Standard",
      cost,
      source: "legacy",
    };
    return {
      available: true,
      shippingCost: cost,
      source: "orders",
      options: [option],
      selectedOptionId: option.id,
    };
  }

  const zones = Array.isArray(params.shipping?.zones)
    ? (params.shipping?.zones ?? [])
    : [];

  // "Rest of the world" zones never compete on geography — they are what the
  // address falls back to once no ordinary zone has claimed it.
  const fallbackZones = zones.filter((zone) => zone.isFallback);

  const scored = zones
    .filter((zone) => !zone.isFallback)
    .map((zone) => ({
      zone,
      specificity: zoneSpecificity(zone, destinationCountry, destinationState),
    }))
    .filter(
      (entry): entry is { zone: ShippingZone; specificity: number } =>
        entry.specificity !== null,
    );

  // Only the most specific tier prices the order: a region zone shuts out the
  // country zone it was written to override. Ties (two zones naming the same
  // country) still pool, so the shopper keeps the choice between them.
  const bestSpecificity = scored.reduce(
    (best, entry) => Math.max(best, entry.specificity),
    -1,
  );
  const zoneMatches = scored
    .filter((entry) => entry.specificity === bestSpecificity)
    .map((entry) => entry.zone);

  const rateContext = {
    subtotal,
    totalWeight,
    processingMin,
    processingMax,
  };

  const options: ShippingRateOption[] = zoneMatches.flatMap((zone) =>
    zoneRateOptions({ ...rateContext, zone, source: "zone" }),
  );

  // Local pickup is offered as an additional (typically free) option.

  // Fallbacks only apply when no zone produced a shipping rate. The fallback
  // zone supersedes the single legacy fallback rate where both are configured.
  if (options.length === 0 && fallbackZones.length > 0) {
    options.push(
      ...fallbackZones.flatMap((zone) =>
        zoneRateOptions({ ...rateContext, zone, source: "fallback" }),
      ),
    );
  }

  const fallback = params.shipping?.fallbackRate;
  if (options.length === 0 && fallback?.enabled) {
    options.push({
      id: "fallback",
      name: fallback.name || "Standard",
      cost: Math.max(0, n(fallback.price) ?? 0),
      source: "fallback",
      deliveryDays: addDays(
        processingMin,
        processingMax,
        n(fallback.minDays),
        n(fallback.maxDays),
      ),
    });
  }

  if (options.length === 0) {
    return {
      available: false,
      shippingCost: 0,
      source: "shipping",
      options: [],
    };
  }

  const selected = pickSelected(options, params.selectedOptionId)!;
  return {
    available: true,
    shippingCost: selected.cost,
    source: "shipping",
    zoneId: selected.zoneId,
    rateId: selected.rateId,
    deliveryDays: selected.deliveryDays,
    options,
    selectedOptionId: selected.id,
  };
}

// ============================================================
// Multi-vendor shipping
// ============================================================

type VendorShippingGroup = {
  vendorId: string;
  subtotal: number;
  totalWeight?: number;
  totalWeightUnit?: InputWeightUnit;
  // the vendor's own shipping profile, if they manage one
  shipping?: ShippingSettings;
  selectedOptionId?: string;
};

type VendorShippingResult = {
  vendorId: string;
  result: ShippingCalculationResult;
};

type MultiVendorShippingResult = {
  perVendor: VendorShippingResult[];
  totalShippingCost: number;
  available: boolean;
};

function plainShippingSettings(
  shipping: ShippingSettings | undefined,
): ShippingSettings | undefined {
  const hydrated = shipping as
    | (ShippingSettings & { toObject?: () => ShippingSettings })
    | undefined;
  return typeof hydrated?.toObject === "function"
    ? hydrated.toObject()
    : shipping;
}

/**
 * The profile a vendor's items are actually rated against.
 *
 * Zones, their geography, the weight unit rate bounds are written in, duties
 * and the legacy fallback rate all stay the platform's: vendors price the
 * store's zones rather than drawing their own, so a shopper's address resolves
 * to the same zone whichever vendor they are buying from. What a vendor
 * contributes is the money — its rates for a zone, and its own processing days
 * and ship-from address. A zone it has priced nothing for keeps the store's
 * rates, which is what stops a half-configured vendor from reading as "does not
 * ship to you".
 *
 * A vendor still holding its own `zones` and no `zoneRates` predates this model
 * and is rated the old way until `scripts/migrate-vendor-zone-rates.ts` maps it
 * over.
 */
export function resolveVendorShippingProfile(params: {
  platformShipping?: ShippingSettings;
  vendorShipping?: ShippingSettings;
}): ShippingSettings | undefined {
  // The card and online-checkout routes read settings through `getSettings()`,
  // whose `shipping` is a hydrated subdocument: spreading one copies Mongoose's
  // internals, not its fields. The profile built below then had no `enabled`
  // and no zones, so every vendor with its own rates was charged the store's
  // flat legacy fee instead of the rate the checkout page had quoted.
  const platformShipping = plainShippingSettings(params.platformShipping);
  const vendorShipping = plainShippingSettings(params.vendorShipping);
  if (!vendorShipping?.enabled) return platformShipping;

  const ownZoneRates = Array.isArray(vendorShipping.zoneRates)
    ? vendorShipping.zoneRates
    : [];
  const legacyZones = Array.isArray(vendorShipping.zones)
    ? vendorShipping.zones
    : [];

  if (ownZoneRates.length === 0) {
    return legacyZones.length > 0 ? vendorShipping : platformShipping;
  }

  const ratesByZoneId = new Map(
    ownZoneRates
      .filter((entry) => entry?.zoneId)
      .map((entry) => [
        entry.zoneId,
        Array.isArray(entry.rates) ? entry.rates : [],
      ]),
  );

  const platformZones = Array.isArray(platformShipping?.zones)
    ? platformShipping.zones
    : [];

  return {
    ...platformShipping,
    delivery: vendorShipping.delivery ?? platformShipping?.delivery,
    origin: vendorShipping.origin ?? platformShipping?.origin,
    zones: platformZones.map((zone) => {
      const own = zone.id ? ratesByZoneId.get(zone.id) : undefined;
      // An entry with an empty rate list is not "no opinion" — it is a vendor
      // declaring it does not serve this zone, so the store's rates must not
      // quietly stand in for it.
      return own ? { ...zone, rates: own } : zone;
    }),
  };
}

/**
 * Price a multi-vendor cart. Each vendor group is rated against the profile
 * `resolveVendorShippingProfile` builds for it — the platform's zones carrying
 * that vendor's prices — falling back to the platform profile untouched when
 * vendor shipping is off or the vendor has configured nothing.
 */
export function calculateShippingByVendor(params: {
  groups: VendorShippingGroup[];
  destination?: ShippingDestination;
  platformShipping?: ShippingSettings;
  orders?: LegacyOrderSettings;
}): MultiVendorShippingResult {
  const vendorShippingEnabled = Boolean(
    params.platformShipping?.vendorShipping?.enabled,
  );

  const perVendor = params.groups.map((group) => {
    const shipping = vendorShippingEnabled
      ? resolveVendorShippingProfile({
          platformShipping: params.platformShipping,
          vendorShipping: group.shipping,
        })
      : params.platformShipping;

    const result = calculateShipping({
      subtotal: group.subtotal,
      totalWeight: group.totalWeight,
      totalWeightUnit: group.totalWeightUnit,
      destination: params.destination,
      shipping,
      orders: params.orders,
      selectedOptionId: group.selectedOptionId,
    });

    return { vendorId: group.vendorId, result };
  });

  const totalShippingCost = perVendor.reduce(
    (sum, v) => sum + Math.max(0, v.result.shippingCost),
    0,
  );

  return {
    perVendor,
    totalShippingCost,
    available: perVendor.every((vendor) => vendor.result.available),
  };
}

// ============================================================
// Customs / duties
// ============================================================

export type CustomsEstimate = {
  // estimated duty/tax collected at checkout (DDP only)
  dutyAmount: number;
  dutyMode: ShippingDutyMode;
  // true when the destination is treated as a cross-border shipment
  international: boolean;
  // true when duties are the customer's responsibility on delivery
  collectedAtCheckout: boolean;
};

/**
 * Estimate import duties for an order. Only produces a non-zero charge for
 * cross-border DDP shipments above the de-minimis threshold. DDU/DAP returns a
 * zero charge (customer settles with the carrier on delivery).
 */
export function estimateCustomsDuty(params: {
  subtotal: number;
  destination?: ShippingDestination;
  originCountry?: string;
  customs?: CustomsSettings;
}): CustomsEstimate {
  const dutyMode: ShippingDutyMode = params.customs?.dutyMode ?? "DDU";
  const enabled = Boolean(params.customs?.enabled);

  const destCountry = normalizeToken(params.destination?.country);
  const originCountry = normalizeToken(params.originCountry);
  // Same country, however it is spelled — an origin of "USA" must not make
  // every "United States" order a cross-border one that owes duty.
  const international = Boolean(
    destCountry &&
      originCountry &&
      !areCountryValuesEquivalent(destCountry, originCountry),
  );

  const collectedAtCheckout = enabled && international && dutyMode === "DDP";

  if (!collectedAtCheckout) {
    return {
      dutyAmount: 0,
      dutyMode,
      international,
      collectedAtCheckout: false,
    };
  }

  const subtotal = Math.max(0, n(params.subtotal) ?? 0);
  const deMinimis = Math.max(0, n(params.customs?.deMinimis) ?? 0);
  if (subtotal <= deMinimis) {
    return { dutyAmount: 0, dutyMode, international, collectedAtCheckout };
  }

  const ratePercent = Math.max(0, n(params.customs?.dutyRatePercent) ?? 0);
  const dutyAmount = Math.max(0, (subtotal * ratePercent) / 100);
  return { dutyAmount, dutyMode, international, collectedAtCheckout };
}
