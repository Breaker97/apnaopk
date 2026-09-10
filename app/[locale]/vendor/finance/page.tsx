import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowDownRight,
  Banknote,
  HandCoins,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DashboardStatsGrid,
  type DashboardStatCardItem,
} from "@/components/admin/dashboard-stat-card";
import { FinancePeriodPicker } from "@/components/admin/finance/finance-period-picker";
import { VendorStatementTable } from "@/components/vendor/finance/vendor-statement-table";
import { formatCurrency } from "@/lib/intl/money";
import { loadVendorFinance } from "@/lib/finance/vendor-page-data";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * A vendor's own money, as a statement.
 *
 * Opening balance, what moved, closing balance — the shape of a bank statement,
 * because that is the shape a seller already knows how to check. A pile of
 * totals is what makes them open a ticket asking why the number is what it is.
 *
 * Read from the same ledger entries the marketplace's own Receivables screen
 * folds, so the two cannot tell a vendor different things. What is deliberately
 * NOT here is anything about the platform's profit: a vendor sees their side.
 */
export default async function VendorFinancePage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const search = await searchParams;
  // Shared with the other three finance screens, so the multi-vendor gate
  // cannot drift between them — this page carried its own copy of it, which is
  // the one thing the shared loader exists to prevent.
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
            {label("finance.statement.title", "Your finances")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {label(
              "finance.statement.subtitle",
              "What you earned, what was paid out, and what the marketplace is holding for you.",
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
          <CardContent className="py-16 text-center">
            <p className="font-medium">
              {label("finance.statement.emptyTitle", "Nothing to show yet")}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {label(
                "finance.statement.emptyBody",
                "Your statement fills in as orders are paid. Each sale adds what you earned; each payout takes it back out.",
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        statements.map((statement) => {
          const money = (value: number) =>
            formatCurrency(value, statement.currency);
          return (
            <section key={statement.currency} className="space-y-4">
              {statements.length > 1 ? (
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {statement.currency}
                </h2>
              ) : null}

              <DashboardStatsGrid
                stats={
                  [
                    {
                      id: "opening",
                      icon: <Wallet className="h-4 w-4" />,
                      label: label(
                        "finance.statement.opening",
                        "Opening balance",
                      ),
                      value: money(statement.opening),
                      subLabel: label(
                        "finance.statement.openingHint",
                        "Carried in from before this period",
                      ),
                    },
                    {
                      id: "earned",
                      icon: <TrendingUp className="h-4 w-4" />,
                      label: label("finance.statement.earned", "Earned"),
                      value: money(statement.earned),
                      subLabel: label(
                        "finance.statement.earnedHint",
                        "Your share of sales, after commission",
                      ),
                    },
                    {
                      id: "paid-out",
                      icon: <HandCoins className="h-4 w-4" />,
                      label: label("finance.statement.paidOut", "Paid out"),
                      value: money(statement.paidOut),
                    },
                    {
                      id: "closing",
                      icon: <Banknote className="h-4 w-4" />,
                      label: label("finance.statement.closing", "Held for you"),
                      value: money(statement.closing),
                      subLabel: label(
                        "finance.statement.closingHint",
                        "Waiting for the next payout",
                      ),
                    },
                    {
                      id: "owed",
                      icon: <ArrowDownRight className="h-4 w-4" />,
                      label: label("finance.statement.owed", "You owe"),
                      value: money(statement.owed),
                      // The half a vendor is most surprised by: cash they took
                      // at the door is theirs, but the commission on it is not.
                      subLabel: label(
                        "finance.statement.owedHint",
                        "Commission on orders you collected yourself",
                      ),
                    },
                  ] satisfies DashboardStatCardItem[]
                }
              />

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {label("finance.statement.activity", "Recent activity")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-0">
                  {/* The last handful only — the full period lives on
                      Statements, and an overview that scrolls for a hundred
                      rows stops being one. */}
                  <VendorStatementTable
                    lines={statement.lines.slice(-8).reverse()}
                    locale={locale}
                  />
                  <div className="px-4 pb-4">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/${locale}/vendor/finance/statements`}>
                        {label(
                          "finance.statement.seeAll",
                          "See the full statement",
                        )}
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>
          );
        })
      )}
    </div>
  );
}
