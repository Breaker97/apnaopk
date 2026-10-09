"use client";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/intl/money";

export function PayoutBreakdown({ breakdown, currency }: { breakdown: Record<string, number>; currency: string }) {
  const t = useTranslations("finance.reliability");
  const rows: Array<[string, number]> = [
    ["eligibleEarnings", 1], ["recoveryDeducted", -1], ["recoveryReturned", 1],
    ["reserveHeld", -1], ["reserveReleased", 1], ["reserveCreditDeducted", -1], ["reserveCreditReturned", 1],
    ["commissionOffset", -1], ["commissionCredit", 1],
  ];
  return <dl className="rounded-lg border p-4 space-y-2" aria-label={t("breakdown")}>
    {rows.filter(([key]) => breakdown[key] !== 0 && breakdown[key] !== undefined).map(([key, sign]) =>
      <div key={key} className="flex justify-between gap-4 text-sm"><dt>{t(key)}</dt><dd className="tabular-nums">{formatCurrency(breakdown[key] * sign, currency)}</dd></div>)}
    <div className="flex justify-between gap-4 border-t pt-2 font-semibold"><dt>{t("netAmount")}</dt><dd>{formatCurrency(breakdown.netAmount, currency)}</dd></div>
  </dl>;
}
