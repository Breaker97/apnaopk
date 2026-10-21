"use client";

import { useTranslations } from "next-intl";
import { VendorPeriodStrip } from "./vendor-period-strip";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { formatCurrency } from "@/lib/intl/money";
import type { VendorStatement } from "@/lib/finance/reports";

export type StatementSummary = Pick<VendorStatement, "currency" | "opening" | "earned" | "paidOut" | "closing" | "refunded" | "commissionSettled" | "credits" | "deliveryLabels" | "repaid" | "adjustments">;

/**
 * The four period figures, and — only when something else moved the balance —
 * one line under them naming it.
 *
 * Opening + Earned − Paid out does not always equal what is held: a refund or a
 * delivery label also moved it. That used to be a collapsible panel that
 * repeated the opening, earned and held figures and carried its own link to
 * the statement. Now it is just the missing pieces, so the sum can be checked
 * at a glance and nothing is said twice.
 */
export function VendorStatementSummary({ statement }: { statement: StatementSummary; statementHref?: string }) {
  const label = useFallbackTranslator(useTranslations());
  const money = (value: number) => formatCurrency(value, statement.currency);
  const other = [
    { id: "refunded", label: label("finance.statement.kind.refund", "Refunds"), amount: -statement.refunded },
    { id: "commissionSettled", label: label("finance.statement.kind.commission_settled", "Commission settled from payout"), amount: -statement.commissionSettled },
    { id: "deliveryLabels", label: label("finance.statement.kind.delivery_label", "Delivery labels"), amount: -statement.deliveryLabels },
    { id: "credits", label: label("finance.statement.kind.promotion_credit", "Promotion credits"), amount: statement.credits },
    { id: "repaid", label: label("finance.statement.kind.repayment", "You paid back"), amount: statement.repaid },
    { id: "adjustments", label: label("finance.statement.kind.other", "Adjustments"), amount: statement.adjustments },
  ].filter((row) => row.amount !== 0);

  return (
    <VendorPeriodStrip
      label={label("finance.statement.periodLabel", "This period")}
      items={[
        { id: "opening", label: label("finance.statement.opening", "Opening balance"), value: money(statement.opening), hint: label("finance.statement.openingHint", "Carried in from before this period") },
        { id: "earned", label: label("finance.statement.earned", "Earned"), value: money(statement.earned), hint: label("finance.statement.earnedHint", "Your share of sales, after commission") },
        { id: "paid-out", label: label("finance.statement.paidOut", "Paid out"), value: money(statement.paidOut) },
        { id: "closing", label: label("finance.statement.closing", "Held for you"), value: money(statement.closing), hint: label("finance.statement.balanceAtEndHint", "Your balance at the end of the selected period") },
      ]}
      extras={{
        label: label("finance.statement.otherMovements", "Other balance movements"),
        items: other.map((row) => ({
          id: row.id,
          label: row.label,
          value: `${row.amount > 0 ? "+" : ""}${money(row.amount)}`,
          tone: row.amount < 0 ? "negative" : "positive",
        })),
      }}
    />
  );
}
