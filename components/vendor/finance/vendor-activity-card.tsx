"use client";

import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { VendorStatementLine } from "@/lib/finance/reports";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { VendorStatementTable } from "@/components/vendor/finance/vendor-statement-table";

type Group = "sales" | "refunds" | "payouts" | "commission";

const GROUPS: Array<{ id: Group; kinds: VendorStatementLine["kind"][] }> = [
  { id: "sales", kinds: ["sale", "promotion_credit"] },
  { id: "refunds", kinds: ["refund", "refund_reversed"] },
  { id: "payouts", kinds: ["payout", "payout_returned", "repayment"] },
  { id: "commission", kinds: ["commission", "commission_settled"] },
];

const GROUP_FALLBACK: Record<Group, string> = {
  sales: "Sales",
  refunds: "Refunds",
  payouts: "Payouts",
  commission: "Commission",
};

/**
 * The newest few statement lines, in one card.
 *
 * The filter only offers a kind the lines actually contain, and is left out
 * altogether when there is just one — a row of chips that can only ever show
 * the same list is noise. The full period lives on Statements.
 */
export function VendorActivityCard({
  lines,
  total,
  locale,
  statementHref,
}: {
  lines: VendorStatementLine[];
  /** Entries in the whole period, which may exceed the lines listed. */
  total: number;
  locale: string;
  statementHref: string;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const [filter, setFilter] = useState<"all" | Group>("all");

  const present = useMemo(
    () =>
      GROUPS.filter((group) =>
        lines.some((line) => group.kinds.includes(line.kind)),
      ),
    [lines],
  );

  const visible = useMemo(() => {
    if (filter === "all") return lines;
    const group = GROUPS.find((entry) => entry.id === filter);
    return lines.filter((line) => group?.kinds.includes(line.kind));
  }, [filter, lines]);

  const options: Array<{ id: "all" | Group; text: string }> = [
    { id: "all", text: label("finance.statement.filterAll", "All") },
    ...present.map((group) => ({
      id: group.id,
      text: label(`finance.statement.filter.${group.id}`, GROUP_FALLBACK[group.id]),
    })),
  ];

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3.5 pt-5 sm:px-6">
        <h2 className="text-base font-semibold">
          {label("finance.statement.activity", "Recent activity")}
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {present.length > 1 ? (
            <div
              role="group"
              aria-label={label("finance.statement.filterLabel", "Filter activity")}
              className="inline-flex gap-0.5 rounded-[10px] bg-muted p-[3px]"
            >
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  className={cn(
                    "rounded-[8px] px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
                    filter === option.id &&
                      "bg-card text-foreground shadow-sm",
                  )}
                >
                  {option.text}
                </button>
              ))}
            </div>
          ) : null}
          <Link
            href={statementHref}
            className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {label("finance.statement.seeAll", "See the full statement")}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <VendorStatementTable
        lines={visible}
        locale={locale}
        bare
        emptyMessage={
          filter !== "all"
            ? label(
                "finance.statement.filterEmpty",
                "Nothing of this kind among the latest entries.",
              )
            : undefined
        }
      />

      {total > lines.length ? (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
          {label(
            "finance.statement.showingLatest",
            "Showing the latest {shown} of {total} entries",
            { shown: lines.length, total },
          )}
        </p>
      ) : null}
    </Card>
  );
}
