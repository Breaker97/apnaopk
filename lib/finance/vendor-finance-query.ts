import type { FinancePeriod } from "./reports";

/** Keep the selected period stable as a seller moves between finance screens. */
export function vendorFinanceQuery(period: FinancePeriod & { key: string }, currency?: string, page = 1) {
  const query = new URLSearchParams();
  if (period.key === "custom") {
    query.set("from", period.from.toISOString().slice(0, 10));
    query.set("to", period.to.toISOString().slice(0, 10));
  } else query.set("period", period.key);
  if (currency) query.set("currency", currency);
  if (page > 1) query.set("page", String(page));
  return query;
}

export function vendorFinancePage(value: unknown) {
  const page = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 1;
  return Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1;
}
