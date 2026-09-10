import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowDownRight } from "lucide-react";
import {
  DashboardStatsGrid,
  type DashboardStatCardItem,
} from "@/components/admin/dashboard-stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { FinancePeriodPicker } from "@/components/admin/finance/finance-period-picker";
import { VendorStatementTable } from "@/components/vendor/finance/vendor-statement-table";
import { formatCurrency } from "@/lib/intl/money";
import { loadVendorFinance } from "@/lib/finance/vendor-page-data";

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
  const { period, statements } = await loadVendorFinance({
    locale,
    searchParams: search,
  });

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
        <FinancePeriodPicker
          period={period.key}
          from={period.from.toISOString()}
          to={period.to.toISOString()}
          book="all"
          showBookFilter={false}
        />
      </div>

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
            (line) => line.affects === "owed",
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
                      label: label("finance.statement.owedOrders", "Orders"),
                      value: String(owedLines.length),
                      subLabel: statement.currency,
                    },
                  ] satisfies DashboardStatCardItem[]
                }
              />
              <VendorStatementTable lines={owedLines} locale={locale} />
            </section>
          );
        })
      )}
    </div>
  );
}
