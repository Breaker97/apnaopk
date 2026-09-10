import { getTranslations, setRequestLocale } from "next-intl/server";
import { BarChart3, Download, Receipt } from "lucide-react";
import { connectDB } from "@/lib/db";
import { FiscalPeriod } from "@/models/fiscal-period.model";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FinancePeriodPicker } from "@/components/admin/finance/finance-period-picker";
import {
  PeriodClosePanel,
  type ClosedPeriodRow,
  type PeriodSnapshotLine,
} from "@/components/admin/finance/period-close-panel";
import { formatCurrency } from "@/lib/intl/money";
import {
  getProfitAndLoss,
  getTaxSummary,
  resolveRequestedPeriod,
} from "@/lib/finance/reports";
import { closableMonths, monthBounds } from "@/lib/finance/months";
import { formatPeriodRange } from "@/lib/finance/period-label";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Reports: the tax a store is holding, what an accountant gets handed, and the
 * line under each month.
 *
 * Every one of those answers a question asked from OUTSIDE the business, which
 * is why they sit together and away from the trading figures on the overview.
 *
 * They are not one list, though, and the screen says so. The tax figures and
 * the exports move with the period at the top; closing a month does not, and
 * has never had anything to do with it. Reading them as one column was how an
 * admin came to believe the period picker had changed which months could be
 * signed off.
 */
