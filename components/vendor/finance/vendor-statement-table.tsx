"use client";

import { Receipt } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/intl/money";
import type { VendorStatementLine } from "@/lib/finance/reports";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

const KIND_STYLES: Record<string, string> = {
  sale: "bg-green-100 text-green-800",
  payout: "bg-blue-100 text-blue-800",
  payout_returned: "bg-amber-100 text-amber-800",
  refund: "bg-red-100 text-red-700",
  refund_reversed: "bg-amber-100 text-amber-800",
  commission_settled: "bg-slate-100 text-slate-700",
  promotion_credit: "bg-green-100 text-green-800",
  delivery_label: "bg-slate-100 text-slate-700",
  repayment: "bg-blue-100 text-blue-800",
  commission: "bg-slate-100 text-slate-700",
  boost: "bg-purple-100 text-purple-800",
  subscription: "bg-purple-100 text-purple-800",
  other: "bg-slate-100 text-slate-700",
};

const KIND_FALLBACK: Record<string, string> = {
  sale: "Sale",
  payout: "Paid out",
  payout_returned: "Payout returned",
  refund: "Refund",
  refund_reversed: "Refund reversed",
  commission_settled: "Commission settled from payout",
  promotion_credit: "Promotion credit",
  delivery_label: "Delivery label",
  repayment: "You paid back",
  commission: "Commission",
  boost: "Boost",
  subscription: "Subscription",
  other: "Adjustment",
};

/**
 * The statement lines, as one table with five fixed columns.
 *
 * Date, type and reference read left; the two money columns read right, in
 * tabular figures, so a column of amounts lines up on its decimal point.
 * Fixed column widths keep every row on the same grid, however long a
 * reference or a type name is.
 *
 * The amount columns are signed from the VENDOR's side — what the marketplace
 * owes them goes up, a payout brings it back down — because a statement that
 * shows a payout as a positive number reads as being paid twice.
 *
 * `bare` drops the outer border, for a table that already sits inside a card.
 */
export function VendorStatementTable({
  lines,
  locale,
  bare = false,
  emptyMessage,
}: {
  lines: VendorStatementLine[];
  locale: string;
  bare?: boolean;
  emptyMessage?: string;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);

  // On a phone the Reference column steps aside (it is on the full statement)
  // so both amounts stay on screen without sideways scrolling.
  const headClass =
    "h-10 bg-muted/50 px-4 text-xs font-medium text-muted-foreground first:pl-6 last:pr-6 max-sm:px-2 max-sm:first:pl-4 max-sm:last:pr-4";
  const cellClass =
    "px-4 py-3.5 text-sm first:pl-6 last:pr-6 max-sm:px-2 max-sm:text-xs max-sm:first:pl-4 max-sm:last:pr-4";

  // Outside the table, so the message centres on the screen rather than on a
  // table that is wider than a phone.
  if (lines.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-2 bg-card px-6 py-12 text-center text-muted-foreground",
          bare ? "border-t" : "rounded-xl border",
        )}
      >
        <Receipt className="size-8" aria-hidden="true" />
        <p className="text-sm">
          {emptyMessage ??
            label(
              "finance.statement.empty",
              "Nothing moved in this period. Sales, refunds and payouts appear here as they happen.",
            )}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden bg-card",
        !bare && "rounded-xl border",
      )}
    >
      <Table className="table-fixed sm:min-w-[680px]">
        <TableHeader>
          <TableRow className="hover:bg-muted/50">
            <TableHead className={cn(headClass, "w-[17%] max-sm:w-[30%]")}>
              {label("finance.statement.date", "Date")}
            </TableHead>
            <TableHead className={cn(headClass, "w-[19%] max-sm:w-[22%]")}>
              {label("finance.statement.type", "Type")}
            </TableHead>
            <TableHead className={cn(headClass, "w-[20%] max-sm:hidden")}>
              {label("finance.statement.reference", "Reference")}
            </TableHead>
            <TableHead className={cn(headClass, "w-[22%] text-right max-sm:w-[24%]")}>
              {label("finance.statement.heldChange", "Held for you")}
            </TableHead>
            <TableHead className={cn(headClass, "w-[22%] text-right max-sm:w-[24%]")}>
              {label("finance.statement.owedChange", "You owe")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((row, index) => {
              const held =
                row.heldMovement ?? (row.affects === "held" ? row.amount : 0);
              const owed =
                row.owedMovement ?? (row.affects === "owed" ? row.amount : 0);
              return (
                <TableRow key={row.id || `${row.date}:${row.reference}:${index}`}>
                  <TableCell className={cn(cellClass, "text-muted-foreground tabular-nums")}>
                    {new Date(row.date).toLocaleDateString(locale, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </TableCell>
                  <TableCell className={cellClass}>
                    <Badge variant="secondary" className={KIND_STYLES[row.kind]}>
                      {label(
                        `finance.statement.kind.${row.kind}`,
                        KIND_FALLBACK[row.kind],
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn(cellClass, "truncate font-medium max-sm:hidden")}>
                    {row.reference || (
                      <span className="font-normal text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className={cn(cellClass, "text-right")}>
                    {held !== 0 ? (
                      <span
                        className={cn(
                          "font-semibold tabular-nums",
                          held < 0 && "text-destructive",
                        )}
                      >
                        {formatCurrency(held, row.currency)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className={cn(cellClass, "text-right")}>
                    {owed !== 0 ? (
                      // Amber rather than red: a debt is due, not lost, and it
                      // was never taken out of the money the marketplace is
                      // holding.
                      <span className="font-semibold tabular-nums text-amber-600">
                        {formatCurrency(owed, row.currency)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>
  );
}
