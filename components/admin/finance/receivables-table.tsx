"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeftRight } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/intl/money";
import type { VendorLedgerBalance } from "@/lib/finance/reports";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/** Initials for the avatar; a store name is what an admin recognises a row by. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The balances, in the same table every other admin list uses.
 *
 * A client component only because `DataTable` is one — the rows are computed on
 * the server and handed over whole, so there is no fetch here and nothing to
 * keep in sync. Written this way rather than as a bespoke `<table>` so sorting,
 * empty states, density and mobile behaviour come from one place: a second
 * hand-rolled table is a second thing to fix every time the first one improves.
 *
 * Every row says which way the money goes and carries the thing you would do
 * about it. A settlement column that is just a signed number asks the reader to
 * remember which sign means the platform owes and which means it is owed, and
 * the answer flips between rows on the same screen.
 */
export function ReceivablesTable({
  rows,
  showCurrency,
  locale,
}: {
  rows: VendorLedgerBalance[];
  showCurrency: boolean;
  locale: string;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);

  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState("all");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (term && !row.storeName?.toLowerCase().includes(term)) return false;
      if (direction === "owe") return row.net > 0;
      if (direction === "owed") return row.net < 0;
      return true;
    });
  }, [rows, search, direction]);

  const columns = useMemo<DataTableColumn<VendorLedgerBalance>[]>(
    () => [
      {
        id: "vendor",
        header: label("finance.receivables.vendor", "Vendor"),
        // Takes the slack so the three money columns sit together at the right
        // edge, close enough to read one row across without the eye travelling.
        className: "w-full",
        cell: (row) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                row.payable < 0
                  ? "bg-destructive/10 text-destructive"
                  : "bg-accent text-accent-foreground",
              )}
            >
              {initials(row.storeName || row.vendorId)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {row.storeName || row.vendorId}
              </p>
              {row.payable < 0 ? (
                <p className="text-xs text-destructive">
                  {label(
                    "finance.receivables.overpaidRow",
                    "Paid more than was ever held",
                  )}
                </p>
              ) : showCurrency ? (
                <p className="text-xs text-muted-foreground">{row.currency}</p>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: "payable",
        header: label("finance.receivables.heldFor", "Held for them"),
        className: "min-w-[9rem] whitespace-nowrap text-right",
        headerClassName: "text-right",
        cell: (row) => (
          <span
            className={cn(
              "tabular-nums",
              row.payable < 0 && "font-medium text-destructive",
            )}
          >
            {formatCurrency(row.payable, row.currency)}
          </span>
        ),
      },
      {
        id: "receivable",
        header: label("finance.overview.owedByVendors", "Commission owed"),
        className: "min-w-[9rem] whitespace-nowrap text-right",
        headerClassName: "text-right",
        cell: (row) =>
          row.receivable > 0 ? (
            // Amber, not red: it is money due, not money lost — and it is the
            // number the marketplace has to act on. Coloured text rather than a
            // pill, because a pill's own padding pushes its digits in from the
            // column edge and breaks the decimal line the other columns keep.
            <span className="font-medium tabular-nums text-amber-700 dark:text-amber-400">
              {formatCurrency(row.receivable, row.currency)}
            </span>
          ) : (
            <span className="tabular-nums text-muted-foreground">
              {formatCurrency(0, row.currency)}
            </span>
          ),
      },
      {
        id: "net",
        header: label("finance.receivables.net", "Net to settle"),
        className: "min-w-[11rem] whitespace-nowrap text-right",
        headerClassName: "text-right",
        cell: (row) => (
          <div>
            <p
              className={cn(
                "font-semibold tabular-nums",
                row.net < 0 && "text-destructive",
              )}
            >
              {formatCurrency(row.net, row.currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.net < 0
                ? label("finance.receivables.theyOweYou", "they owe you")
                : row.receivable > 0
                  ? label(
                      "finance.receivables.youOweAfter",
                      "you owe them, after commission",
                    )
                  : label("finance.receivables.youOweThem", "you owe them")}
            </p>
          </div>
        ),
      },
      {
        id: "settle",
        header: "",
        className: "whitespace-nowrap text-right",
        cell: (row) =>
          row.payable < 0 ? (
            // Nothing to pay: the balance is impossible and is cleared with a
            // correcting entry, which lives on the overview.
            <Button asChild variant="outline" size="sm">
              <Link href={`/${locale}/admin/finance`}>
                {label("finance.receivables.postAdjustment", "Post adjustment")}
              </Link>
            </Button>
          ) : row.payable > 0 ? (
            <Button asChild size="sm">
              <Link href={`/${locale}/admin/payouts?vendorId=${row.vendorId}`}>
                {label("finance.receivables.payOut", "Pay out")}
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={`/${locale}/admin/vendors/${row.vendorId}`}>
                {label("finance.receivables.viewVendor", "View vendor")}
              </Link>
            </Button>
          ),
      },
    ],
    [label, showCurrency, locale],
  );

  return (
    <DataTable<VendorLedgerBalance>
      data={visible}
      columns={columns}
      keyField="id"
      searchable
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={label(
        "finance.receivables.searchPlaceholder",
        "Search vendors…",
      )}
      tabs={[
        {
          id: "all",
          label: label("finance.receivables.everyone", "Everyone"),
          count: rows.length,
        },
        {
          id: "owe",
          label: label("finance.receivables.youOwe", "You owe"),
          count: rows.filter((row) => row.net > 0).length,
        },
        {
          id: "owed",
          label: label("finance.receivables.owedToYou", "They owe you"),
          count: rows.filter((row) => row.net < 0).length,
        },
      ]}
      activeTab={direction}
      onTabChange={setDirection}
      emptyIcon={<ArrowLeftRight className="h-8 w-8" />}
      emptyMessage={label(
        "finance.receivables.emptyBody",
        "Balances appear as orders are paid: the platform holds a vendor's share until a payout clears, and a vendor who collects cash themselves owes the commission on it.",
      )}
    />
  );
}
