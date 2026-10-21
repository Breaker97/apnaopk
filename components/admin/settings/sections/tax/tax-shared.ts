"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  isBuiltInTaxClass,
  normalizeTaxSettings,
  type BuiltInTaxClass,
  type TaxClass,
  type TaxSettings,
} from "@/lib/tax/tax-settings";
import type { Settings } from "@/components/admin/settings/types";

/**
 * Settings → Tax as the page edits it: what is saved, or — before the first
 * save — what the store runs on now (its one rate, the till's switch, its
 * country), so the page opens on the store's actual tax.
 */
export function taxSettingsOf(settings: Settings): TaxSettings {
  return normalizeTaxSettings(settings.tax, {
    storeRate: settings.orders?.taxRate,
    posPricesIncludeTax: settings.pos?.checkout?.pricesIncludeTax,
    country: settings.shipping?.origin?.country,
  });
}

/** A class's name and note in the admin's language; a custom class keeps its own. */
export function useTaxClassCopy() {
  const t = useTranslations("admin.settings.tax.classes");
  const builtIn: Record<BuiltInTaxClass, { name: string; description: string }> = {
    standard: { name: t("standard.name"), description: t("standard.description") },
    reduced: { name: t("reduced.name"), description: t("reduced.description") },
    zero: { name: t("zero.name"), description: t("zero.description") },
    exempt: { name: t("exempt.name"), description: t("exempt.description") },
  };
  return {
    name: (entry: Pick<TaxClass, "key" | "name">) =>
      isBuiltInTaxClass(entry.key) ? builtIn[entry.key].name : entry.name || entry.key,
    description: (entry: Pick<TaxClass, "key" | "description">) =>
      isBuiltInTaxClass(entry.key) ? builtIn[entry.key].description : entry.description || "",
  };
}

/** A rate (fraction) as the admin writes a percentage: 15%, 26.5%. */
export function useFormatTaxRate() {
  const locale = useLocale();
  const format = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 4 });
  return (fraction: number) => format.format(fraction);
}

/** A rate fraction as the number typed in a rate box: 0.07 reads 7, 0.265 reads 26.5. */
export const toPercent = (fraction: number) => Math.round(fraction * 1e6) / 1e4;

/**
 * A key for a new class, from its name where the name has latin letters
 * (`books`) and a counter where it has none; never one already taken.
 */
export function newClassKey(name: string, classes: TaxClass[]): string {
  const taken = new Set(classes.map((entry) => entry.key));
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const base = slug || "class";
  if (!taken.has(base) && slug) return base;
  for (let n = 2; ; n += 1) {
    const key = `${base}-${n}`;
    if (!taken.has(key)) return key;
  }
}

export function useFormatTaxDate() {
  const locale = useLocale();
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return (value: string | Date) => format.format(new Date(value));
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A stored start as the date input's `YYYY-MM-DD`, in the admin's own day. */
export function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The date input's day as the moment it starts, at the admin's midnight. */
export function fromDateInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Tomorrow at the admin's midnight: where a newly scheduled rate starts. */
export function tomorrowStart(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}