export default async function AdminFinanceReportsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  const search = await searchParams;
  const read = (key: string) =>
    typeof search[key] === "string" ? (search[key] as string) : undefined;
  const period = resolveRequestedPeriod({
    period: read("period") || "ytd",
    from: read("from"),
    to: read("to"),
  });

  await connectDB();
  const [tax, periods] = await Promise.all([
    getTaxSummary(period),
    FiscalPeriod.find()
      .sort({ to: -1 })
      .limit(24)
      .select("label closedAt note snapshot")
      .lean<ClosedPeriodRow[]>(),
  ]);

  const t = await getTranslations({ locale });
  const label = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;

  const serialized: ClosedPeriodRow[] = periods.map((row) => ({
    _id: String(row._id),
    label: row.label,
    closedAt: new Date(row.closedAt).toISOString(),
    note: row.note ?? null,
    snapshot: row.snapshot ?? [],
  }));

  /*
   * What closing the next month would freeze, computed before anyone commits
   * to it. The close API records exactly this aggregation as its snapshot, so
   * the preview is the figure that gets stored rather than a second opinion
   * about it.
   */
  const closedLabels = new Set(serialized.map((row) => row.label));
  const nextMonthKey = closableMonths(new Date()).find(
    (month) => !closedLabels.has(month),
  );
  const nextMonth = nextMonthKey
    ? {
        month: nextMonthKey,
        snapshot: (await getProfitAndLoss(monthBounds(nextMonthKey))).map(
          (book): PeriodSnapshotLine => ({
            currency: book.currency,
            income: book.totalIncome,
            expenses: book.totalExpenses,
            net: book.net,
          }),
        ),
      }
    : null;

  const periodLabel =
    period.key === "custom"
      ? formatPeriodRange(period, locale)
      : label(
          `finance.period.${period.key}`,
          period.key === "all" ? "All time" : `Last ${period.key}`,
        );

  /* Plain links, not fetches: a CSV is a download, and letting the browser do
     it keeps the file out of memory and the auth cookie in play. */
  const exportHref = (type: "ledger" | "expenses") => {
    const params = new URLSearchParams({ type });
    if (period.key === "custom") {
      params.set("from", read("from") || "");
      params.set("to", read("to") || "");
    } else {
      params.set("period", period.key);
    }
    return `/api/admin/finance/export?${params.toString()}`;
  };

  const exports = [
    {
      id: "ledger",
      icon: <BarChart3 className="size-[18px]" />,
      title: label("finance.reports.exportLedgerTitle", "Ledger"),
      body: label(
        "finance.reports.exportLedgerBody",
        "Every entry behind these figures — date, account, book, currency, and the order, payout or expense it came from.",
      ),
      href: exportHref("ledger"),
    },
    {
      id: "expenses",
      icon: <Receipt className="size-[18px]" />,
      title: label("finance.reports.exportExpensesTitle", "Expenses"),
      body: label(
        "finance.reports.exportExpensesBody",
        "What the store recorded as spent, with payee, category, what it was paid from and a link to each receipt.",
      ),
      href: exportHref("expenses"),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {label("finance.reports.title", "Reports")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {label(
              "finance.reports.subtitle",
              "What to hand an accountant, and where each month was signed off.",
            )}
          </p>
        </div>
        <FinancePeriodPicker
          period={period.key}
          from={period.from.toISOString()}
          to={period.to.toISOString()}
          book="all"
          showBookFilter={false}
        />
      </div>

      <SectionHeading
        title={label("finance.reports.forPeriod", "For {period}").replace(
          "{period}",
          periodLabel,
        )}
      />

      <Card className="gap-0 py-6">
        <CardContent className="px-6">
          <p className="text-base font-semibold">
            {label("finance.reports.tax", "Tax collected")}
          </p>
          <p className="mt-1.5 max-w-[80ch] text-sm text-muted-foreground">
            {/* The sentence that keeps this from being mistaken for a return. */}
            {label(
              "finance.reports.taxNote",
              "Money collected from buyers and owed onward — never income. Rates, thresholds and registration are your accountant's; these are the totals to hand them.",
            )}
          </p>

          {tax.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {label(
                "finance.reports.noTax",
                "No tax was charged in this period.",
              )}
            </p>
          ) : (
            <>
              {/*
                One row per currency, and the arithmetic left in: collected
                less refunded IS what is owed onward, and three stat cards
                each — nine of them for a store trading in three currencies —
                hid that relationship behind a grid.
              */}
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="pb-2 text-start font-medium">
                        {label("finance.reports.currency", "Currency")}
                      </th>
                      <th className="pb-2 text-end font-medium">
                        {label("finance.reports.taxCollected", "Collected")}
                      </th>
                      <th />
                      <th className="pb-2 text-end font-medium">
                        {label("finance.reports.taxRefunded", "Refunded")}
                      </th>
                      <th />
                      <th className="pb-2 text-end font-medium">
                        {label("finance.reports.taxNet", "Owed onward")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tax.map((row) => (
                      <tr key={row.currency} className="border-b last:border-0">
                        <td className="py-3">
                          <span className="inline-flex h-6 items-center rounded-full border bg-muted/50 px-2.5 text-xs font-medium">
                            {row.currency}
                          </span>
                        </td>
                        <td className="py-3 text-end tabular-nums">
                          {formatCurrency(row.collected, row.currency)}
                        </td>
                        <td className="px-3 text-center text-muted-foreground/60">
                          −
                        </td>
                        <td className="py-3 text-end tabular-nums">
                          {formatCurrency(row.refunded, row.currency)}
                        </td>
                        <td className="px-3 text-center text-muted-foreground/60">
                          =
                        </td>
                        <td className="py-3 text-end text-base font-semibold tabular-nums">
                          {formatCurrency(row.net, row.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {label(
                  "finance.reports.taxCurrencyHint",
                  "Each currency stands on its own line and is never added to another.",
                )}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="gap-0 py-6">
        <CardContent className="px-0">
          <div className="px-6">
            <p className="text-base font-semibold">
              {label("finance.reports.exports", "Hand to your accountant")}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {label(
                "finance.reports.exportsHint",
                "Both files cover the period above and open in Excel or Sheets.",
              )}
            </p>
          </div>
          {exports.map((row) => (
            <div
              key={row.id}
              className="mt-4 flex flex-wrap items-center gap-4 border-t px-6 pt-4 first-of-type:mt-4"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {row.icon}
              </span>
              <div className="min-w-[16rem] flex-1">
                <p className="text-sm font-medium">{row.title}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {row.body}
                </p>
              </div>
              <Button asChild variant="outline">
                <a href={row.href}>
                  <Download className="h-4 w-4" />
                  {label("finance.reports.downloadCsv", "Download CSV")}
                </a>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <SectionHeading
        title={label("finance.reports.monthEnd", "Month-end")}
        hint={label(
          "finance.reports.monthEndHint",
          "Not affected by the period above",
        )}
      />

      <PeriodClosePanel periods={serialized} nextMonth={nextMonth} />
    </div>
  );
}

/** A rule with a name on it — the page has two halves and they are not alike. */
function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <span className="h-px flex-1 bg-border" />
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}
