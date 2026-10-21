import { getTranslations, setRequestLocale } from "next-intl/server";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardPeriodPicker } from "@/components/admin/dashboard-period-picker";
import { dashboardPickerBounds } from "@/lib/finance/dashboard-finance-period";
import { VendorStatementTable } from "@/components/vendor/finance/vendor-statement-table";
import { loadVendorFinance } from "@/lib/finance/vendor-page-data";
import { vendorFinanceQuery } from "@/lib/finance/vendor-finance-query";
import { VendorStatementPagination } from "@/components/vendor/finance/vendor-statement-pagination";
import { VendorStatementSummary } from "@/components/vendor/finance/vendor-statement-summary";
import Link from "@/components/language/link";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * The full statement: every line that moved, for a period the vendor chooses.
 *
 * Split from the overview because the two answer different questions — "where
 * do I stand" is five figures, "why" is a hundred rows — and one page carrying
 * both makes the five scroll away.
 */
export default async function VendorStatementsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const search = await searchParams;
  const { period, statements, page, pageSize, currency } = await loadVendorFinance({
    locale,
    searchParams: search,
    // The dashboard's period and picker, opening on the month like the overview.
    periods: "dashboard",
  });
  const pickerBounds = dashboardPickerBounds(period);

  const t = await getTranslations({ locale });
  const label = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;

  // A named period travels as its key and a picked one as its two days, so the
  // file covers what the screen is showing. Days, not instants: the export
  // route only reads `YYYY-MM-DD`.
  const exportParams = vendorFinanceQuery(period, currency);
  exportParams.set("type", "statement");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {label("finance.statement.statements", "Statements")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {label(
              "finance.statement.statementsSubtitle",
              "Every sale, refund and payout that moved your balance.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* A statement a seller cannot take out of the dashboard is one they
              re-type, and a re-typed figure is the one that ends up in the
              dispute. Opening and closing ride in the file as rows of their
              own, so it reconciles without the screen beside it. */}
          <Button asChild variant="outline" size="sm">
            <a href={`/api/vendor/finance/export?${exportParams.toString()}`}>
              <Download className="h-4 w-4" />
              {label("finance.statement.export", "Export")}
            </a>
          </Button>
          <DashboardPeriodPicker
            period={period.key}
            from={pickerBounds.from}
            to={pickerBounds.to}
            defaultPeriod="month"
            resetPage
          />
        </div>
      </div>

      {currency ? <p className="text-xs text-muted-foreground">{currency} · <Link className="text-primary hover:underline" href={`/vendor/finance/statements?${vendorFinanceQuery(period)}`}>{label("finance.statement.allCurrencies", "Show all currencies")}</Link></p> : null}

      {statements.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            {label(
              "finance.statement.empty",
              "Nothing moved in this period. Sales, refunds and payouts appear here as they happen.",
            )}
          </CardContent>
        </Card>
      ) : (
        statements.map((statement) => (
          <section key={statement.currency} className="space-y-4">
            {statements.length > 1 ? (
              <h2 className="text-sm font-semibold text-muted-foreground">
                {statement.currency}
              </h2>
            ) : null}
            <VendorStatementSummary statement={statement} />
            <VendorStatementTable lines={statement.lines} locale={locale} emptyMessage={statement.lineCount > 0 ? label("finance.statement.emptyPage", "No entries in this currency on this page.") : undefined} />
          </section>
        ))
      )}
      <VendorStatementPagination
        page={page} pageSize={pageSize}
        total={statements.reduce((sum, statement) => sum + statement.lineCount, 0)}
        shown={statements.reduce((sum, statement) => sum + statement.lines.length, 0)}
        href={`/vendor/finance/statements?${vendorFinanceQuery(period, currency)}`}
      />
    </div>
  );
}
