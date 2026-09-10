"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Receipt } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/intl/money";
import type { VendorStatementLine } from "@/lib/finance/reports";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

const KIND_STYLES: Record<string, string> = {
  sale: "bg-green-100 text-green-800",
  payout: "bg-blue-100 text-blue-800",
  refund: "bg-red-100 text-red-700",
  commission: "bg-slate-100 text-slate-700",
  boost: "bg-purple-100 text-purple-800",
  subscription: "bg-purple-100 text-purple-800",
  other: "bg-slate-100 text-slate-700",
};

const KIND_FALLBACK: Record<string, string> = {
  sale: "Sale",
  payout: "Paid out",
  refund: "Refund",
  commission: "Commission",
  boost: "Boost",
  subscription: "Subscription",
  other: "Adjustment",
};

/**
 * The statement lines, in the same table the rest of the dashboard uses.
 *
 * The amount column is signed from the VENDOR's side — what the marketplace
 * owes them goes up, a payout brings it back down — because a statement that
 * shows a payout as a positive number reads as being paid twice.
 */
export function VendorStatementTable({
  lines,
  locale,
}: {
  lines: VendorStatementLine[];
  locale: string;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);

  const columns = useMemo<DataTableColumn<VendorStatementLine>[]>(
    () => [
      {
        id: "date",
        header: label("finance.statement.date", "Date"),
        cell: (row) => (
          <span className="tabular-nums">
            {new Date(row.date).toLocaleDateString(locale, {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            })}
          </span>
        ),
      },
      {
        id: "kind",
        header: label("finance.statement.type", "Type"),
        cell: (row) => (
          <Badge variant="secondary" className={KIND_STYLES[row.kind]}>
            {label(`finance.statement.kind.${row.kind}`, KIND_FALLBACK[row.kind])}
          </Badge>
        ),
      },
      {
        id: "reference",
        header: label("finance.statement.reference", "Reference"),
        cell: (row) => (
          <span className="text-muted-foreground">{row.reference || "—"}</span>
        ),
      },
      {
        id: "held",
        header: label("finance.statement.heldChange", "Held for you"),
        className: "text-right",
        headerClassName: "text-right",
        cell: (row) =>
          row.affects === "held" ? (
            <span
              className={`font-medium tabular-nums ${
                row.amount < 0 ? "text-destructive" : ""
              }`}
            >
              {formatCurrency(row.amount, row.currency)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "owed",
        header: label("finance.statement.owedChange", "You owe"),
        className: "text-right",
        headerClassName: "text-right",
        cell: (row) =>
          row.affects === "owed" ? (
            // Amber rather than red: a debt is due, not lost, and it was never
            // taken out of the money the marketplace is holding.
            <span className="font-medium tabular-nums text-amber-600">
              {formatCurrency(row.amount, row.currency)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [label, locale],
  );

  return (
    <DataTable<VendorStatementLine>
      data={lines}
      columns={columns}
      keyField="date"
      emptyIcon={<Receipt className="h-8 w-8" />}
      emptyMessage={label(
        "finance.statement.empty",
        "Nothing moved in this period. Sales, refunds and payouts appear here as they happen.",
      )}
    />
  );
}
