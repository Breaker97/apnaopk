import { allocateMoney, quantizeToCurrency } from "@/lib/intl/money";
import type { TaxRateComponent } from "@/lib/tax/tax-settings";

/**
 * A line's tax split into the parts of its rate — a state, a county and a
 * city sales tax, say, or a single "Tax" — so invoices and the tax report
 * can say how much of each was charged.
 *
 * The split follows the rate's own arithmetic (lib/tax/tax-settings.ts
 * `combinedRate`): each simple part is charged on the price; each compound
 * part on the price plus everything before it. The line's tax, already worked out and rounded, is shared out in
 * those proportions, so the parts always add up to exactly the tax charged.
 *
 * Pure and client-safe.
 */

export interface TaxPart {
  /** As named in Settings → Tax ("State", "County"); empty for an unnamed rate. */
  name: string;
  /** Percent. */
  rate: number;
  amount: number;
  /**
   * Charged on the price plus the parts before it rather than on the price
   * alone, which is what makes a line's combined rate more than the parts'
   * rates added up. Absent on a simple part, and on orders from before it was kept.
   */
  compound?: boolean;
}

/** Each part's share of a price (fractions that add up to the combined rate). */
export function partShares(components: ReadonlyArray<Pick<TaxRateComponent, "rate" | "compound">>): number[] {
  const rate = (part: Pick<TaxRateComponent, "rate">) => Math.max(0, Number(part.rate) || 0) / 100;
  let factor = 1 + components.reduce((sum, part) => sum + (part.compound ? 0 : rate(part)), 0);
  return components.map((part) => {
    if (!part.compound) return rate(part);
    const share = factor * rate(part);
    factor *= 1 + rate(part);
    return share;
  });
}

/** A line's tax split into its rate's parts; empty when nothing was charged. */
export function splitTax(
  tax: number,
  components: ReadonlyArray<Pick<TaxRateComponent, "name" | "rate" | "compound">>,
  currency: string,
): TaxPart[] {
  const amount = Math.max(0, Number(tax) || 0);
  if (amount <= 0 || components.length === 0) return [];
  if (components.length === 1) {
    return [{ name: components[0].name || "", rate: Number(components[0].rate) || 0, amount }];
  }
  const shares = allocateMoney(amount, partShares(components), currency);
  return components.map((part, index) => ({
    name: part.name || "",
    rate: Number(part.rate) || 0,
    amount: shares[index] ?? 0,
    ...(part.compound ? { compound: true } : {}),
  }));
}

/** Parts summed across lines: one row per part name and rate, in first-seen order. */
export function sumTaxParts(groups: ReadonlyArray<ReadonlyArray<TaxPart> | null | undefined>, currency: string): TaxPart[] {
  const totals = new Map<string, TaxPart>();
  for (const parts of groups) {
    for (const part of parts ?? []) {
      const key = `${part.name}\u0000${part.rate}\u0000${part.compound ? 1 : 0}`;
      const current = totals.get(key);
      if (current) current.amount += part.amount;
      else totals.set(key, { ...part });
    }
  }
  return [...totals.values()].map((part) => ({
    ...part,
    amount: quantizeToCurrency(part.amount, currency),
  }));
}

