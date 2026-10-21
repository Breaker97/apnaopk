import Link from "@/components/language/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { messageTemplate } from "@/lib/i18n/message-template";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardPeriodPicker } from "@/components/admin/dashboard-period-picker";
import { dashboardPickerBounds } from "@/lib/finance/dashboard-finance-period";
import { VendorActivityCard } from "@/components/vendor/finance/vendor-activity-card";
import { VendorStatementSummary } from "@/components/vendor/finance/vendor-statement-summary";
import { vendorFinanceQuery } from "@/lib/finance/vendor-finance-query";
import { VendorBalanceCard } from "@/components/vendor/finance/vendor-balance-card";
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
    // The newest handful, read newest first — see `getVendorStatement`.
    recentLines: 8,
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
          nextPayout: label("finance.balance.nextPayout", "Estimated next payout"),
          ready: label("finance.balance.ready", "Ready for the next payout"),
          nothingReady: label("finance.balance.nothingReady", "Nothing ready yet"),
          paused: label("finance.balance.paused", "Payouts paused"),
          belowMinimumPill: label("finance.balance.belowMinimumPill", "Below the minimum"),
          howCalculated: label("finance.balance.howCalculated", "How this is worked out"),
          onItsWay: label("finance.balance.onItsWay", "On its way to you"),
          nothingOnWay: label(
            "finance.balance.nothingOnWay",
            "Nothing on its way yet. Paid orders show up here until they are ready for a payout.",
          ),
          asOf: balance.calculatedAt ? t("finance.reliability.asOf", { date: balance.calculatedAt.toLocaleString(locale) }) : undefined,
          tooManyOrders: label(
            "finance.balance.tooManyOrders",
            "More than 500 orders are ready: the store pays them in parts, oldest first",
          ),
          frozen: label(
            "finance.balance.frozen",
            "Payouts are paused while your account is suspended. Your sales keep counting.",
          ),
          inPayout: label("finance.balance.inPayout", "In a payout being prepared"),
          inPayoutHint: rawLabel("finance.balance.inPayoutHint", "{numbers} — on its way to you"),
          notDelivered: label("finance.balance.notDelivered", "Not delivered yet"),
          notDeliveredHint: rawLabel(
            "finance.balance.notDeliveredHint",
            "{count} paid orders on their way; the return window starts at delivery",
          ),
          awaitingBalance: label("finance.balance.awaitingBalance", "Pre-orders awaiting their balance"),
          awaitingBalanceHint: label(
            "finance.balance.awaitingBalanceHint",
            "Payable once the shopper pays the rest and the goods are delivered",
          ),
          commissionLeft: label("finance.balance.commissionLeft", "Commission still to settle"),
          commissionLeftHint: label(
            "finance.balance.commissionLeftHint",
            "On sales you collected yourself; it comes off a later payout or an invoice",
          ),
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
          owedBack: rawLabel("finance.balance.owedBackLater", "Still owed back to the store"),
          owedBackHint: label(
            "finance.balance.owedBackLaterHint",
            "Paid to you on orders refunded since; more than the next payout can take, so it comes off later ones",
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
          const statementHref = `/vendor/finance/statements?${vendorFinanceQuery(period, statement.currency)}`;
          return (
            <section key={statement.currency} className="space-y-4">
              {statements.length > 1 ? (
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {statement.currency}
                </h2>
              ) : null}

              <VendorStatementSummary statement={statement} statementHref={statementHref} />

              {/* The last handful only — the full period lives on Statements,
                  and an overview that scrolls for a hundred rows stops being
                  one. */}
              <VendorActivityCard
                lines={statement.lines}
                total={statement.lineCount}
                locale={locale}
                statementHref={statementHref}
              />
            </section>
          );
        })
      )}
    </div>
  );
}
