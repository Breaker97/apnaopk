import Link from "@/components/language/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { messageTemplate } from "@/lib/i18n/message-template";
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
import { DashboardPeriodPicker } from "@/components/admin/dashboard-period-picker";
import { dashboardPickerBounds } from "@/lib/finance/dashboard-finance-period";
import { VendorStatementTable } from "@/components/vendor/finance/vendor-statement-table";
import { VendorBalanceCard } from "@/components/vendor/finance/vendor-balance-card";
import { formatCurrency } from "@/lib/intl/money";
import { loadVendorFinance } from "@/lib/finance/vendor-page-data";
import { loadVendorBalance } from "@/lib/vendors/vendor-balance";

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
  const { period, statements, vendor, storeCurrency } = await loadVendorFinance({
    locale,
    searchParams: search,
    // The dashboard's period and picker, opening on the month like Expenses.
    periods: "dashboard",
  });
  const pickerBounds = dashboardPickerBounds(period);
  // What the one "held for you" figure is actually made of, read from the
  // functions payout creation uses.
  const balance = await loadVendorBalance({
    vendorId: String(vendor._id),
    currency: typeof search.currency === "string" && /^[A-Za-z]{3}$/.test(search.currency) ? search.currency.toUpperCase() : storeCurrency,
  });

  const t = await getTranslations({ locale });
  const label = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;
  // The balance card fills its own placeholders — `{count}`, `{days}` — so the
  // message is wanted as a template; `t(key)` would refuse it for missing
  // values.
  const rawLabel = (key: string, fallback: string) =>
    messageTemplate(t, key, fallback);

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
        <DashboardPeriodPicker
          period={period.key}
          from={pickerBounds.from}
          to={pickerBounds.to}
          defaultPeriod="month"
        />
      </div>

      {balance.availableCurrencies && balance.availableCurrencies.length > 1 && <nav className="flex gap-3" aria-label={t("finance.reliability.currency")}>
        {balance.availableCurrencies.map((currency) => <Link key={currency} href={`/${locale}/vendor/finance?${new URLSearchParams({ ...Object.fromEntries(Object.entries(search).filter((entry): entry is [string, string] => typeof entry[1] === "string")), currency })}`} className={currency === balance.currency ? "font-semibold underline" : "text-muted-foreground"}>{currency}</Link>)}
      </nav>}
      <VendorBalanceCard
        balance={balance}
        locale={locale}
        labels={{
          title: rawLabel("finance.balance.title", "What you are owed"),
          ready: rawLabel("finance.balance.ready", "Ready for the next payout"),
          asOf: balance.calculatedAt ? t("finance.reliability.asOf", { date: balance.calculatedAt.toLocaleString(locale) }) : undefined,
          tooManyOrders: t("finance.reliability.tooManyOrders"),
          readyHint: rawLabel(
            "finance.balance.readyHint",
            "From {count} delivered orders, past the return window",
          ),
          belowMinimum: rawLabel(
            "finance.balance.belowMinimum",
            "A payout is made once this reaches {amount}",
          ),
          held: rawLabel("finance.balance.held", "Waiting out the return window"),
          heldHint: rawLabel(
            "finance.balance.heldHint",
            "Delivered, and payable {days} days after delivery",
          ),
          reserve: rawLabel("finance.balance.reserve", "Held against pre-orders"),
          reserveHint: rawLabel(
            "finance.balance.reserveHint",
            "Released from {date}",
          ),
          reserveUndated: label(
            "finance.balance.reserveUndated",
            "Released with a later payout",
          ),
          owedBack: rawLabel("finance.balance.owedBack", "Owed back to the store"),
          owedBackHint: label(
            "finance.balance.owedBackHint",
            "Paid to you on orders refunded since; it comes off your next payout",
          ),
        }}
      />

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
                      // The balance card above is the payout figure; this is
                      // the ledger's, which credits a sale the moment its
                      // money arrives. Two different questions, and they read
                      // as the same one when both say "waiting for a payout".
                      subLabel: label(
                        "finance.statement.closingHint",
                        "Your balance on the books — the card above shows what a payout can send",
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
                      <Link href="/vendor/finance/statements">
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
