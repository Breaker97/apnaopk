/**
 * Settings → Tax: the store's tax classes, its region with the rate each class
 * is charged at, and how tax is worked out.
 *
 * A rate belongs to a class in a region and may start on a date, so a rate the
 * state has announced can be entered before it applies. A rate may be made of
 * parts — a state, a county and a city sales tax — and the parts combine
 * into the one rate the tax engine sees (`combinedRate`).
 *
 * The store's rate, `settings.orders.taxRate`, is the standard class's rate in
 * effect now. The save writes it, and every settings read works it out again
 * (`withEffectiveStoreRate`), so a scheduled rate takes effect on its date with
 * nobody saving. A product or category on another class is taxed at that
 * class's rate (lib/tax/tax-rates.ts).
 *
 * Only the first region is charged for now: a store taxes every sale at its
 * own region's rates, whatever the shopper's address.
 *
 * Pure and client-safe: the settings page, the save route and the rate
 * resolver all read the same rules from here.
 */

export const STANDARD_TAX_CLASS = "standard";
export const BUILT_IN_TAX_CLASSES = ["standard", "reduced", "zero", "exempt"] as const;
export type BuiltInTaxClass = (typeof BUILT_IN_TAX_CLASSES)[number];

/** Classes that are never taxed, in any region: no rate is entered for them. */
const UNTAXED_CLASSES: ReadonlySet<string> = new Set(["zero", "exempt"]);

export const MAX_CUSTOM_TAX_CLASSES = 16;
export const MAX_TAX_RATE_COMPONENTS = 3;
export const MAX_TAX_RATES_PER_CLASS = 12;
const CLASS_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HOME_REGION_KEY = "home";

export interface TaxClass {
  key: string;
  /** Built-in classes are named by the admin's language; only a custom class stores one. */
  name?: string;
  description?: string;
}

/** One part of a rate, in percent. */
export interface TaxRateComponent {
  name: string;
  rate: number;
  /** Charged on the price plus the parts before it: a tax on a tax. */
  compound?: boolean;
}

export interface TaxRateEntry {
  classKey: string;
  components: TaxRateComponent[];
  /** When this rate starts. A class's first rate has none: it applies from the start. */
  effectiveFrom?: string | Date | null;
}

export interface TaxRegion {
  key: string;
  name: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** What the registration is called there: Sales tax permit, Seller's permit. */
  registrationLabel: string;
  registrationNumber: string;
  rates: TaxRateEntry[];
}

export interface TaxCalculationSettings {
  /** The till's shelf prices already include tax. Mirrored to `pos.checkout.pricesIncludeTax`. */
  posPricesIncludeTax: boolean;
}

/**
 * Whether a vendor may change their products' tax (Charge tax, class, custom
 * rate): never, only through a request the admin approves, or freely. Only
 * the admin's side writes tax under the first two (lib/tax/vendor-tax.ts).
 */
export const VENDOR_TAX_CHANGE_POLICIES = ["never", "approval", "free"] as const;
export type VendorTaxChangePolicy = (typeof VENDOR_TAX_CHANGE_POLICIES)[number];
export const DEFAULT_VENDOR_TAX_CHANGE_POLICY: VendorTaxChangePolicy = "approval";

export interface TaxMarketplaceSettings {
  vendorTaxChanges: VendorTaxChangePolicy;
}

export interface TaxSettings {
  classes: TaxClass[];
  regions: TaxRegion[];
  calculation: TaxCalculationSettings;
  marketplace: TaxMarketplaceSettings;
}

/** What is stored, before `normalizeTaxSettings` fills it in. */
export type StoredTaxSettings =
  | {
      classes?: Array<Partial<TaxClass>> | null;
      regions?: Array<Partial<Omit<TaxRegion, "rates">> & { rates?: Array<Partial<TaxRateEntry>> | null }> | null;
      calculation?: Partial<TaxCalculationSettings> | null;
      marketplace?: Partial<TaxMarketplaceSettings> | null;
    }
  | null
  | undefined;

