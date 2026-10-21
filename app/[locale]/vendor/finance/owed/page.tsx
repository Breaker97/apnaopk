import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowDownRight } from "lucide-react";
import {
  DashboardStatsGrid,
  type DashboardStatCardItem,
} from "@/components/admin/dashboard-stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardPeriodPicker } from "@/components/admin/dashboard-period-picker";
import { dashboardPickerBounds } from "@/lib/finance/dashboard-finance-period";
import { VendorStatementTable } from "@/components/vendor/finance/vendor-statement-table";
import { formatCurrency } from "@/lib/intl/money";
import { loadVendorFinance } from "@/lib/finance/vendor-page-data";
import { vendorFinanceQuery } from "@/lib/finance/vendor-finance-query";
import { VendorStatementPagination } from "@/components/vendor/finance/vendor-statement-pagination";
import Link from "@/components/language/link";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * What the vendor owes the platform, and which orders it came from.
 *
 * The figure alone invites a dispute; the orders behind it end one. Every line
 * here is a sale the vendor collected in cash themselves — the money is already
 * theirs, and the commission on it is a debt rather than a deduction, which is
 * the part sellers are most often surprised by.
 */
export default async function VendorOwedPage({
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
    balance: "owed",
  });
  const pickerBounds = dashboardPickerBounds(period);

  const t = await getTranslations({ locale });
  const label = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {label("finance.statement.owedTitle", "Owed to the marketplace")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {label(
              "finance.statement.owedSubtitle",
              "Commission on orders you collected yourself. The money is already yours; this is what you owe on it.",
            )}
          </p>
        </div>
        <DashboardPeriodPicker
          period={period.key}
          from={pickerBounds.from}
          to={pickerBounds.to}
          defaultPeriod="month"
          resetPage
        />
      </div>

      {currency ? <p className="text-xs text-muted-foreground">{currency} · <Link className="text-primary hover:underline" href={`/vendor/finance/owed?${vendorFinanceQuery(period)}`}>{label("finance.statement.allCurrencies", "Show all currencies")}</Link></p> : null}

      {statements.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            {label(
              "finance.statement.owedEmpty",
              "You owe nothing for this period.",
            )}
          </CardContent>
        </Card>
      ) : (
        statements.map((statement) => {
          const owedLines = statement.lines.filter(
            (line) => (line.owedMovement ?? (line.affects === "owed" ? line.amount : 0)) !== 0,
          );
          return (
            <section key={statement.currency} className="space-y-3">
              <DashboardStatsGrid
                stats={
                  [
                    {
                      id: `${statement.currency}-owed`,
                      icon: <ArrowDownRight className="h-4 w-4" />,
                      label: label("finance.statement.owed", "You owe"),
                      value: formatCurrency(statement.owed, statement.currency),
                      subLabel: label(
                        "finance.statement.owedHint",
                        "Commission on orders you collected yourself",
                      ),
                    },
                    {
                      id: `${statement.currency}-orders`,
                      icon: <ArrowDownRight className="h-4 w-4" />,
                      label: label("finance.statement.chargedOrders", "Orders charged this period"),
                      value: String(statement.owedOrderCount ?? 0),
                      subLabel: statement.currency,
                    },
                  ] satisfies DashboardStatCardItem[]
                }
              />
              {statement.openingOwed !== 0 ? <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-muted-foreground">
                <span>{label("finance.statement.debtBroughtForward", "Debt brought forward")}: <span className="font-medium tabular-nums text-foreground">{formatCurrency(statement.openingOwed, statement.currency)}</span></span>
                <span>{label("finance.statement.debtMovement", "Change this period")}: <span className="font-medium tabular-nums text-foreground">{formatCurrency(statement.owedMovement, statement.currency)}</span></span>
                <Link className="font-medium text-primary hover:underline" href={`/vendor/finance/owed?${vendorFinanceQuery({ key: "custom", from: new Date(0), to: new Date(period.from.getTime() - 1) }, statement.currency)}`}>{label("finance.statement.earlierActivity", "View earlier activity")}</Link>
              </div> : null}
              <VendorStatementTable lines={owedLines} locale={locale} emptyMessage={statement.lineCount > 0 ? label("finance.statement.emptyPage", "No entries in this currency on this page.") : label("finance.statement.noDebtMovement", "No commission movements in this period.")} />
            </section>
          );
        })
      )}
      <VendorStatementPagination
        page={page} pageSize={pageSize}
        total={statements.reduce((sum, statement) => sum + statement.lineCount, 0)}
        shown={statements.reduce((sum, statement) => sum + statement.lines.length, 0)}
        href={`/vendor/finance/owed?${vendorFinanceQuery(period, currency)}`}
      />
    </div>
  );
}