/** What the store ran on before Settings → Tax existed; the first save starts from it. */
export interface LegacyTaxSettings {
  /** `settings.orders.taxRate`, a fraction. */
  storeRate?: number | null;
  /** `settings.pos.checkout.pricesIncludeTax`. */
  posPricesIncludeTax?: boolean | null;
  /** The store's own country, for its region. */
  country?: string | null;
}

/**
 * The built-in classes' names in English, for answers the admin's language
 * does not reach (the business app's API). The admin screens translate them.
 */
export const BUILT_IN_TAX_CLASS_NAMES: Record<BuiltInTaxClass, string> = {
  standard: "Standard",
  reduced: "Reduced",
  zero: "Zero-rated",
  exempt: "Exempt",
};

export const isBuiltInTaxClass = (key: string): key is BuiltInTaxClass =>
  (BUILT_IN_TAX_CLASSES as readonly string[]).includes(key);

export const isUntaxedClass = (key: string) => UNTAXED_CLASSES.has(key);

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const percent = (value: unknown) => {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return 0;
  return Math.round(Math.min(100, Math.max(0, rate)) * 10_000) / 10_000;
};

/** A start date as a time; no date sorts before every dated one. */
export function rateStartTime(value: TaxRateEntry["effectiveFrom"]): number {
  if (value === null || value === undefined || value === "") return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

const startIso = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value as string | Date);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/**
 * The parts of a rate as one fraction. Simple parts add up; each compound part
 * is then charged on the price with everything before it — a 6% state tax
 * and a 1% county tax add up to 7%; a 10% part with 15% charged on top of it
 * is 1.10 × 1.15 − 1 = 26.5%.
 */
export function combinedRate(components: ReadonlyArray<Pick<TaxRateComponent, "rate" | "compound">>): number {
  let simple = 0;
  for (const part of components) if (!part.compound) simple += percent(part.rate) / 100;
  let factor = 1 + simple;
  for (const part of components) if (part.compound) factor *= 1 + percent(part.rate) / 100;
  return Math.round((factor - 1) * 1e8) / 1e8;
}

export function homeTaxRegion(tax: StoredTaxSettings): TaxRegion | null {
  const region = tax?.regions?.[0];
  return region ? (region as TaxRegion) : null;
}

/** A class's rates in a region, oldest first. */
export function classRateEntries(region: Pick<TaxRegion, "rates"> | null, classKey: string): TaxRateEntry[] {
  return (region?.rates ?? [])
    .filter((entry) => entry.classKey === classKey)
    .sort((a, b) => rateStartTime(a.effectiveFrom) - rateStartTime(b.effectiveFrom));
}

/** The rate a class is charged at, at `at`; null when it has none yet. */
export function currentRateEntry(
  region: Pick<TaxRegion, "rates"> | null,
  classKey: string,
  at: number,
): TaxRateEntry | null {
  let current: TaxRateEntry | null = null;
  for (const entry of classRateEntries(region, classKey)) {
    if (rateStartTime(entry.effectiveFrom) <= at) current = entry;
  }
  return current;
}

/** The next rate a class moves to after `at`, if one is scheduled. */
export function nextRateEntry(
  region: Pick<TaxRegion, "rates"> | null,
  classKey: string,
  at: number,
): TaxRateEntry | null {
  return classRateEntries(region, classKey).find((entry) => rateStartTime(entry.effectiveFrom) > at) ?? null;
}

/**
 * Each class's rate (fraction) at `at`, in the store's region. The untaxed
 * classes are 0 even before anything is saved; a class with no rate is
 * missing, and is charged the standard rate.
 */
export function classRatesAt(tax: StoredTaxSettings, at: number): Map<string, number> {
  const rates = new Map<string, number>();
  for (const key of UNTAXED_CLASSES) rates.set(key, 0);
  const region = homeTaxRegion(tax);
  if (!region) return rates;
  const keys = new Set((region.rates ?? []).map((entry) => entry.classKey).filter(Boolean));
  for (const key of keys) {
    if (UNTAXED_CLASSES.has(key)) continue;
    const entry = currentRateEntry(region, key, at);
    if (entry) rates.set(key, combinedRate(entry.components ?? []));
  }
  return rates;
}

export const isTaxConfigured = (tax: StoredTaxSettings) => Boolean(tax?.regions?.length);

/** "Sales tax permit 123-456789": the store's registration as printed; empty without a number. */
export function taxRegistrationLine(tax: StoredTaxSettings): string {
  const region = homeTaxRegion(tax);
  const number = region?.registrationNumber?.trim();
  if (!number) return "";
  const label = region?.registrationLabel?.trim();
  return label ? `${label} ${number}` : number;
}

/**
 * The parts a class is charged at, at `at` — its own rate's, or the standard
 * class's when it has none. Untaxed classes, and a store that has not set up
 * Settings → Tax, have none (callers fall back to the one store rate).
 */
export function classComponentsAt(tax: StoredTaxSettings, classKey: string, at: number): TaxRateComponent[] {
  if (UNTAXED_CLASSES.has(classKey)) return [];
  const region = homeTaxRegion(tax);
  if (!region) return [];
  const entry = currentRateEntry(region, classKey, at) ?? currentRateEntry(region, STANDARD_TAX_CLASS, at);
  return (entry?.components ?? []).map((part) => ({
    name: part.name || "",
    rate: Number(part.rate) || 0,
    ...(part.compound ? { compound: true } : {}),
  }));
}

/** The store's rate (fraction) at `at`: the standard class's, or `fallback` before Tax is set up. */
export function storeTaxRateAt(tax: StoredTaxSettings, at: number, fallback: number): number {
  if (!isTaxConfigured(tax)) return fallback;
  return classRatesAt(tax, at).get(STANDARD_TAX_CLASS) ?? 0;
}

/**
 * Settings data with `orders.taxRate` worked out for now. Every settings read
 * goes through this, so the rate in effect is the one every checkout, till and
 * refund reads, on the day it starts.
 */
export function withEffectiveStoreRate<T extends { tax?: unknown; orders?: { taxRate?: number } | null }>(
  data: T,
  at: number,
): T {
  const tax = data.tax as StoredTaxSettings;
  if (!isTaxConfigured(tax) || !data.orders) return data;
  data.orders.taxRate = storeTaxRateAt(tax, at, Number(data.orders.taxRate) || 0);
  return data;
}

const isCountry = (value: string) => /^[A-Z]{2}$/.test(value);

function normalizeClasses(raw: StoredTaxSettings): TaxClass[] {
  const classes: TaxClass[] = BUILT_IN_TAX_CLASSES.map((key) => ({ key }));
  const seen = new Set<string>(BUILT_IN_TAX_CLASSES);
  for (const entry of raw?.classes ?? []) {
    const key = text(entry?.key, 40).toLowerCase();
    // A blank name is kept: the page holds a class whose name is being
    // retyped, and the save refuses it (`taxSettingsProblem`).
    const name = text(entry?.name, 60);
    if (!key || seen.has(key) || !CLASS_KEY_PATTERN.test(key)) continue;
    if (classes.length >= BUILT_IN_TAX_CLASSES.length + MAX_CUSTOM_TAX_CLASSES) break;
    seen.add(key);
    const description = text(entry?.description, 200);
    classes.push({ key, name, ...(description ? { description } : {}) });
  }
  return classes;
}

function normalizeRates(
  rates: Array<Partial<TaxRateEntry>> | null | undefined,
  classKeys: ReadonlySet<string>,
): TaxRateEntry[] {
  const out: TaxRateEntry[] = [];
  for (const entry of rates ?? []) {
    const classKey = text(entry?.classKey, 40);
    if (!classKeys.has(classKey) || UNTAXED_CLASSES.has(classKey)) continue;
    const components = (entry?.components ?? [])
      .slice(0, MAX_TAX_RATE_COMPONENTS)
      .map((part) => ({
        name: text(part?.name, 30),
        rate: percent(part?.rate),
        ...(part?.compound ? { compound: true } : {}),
      }));
    if (!components.length) continue;
    out.push({ classKey, effectiveFrom: startIso(entry?.effectiveFrom), components });
  }
  const order = [...classKeys];
  return out.sort(
    (a, b) =>
      order.indexOf(a.classKey) - order.indexOf(b.classKey) ||
      rateStartTime(a.effectiveFrom) - rateStartTime(b.effectiveFrom),
  );
}

/**
 * Tax settings with every gap filled: the built-in classes first, then the
 * store's own; one region, seeded from the store's old single rate the first
 * time; and how tax is worked out.
 */
export function normalizeTaxSettings(raw: StoredTaxSettings, legacy: LegacyTaxSettings = {}): TaxSettings {
  const classes = normalizeClasses(raw);
  const classKeys = new Set(classes.map((entry) => entry.key));
  const stored = raw?.regions?.[0];
  const legacyCountry = text(legacy.country, 2).toUpperCase();
  const country = text(stored?.country, 2).toUpperCase();
  const region: TaxRegion = stored
    ? {
        key: text(stored.key, 40) || HOME_REGION_KEY,
        name: text(stored.name, 80),
        country: isCountry(country) ? country : "",
        registrationLabel: text(stored.registrationLabel, 30),
        registrationNumber: text(stored.registrationNumber, 60),
        rates: normalizeRates(stored.rates, classKeys),
      }
    : {
        key: HOME_REGION_KEY,
        name: "",
        country: isCountry(legacyCountry) ? legacyCountry : "",
        registrationLabel: "",
        registrationNumber: "",
        rates: [
          {
            classKey: STANDARD_TAX_CLASS,
            effectiveFrom: null,
            components: [{ name: "", rate: percent(Number(legacy.storeRate ?? 0) * 100) }],
          },
        ],
      };
  const posPricesIncludeTax =
    typeof raw?.calculation?.posPricesIncludeTax === "boolean"
      ? raw.calculation.posPricesIncludeTax
      : legacy.posPricesIncludeTax === true;
  return {
    classes,
    regions: [region],
    calculation: { posPricesIncludeTax },
    marketplace: { vendorTaxChanges: vendorTaxChangePolicy(raw) },
  };
}

/** The classes a product or category can be filed under, for their editors' pickers. */
export function taxClassOptions(raw: StoredTaxSettings): TaxClass[] {
  return normalizeClasses(raw);
}

/** How vendors may change their products' tax; a store that never chose asks for approval. */
export function vendorTaxChangePolicy(raw: StoredTaxSettings): VendorTaxChangePolicy {
  const stored = raw?.marketplace?.vendorTaxChanges;
  return (VENDOR_TAX_CHANGE_POLICIES as readonly unknown[]).includes(stored)
    ? (stored as VendorTaxChangePolicy)
    : DEFAULT_VENDOR_TAX_CHANGE_POLICY;
}

/**
 * How a vendor's product editor shows tax: locked, with or without a way to
 * ask the store (lib/tax/vendor-tax.ts), or undefined when vendors edit it.
 */
export function vendorTaxLock(raw: StoredTaxSettings): "approval" | "never" | undefined {
  const policy = vendorTaxChangePolicy(raw);
  return policy === "free" ? undefined : policy;
}

/** What an import writes in the tax class column to put a row back on its parent's tax. */
export const INHERIT_TAX_KEYWORD = "inherit";

/**
 * A file's tax class and tax rate cells as the fields they set, the way the
 * editors set them: a class clears a custom rate, a rate clears the class,
 * and `inherit` clears both. Empty cells set nothing. `classes` are the
 * store's class keys; a class outside them is refused rather than silently
 * charged the standard rate.
 */
export function importedTax(
  taxClass: string | undefined,
  taxRate: number | undefined,
  classes?: ReadonlySet<string>,
): { taxClass?: string | null; taxRate?: number | null } {
  const key = taxClass?.trim().toLowerCase();
  if (!key && taxRate === undefined) return {};
  if (key === INHERIT_TAX_KEYWORD) {
    if (taxRate !== undefined) throw new Error(`taxClass "${INHERIT_TAX_KEYWORD}" takes no taxRate.`);
    return { taxClass: null, taxRate: null };
  }
  if (key && taxRate !== undefined) {
    throw new Error("Give a taxClass or a taxRate, not both: a custom rate takes the place of a class.");
  }
  if (taxRate !== undefined) {
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      throw new Error(`taxRate must be a percentage from 0 to 100 (got "${taxRate}").`);
    }
    return { taxClass: null, taxRate };
  }
  if (!CLASS_KEY_PATTERN.test(key ?? "") || (classes && !classes.has(key ?? ""))) {
    const known = classes ? [...classes, INHERIT_TAX_KEYWORD] : [...BUILT_IN_TAX_CLASSES, INHERIT_TAX_KEYWORD];
    throw new Error(`taxClass must be one of ${known.join(", ")} (got "${taxClass}").`);
  }
  return { taxClass: key, taxRate: null };
}

/**
 * Why a save would be wrong, or null. Read after `normalizeTaxSettings`, which
 * has already dropped what cannot be kept; this refuses what it cannot guess.
 */
export function taxSettingsProblem(raw: StoredTaxSettings): string | null {
  const keys = new Set<string>();
  for (const entry of raw?.classes ?? []) {
    const key = text(entry?.key, 41).toLowerCase();
    if (isBuiltInTaxClass(key)) continue;
    if (!CLASS_KEY_PATTERN.test(key)) return "A tax class key may use only lowercase letters, numbers and dashes";
    if (!text(entry?.name, 60)) return "Every tax class needs a name";
    if (keys.has(key)) return `Two tax classes share the key "${key}"`;
    keys.add(key);
  }
  if (keys.size > MAX_CUSTOM_TAX_CLASSES) return `A store can add up to ${MAX_CUSTOM_TAX_CLASSES} tax classes of its own`;
  const policy = raw?.marketplace?.vendorTaxChanges;
  if (policy !== undefined && !(VENDOR_TAX_CHANGE_POLICIES as readonly unknown[]).includes(policy)) {
    return "Choose whether vendors may change their products' tax";
  }
  if ((raw?.regions?.length ?? 0) > 1) return "Only one tax region can be charged for now";
  const region = raw?.regions?.[0];
  if (!region) return "Add the store's tax region";
  const country = text(region.country, 3).toUpperCase();
  if (country && !isCountry(country)) return "Choose the region's country from the list";
  const byClass = new Map<string, Array<Partial<TaxRateEntry>>>();
  for (const entry of region.rates ?? []) {
    const classKey = text(entry?.classKey, 40);
    if (!isBuiltInTaxClass(classKey) && !keys.has(classKey)) return "A rate names a tax class that does not exist";
    if (isUntaxedClass(classKey)) return "Zero-rated and exempt classes are never charged, so they take no rate";
    const parts = entry?.components ?? [];
    if (!parts.length) return "Every rate needs at least one part";
    if (parts.length > MAX_TAX_RATE_COMPONENTS) return `A rate can have up to ${MAX_TAX_RATE_COMPONENTS} parts`;
    for (const part of parts) {
      const rate = Number(part?.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) return "A tax rate must be between 0% and 100%";
    }
    // A line's rate is kept in percent on the order, which holds up to 100: parts
    // that each pass, but compound or add up to more, would be taken at the
    // settings and refused when the first order is saved.
    const combined = combinedRate(parts.map((part) => ({ rate: Number(part?.rate), compound: Boolean(part?.compound) })));
    if (combined > 1 + 1e-9) return "A rate's parts add up to more than 100%";
    if (entry?.effectiveFrom && startIso(entry.effectiveFrom) === null) return "A rate's start date is not a date";
    byClass.set(classKey, [...(byClass.get(classKey) ?? []), entry]);
  }
  if (!byClass.has(STANDARD_TAX_CLASS)) return "The standard class needs a rate";
  for (const entries of byClass.values()) {
    if (entries.length > MAX_TAX_RATES_PER_CLASS) return `A class can hold up to ${MAX_TAX_RATES_PER_CLASS} rates`;
    const starts = entries.map((entry) => startIso(entry.effectiveFrom));
    if (starts.filter((start) => start === null).length !== 1) {
      return "Each class's first rate applies from the start; later ones need a start date";
    }
    if (new Set(starts).size !== starts.length) return "Two rates of one class start on the same date";
  }
  return null;
}
