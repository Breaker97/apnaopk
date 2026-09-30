import Link from "@/components/language/link";
import { getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  Banknote,
  Boxes,
  Landmark,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { WarningBanner } from "@/components/ui/warning-banner";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/intl/money";
import { LEDGER_ACCOUNT, type LedgerAccount } from "@/lib/finance/accounts";
import {
  CANCELLED_BALANCES_PART,
  type CashPosition,
  type CostCoverage,
  type LedgerAnomaly,
  type ProfitAndLoss,
} from "@/lib/finance/reports";

/** English fallbacks; the UI prefers `finance.account.<key>`. */
const ACCOUNT_LABELS: Record<LedgerAccount, string> = {
  [LEDGER_ACCOUNT.CASH_GATEWAY]: "Gateway balance",
  [LEDGER_ACCOUNT.CASH_BANK]: "Bank",
  [LEDGER_ACCOUNT.CASH_ON_HAND]: "Cash in hand",
  [LEDGER_ACCOUNT.INVENTORY]: "Inventory",
  [LEDGER_ACCOUNT.VENDOR_PAYABLE]: "Owed to vendors",
  [LEDGER_ACCOUNT.COMMISSION_RECEIVABLE]: "Commission owed to you",
  [LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE]: "Owed by customers",
  [LEDGER_ACCOUNT.TAX_PAYABLE]: "Tax collected",
  [LEDGER_ACCOUNT.DUTY_PAYABLE]: "Duty collected",
  [LEDGER_ACCOUNT.ACCOUNTS_PAYABLE]: "Unpaid bills",
  [LEDGER_ACCOUNT.STORE_CREDIT_PAYABLE]: "Store credit held by shoppers",
  [LEDGER_ACCOUNT.PRODUCT_REVENUE]: "Product sales",
  [LEDGER_ACCOUNT.COMMISSION_INCOME]: "Commission",
  [LEDGER_ACCOUNT.SHIPPING_INCOME]: "Shipping charged",
  [LEDGER_ACCOUNT.BOOST_INCOME]: "Boosts",
  [LEDGER_ACCOUNT.SUBSCRIPTION_INCOME]: "Subscriptions",
  [LEDGER_ACCOUNT.REFUNDS]: "Refunds",
  [LEDGER_ACCOUNT.PROCESSING_FEES]: "Payment fees",
  [LEDGER_ACCOUNT.SHIPPING_COST]: "Shipping labels",
  [LEDGER_ACCOUNT.COST_OF_GOODS]: "Cost of goods",
  [LEDGER_ACCOUNT.PROMOTIONS]: "Store-funded discounts and credit",
  [LEDGER_ACCOUNT.CHARGEBACK_LOSSES]: "Chargeback losses",
  [LEDGER_ACCOUNT.OPERATING_EXPENSE]: "Operating expenses",
};

/** Cash accounts that also carry an impossible-balance warning. */
const CASH_ANOMALY_ACCOUNTS: Record<string, LedgerAccount> = {
  gateway: LEDGER_ACCOUNT.CASH_GATEWAY,
  bank: LEDGER_ACCOUNT.CASH_BANK,
  onHand: LEDGER_ACCOUNT.CASH_ON_HAND,
  inventory: LEDGER_ACCOUNT.INVENTORY,
};

/**
 * The profit and loss, and what the business is holding.
 *
 * Everything on this screen is a grouping of the ledger — the point of having
 * built one. Three things are deliberate and easy to get wrong:
 *
 * GMV sits apart from revenue and is labelled as volume, because on a
 * marketplace most of it belongs to vendors; the admin dashboard has been
 * calling that number "revenue" and this screen is where the distinction
 * finally shows up.
 *
 * Nothing is summed across currencies. Each currency the store has traded in is
 * a separate set of books, and it is chosen rather than stacked: sections one
 * under another read as a running total to anyone scrolling, which is the one
 * reading that is never true.
 *
 * The figures are grouped by the question they answer, not by their shape. A
 * screen of sixteen identical tiles has no hierarchy — every number arrives at
 * the same volume, so the one that matters (net) has to be found rather than
 * seen, and a balance that cannot be true looks exactly like a healthy one.
 */
export async function FinanceOverview({
  locale,
  profitAndLoss,
  cash,
  gmv,
  periodLabel,
  multiVendor,
  books,
  anomalies,
  activeCurrency,
  buildCurrencyHref,
  bookFiltered = false,
  costCoverage = [],
  holdingAsOf = null,
}: {
  locale: string;
  profitAndLoss: ProfitAndLoss[];
  cash: CashPosition[];
  gmv: Array<{ currency: string; amount: number; orders: number }>;
  periodLabel: string;
  multiVendor: boolean;
  /** Balances the books say are impossible, shown above the figures they spoil. */
  anomalies: LedgerAnomaly[];
  /** From the URL; ignored when the period holds nothing in that currency. */
  activeCurrency?: string;
  /** Where a currency chip points, built by the page that owns the query. */
  buildCurrencyHref?: (currency: string) => string;
  /**
   * True when one book is being shown on its own. The balances are not
   * filtered by it — there is one bank account behind both books — so the
   * holding card says so rather than letting them read as the book's own.
   */
  bookFiltered?: boolean;
  /**
   * How much of the store's own product sales has no cost recorded, per
   * currency. Cost of goods cannot include what nobody costed, so without this
   * the net read as profit when it was sales less fees.
   */
  costCoverage?: CostCoverage[];
  /**
   * The day the balances are read at, when that is not today — a picked
   * period that has already ended. Null means "as things stand now".
   */
  holdingAsOf?: string | null;
  /**
   * The same period split by book, when a marketplace is looking at both.
   * Present only then: a single-vendor store has one book, and one column
   * labelled "own store" beside nothing is a worse answer than no split.
   */
  books?: { own: ProfitAndLoss[]; marketplace: ProfitAndLoss[] } | null;
}) {
  const t = await getTranslations({ locale });
  const label = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;
  const accountLabel = (account: LedgerAccount) =>
    label(`finance.account.${account}`, ACCOUNT_LABELS[account]);
  /** A message with placeholders, filled in whichever copy is used. */
  const labelWith = (
    key: string,
    fallback: string,
    values: Record<string, string>,
  ) =>
    t.has(key)
      ? t(key, values)
      : Object.entries(values).reduce(
          (text, [name, value]) => text.replace(`{${name}}`, value),
          fallback,
        );

  if (profitAndLoss.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Receipt className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">
            {label(
              "finance.overview.emptyTitle",
              "Nothing booked in this period",
            )}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {label(
              "finance.overview.emptyBody",
              "Paid orders, refunds, payouts and expenses appear here as they happen. If this store has history, run the ledger backfill once to bring it in.",
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  // A currency whose balances cannot be right has to be reachable even in a
  // period it did not trade in — otherwise its warning has nowhere to show, and
  // the one screen that raises it would never be seen raising it.
  const faultCurrencies = [...new Set(anomalies.map((row) => row.currency))];
  const currencies = [
    ...profitAndLoss.map((row) => row.currency),
    ...faultCurrencies.filter(
      (currency) => !profitAndLoss.some((row) => row.currency === currency),
    ),
  ];

  // One set of books is shown at a time. A currency asked for but not traded in
  // this period falls back rather than rendering an empty screen — unless its
  // balances are what needs looking at.
  const book: ProfitAndLoss =
    profitAndLoss.find((row) => row.currency === activeCurrency) ??
    (activeCurrency && faultCurrencies.includes(activeCurrency)
      ? {
          currency: activeCurrency,
          income: [],
          expenses: [],
          totalIncome: 0,
          totalExpenses: 0,
          net: 0,
          shippingMargin: 0,
          hasAssumedCurrency: false,
        }
      : profitAndLoss[0]);
  const position = cash.find((row) => row.currency === book.currency);
  const volume = gmv.find((row) => row.currency === book.currency);
  const faults = anomalies.filter((row) => row.currency === book.currency);
  // Impossible balances in the currencies not on screen, named so they are not
  // missed by anyone who never opens that currency.
  const faultsElsewhere = faultCurrencies.filter(
    (currency) => currency !== book.currency,
  );
  const money = (value: number) => formatCurrency(value, book.currency);
  const percent = (share: number) =>
    new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: share > 0 && share < 0.01 ? 1 : 0,
    }).format(share);

  const faultFor = (account: LedgerAccount) =>
    faults.some((fault) => fault.account === account);

  // Bars are read against the largest line, not against the total: the total
  // includes the line itself, so the biggest cost would always paint as a
  // fraction of a bar it defines.
  const incomeMax = Math.max(...book.income.map((line) => line.amount), 1);
  const expenseMax = Math.max(...book.expenses.map((line) => line.amount), 1);
  // The two hero bars share one scale, the larger of the two. Income used to
  // paint full whatever it was, so a currency that earned nothing showed a
  // full income bar, and a loss drew both bars at the same length.
  const heroScale = Math.max(book.totalIncome, book.totalExpenses, 0);
  const incomeWidth =
    heroScale > 0 ? (Math.max(0, book.totalIncome) / heroScale) * 100 : 0;
  const costWidth =
    heroScale > 0 ? (Math.max(0, book.totalExpenses) / heroScale) * 100 : 0;

  // Product sales with no cost recorded — see `getCostCoverage`.
  const coverage = costCoverage.find((row) => row.currency === book.currency);
  const costGap =
    coverage && coverage.sales > 0 && coverage.uncosted > 0
      ? { amount: coverage.uncosted, share: coverage.uncosted / coverage.sales }
      : null;
  const lineLabel = (line: ProfitAndLoss["income"][number]) =>
    line.part === CANCELLED_BALANCES_PART
      ? label(
          "finance.overview.cancelledBalances",
          "Cancelled pre-order balances",
        )
      : accountLabel(line.account);

  // What vendors owe on the sales they collected themselves. Below zero it is
  // the other way round — a refund after the commission was invoiced left the
  // store owing them a credit — and a negative figure under "owed to you" read
  // as money coming in.
  const commissionReceivable = position?.receivable ?? 0;

  const owedRows: Array<{
    id: string;
    side: "owe" | "owed";
    label: string;
    hint: string;
    amount: number;
    fault: boolean;
    show: boolean;
  }> = [
    {
      id: "vendor-payable",
      side: "owe",
      label: label("finance.overview.owedToVendors", "Owed to vendors"),
      hint: label(
        "finance.overview.owedToVendorsHint",
        "Everything the books owe them, including sales not yet due for payout",
      ),
      amount: position?.vendorPayable ?? 0,
      fault: faultFor(LEDGER_ACCOUNT.VENDOR_PAYABLE),
      // On every view, a single book's included: the balances are the whole
      // business's, and the store's own view is where cash that is really the
      // vendors' most needs to be told apart.
      show: multiVendor,
    },
    {
      id: "tax-payable",
      side: "owe",
      label: label("finance.overview.taxPayable", "Tax collected"),
      hint: label(
        "finance.overview.taxPayableHint",
        "Charged to buyers and owed onward — record paying it under Adjust balances",
      ),
      amount: position?.taxPayable ?? 0,
      fault: faultFor(LEDGER_ACCOUNT.TAX_PAYABLE),
      show: true,
    },
    {
      id: "duty-payable",
      side: "owe",
      label: label("finance.overview.dutyPayable", "Duty collected"),
      hint: label(
        "finance.overview.dutyPayableHint",
        "Owed to customs on delivered-duty-paid orders",
      ),
      amount: position?.dutyPayable ?? 0,
      fault: faultFor(LEDGER_ACCOUNT.DUTY_PAYABLE),
      show: true,
    },
    {
      id: "store-credit",
      side: "owe",
      label: label("finance.overview.storeCredit", "Store credit held by shoppers"),
      hint: label(
        "finance.overview.storeCreditHint",
        "Given on refunds and by the store, not spent yet",
      ),
      amount: position?.storeCreditPayable ?? 0,
      fault: faultFor(LEDGER_ACCOUNT.STORE_CREDIT_PAYABLE),
      // Only once there is any: most stores never give credit.
      show: Math.abs(position?.storeCreditPayable ?? 0) > 0.0001,
    },
    {
      id: "accounts-payable",
      side: "owe",
      label: label("finance.overview.accountsPayable", "Unpaid bills"),
      hint: label(
        "finance.overview.accountsPayableHint",
        "Expenses recorded but not settled",
      ),
      amount: position?.accountsPayable ?? 0,
      fault: faultFor(LEDGER_ACCOUNT.ACCOUNTS_PAYABLE),
      show: true,
    },
    commissionReceivable >= 0
      ? {
          id: "commission-receivable",
          side: "owed",
          label: label(
            "finance.overview.owedByVendors",
            "Commission owed to you",
          ),
          hint: label(
            "finance.overview.owedByVendorsHint",
            "On sales the vendor collected themselves",
          ),
          amount: commissionReceivable,
          // Never a fault: a negative commission receivable is a credit the
          // platform owes the vendor after a refund, which is a mechanism
          // rather than an impossibility. See `findLedgerAnomalies`.
          fault: false,
          show: multiVendor,
        }
      : {
          id: "commission-credit",
          side: "owe",
          label: label(
            "finance.overview.commissionCredit",
            "Commission credit owed to vendors",
          ),
          hint: label(
            "finance.overview.commissionCreditHint",
            "Refunded after the commission was invoiced — comes off their next invoice",
          ),
          amount: -commissionReceivable,
          fault: false,
          show: multiVendor,
        },
    {
      id: "customer-receivable",
      side: "owed",
      label: label("finance.overview.customerReceivable", "Owed by customers"),
      hint: label(
        "finance.overview.customerReceivableHint",
        "Balances on part-paid pre-orders",
      ),
      amount: position?.customerReceivable ?? 0,
      fault: faultFor(LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE),
      show: true,
    },
  ];
  const owed = owedRows.filter((row) => row.show && row.amount !== 0);

  const youOwe = owed.filter((row) => row.side === "owe");
  const owedToYou = owed.filter((row) => row.side === "owed");

  const holdings = [
    {
      id: "gateway",
      icon: <Wallet className="size-4" />,
      label: label("finance.overview.gateway", "In the gateway"),
      // Nothing tells the books when a gateway pays out to the bank, so this
      // keeps everything ever collected until someone records the settlement.
      hint: label(
        "finance.overview.gatewayHint",
        "Until a payout to the bank is recorded under Adjust balances",
      ) as string | null,
      amount: position?.gateway ?? 0,
      key: "gateway",
      counts: true,
    },
    {
      id: "bank",
      icon: <Landmark className="size-4" />,
      label: label("finance.overview.bank", "In the bank"),
      hint: null,
      amount: position?.bank ?? 0,
      key: "bank",
      counts: true,
    },
    {
      id: "on-hand",
      icon: <Banknote className="size-4" />,
      label: label("finance.overview.onHand", "Cash in hand"),
      hint: label("finance.overview.onHandHint", "Registers and COD"),
      amount: position?.onHand ?? 0,
      key: "onHand",
      counts: true,
    },
    {
      id: "inventory",
      icon: <Boxes className="size-4" />,
      label: label("finance.overview.inventory", "Stock on hand"),
      hint: label(
        "finance.overview.inventoryHint",
        "What the unsold stock cost, from recorded purchases",
      ),
      amount: position?.inventory ?? 0,
      key: "inventory",
      // Stock is an asset, not cash. It sits in this list because it is
      // something the business is holding, and out of the total because a
      // "cash across all accounts" figure that includes unsold stock is the
      // number that makes a store think it can pay salaries.
      counts: false,
    },
  ];
  const visibleHoldings = holdings.filter(
    // Cash accounts stay even at zero — an empty till is a fact. Stock does
    // not: a store that has never recorded a purchase has no stock figure to
    // report, and a row of zero would read as one.
    (row) => row.counts || row.amount !== 0,
  );
  const cashTotal = holdings
    .filter((row) => row.counts)
    .reduce((sum, row) => sum + row.amount, 0);

  return (
    <div className="space-y-5">
      {/* Currencies as a choice, not as sections stacked down the page. */}
      {currencies.length > 1 && buildCurrencyHref ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {label("finance.overview.currency", "Currency")}
          </span>
          {currencies.map((currency) => (
            <Link
              key={currency}
              href={buildCurrencyHref(currency)}
              className={cn(
                "inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium transition-colors",
                currency === book.currency
                  ? "border-primary bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {currency}
            </Link>
          ))}
          <span className="text-xs text-muted-foreground">
            {label(
              "finance.overview.currencyHint",
              "Never added together — each is its own set of books",
            )}
          </span>
        </div>
      ) : null}

      {/*
        Balances that cannot be true, said out loud and at the top.

        Until this was here the screen printed a negative liability under
        "Held on their behalf until a payout clears" and a negative bank
        balance beside a healthy gateway, in the same weight as every other
        figure — so the one number on the page that meant something had gone
        wrong was the one number that looked most ordinary.
      */}
      {faults.length > 0 ? (
        <div className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3.5">
          <AlertTriangle className="mt-0.5 size-[18px] shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-destructive">
              {label(
                "finance.overview.anomalyTitle",
                "These balances cannot be right",
              )}
            </p>
            <ul className="mt-2 space-y-1">
              {faults.map((fault) => (
                <li
                  key={`${fault.account}-${fault.currency}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
                >
                  <span>
                    {accountLabel(fault.account)}
                    {/* `ms-`, not `ml-`: a left margin does not flip, so in
                        Arabic the account name and its explanation ran
                        straight into each other with no gap at all. */}
                    <span className="ms-2 text-xs text-muted-foreground">
                      {fault.kind === "negative-liability"
                        ? label(
                            "finance.overview.anomalyLiability",
                            "more has been handed over than was ever owed",
                          )
                        : fault.kind === "negative-receivable"
                          ? label(
                              "finance.overview.anomalyReceivable",
                              "more has been collected than was ever owed",
                            )
                          : label(
                              "finance.overview.anomalyCash",
                              "the account is holding less than nothing",
                            )}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums text-destructive">
                    {money(fault.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {label(
                "finance.overview.anomalyHint",
                "Entries are never edited, so this is resolved by posting a correcting one — use Adjust balances above.",
              )}
            </p>
          </div>
        </div>
      ) : null}

      {/* The same warning for the currencies not on screen. Each is its own set
          of books, but a balance that cannot be right is worth knowing about
          from whichever currency the page happens to open on. */}
      {faultsElsewhere.length > 0 ? (
        <WarningBanner tone="danger">
          {label(
            "finance.overview.anomalyElsewhere",
            "Balances that cannot be right in another currency:",
          )}{" "}
          {faultsElsewhere.map((currency, index) => (
            <span key={currency}>
              {index > 0 ? ", " : null}
              {buildCurrencyHref ? (
                <Link
                  href={buildCurrencyHref(currency)}
                  className="font-medium underline underline-offset-2"
                >
                  {currency}
                </Link>
              ) : (
                <span className="font-medium">{currency}</span>
              )}
            </span>
          ))}
        </WarningBanner>
      ) : null}

      {/* Two businesses, side by side and never added into one revenue line.
          The store sells its own goods and keeps all of it; the marketplace
          keeps a commission on other people's. Adding them would produce a
          revenue figure describing neither. */}
      {books ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {(
            [
              ["own", books.own, label("finance.book.own", "Own store")],
              [
                "marketplace",
                books.marketplace,
                label("finance.book.marketplace", "Marketplace"),
              ],
            ] as const
          ).map(([key, lines, title]) => {
            // This currency's figures or none at all. Falling back to the book's
            // first currency put dollar figures on the euro screen.
            const primary = lines.find((line) => line.currency === book.currency);
            const bookMoney = (value: number) =>
              formatCurrency(value, book.currency);
            return (
              <Card key={key} className="gap-0 py-5">
                <CardContent className="px-5">
                  <p className="text-base font-semibold">{title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {key === "own"
                      ? label(
                          "finance.book.ownHint",
                          "You are the seller: all of it is yours, and so is the stock it cost",
                        )
                      : label(
                          "finance.book.marketplaceHint",
                          "You are an agent: only your commission and fees are income",
                        )}
                  </p>
                  <div className="mt-3 space-y-1.5">
                    {!primary ? (
                      <p className="py-3 text-sm text-muted-foreground">
                        {label(
                          "finance.book.nothing",
                          "Nothing in this period",
                        )}
                      </p>
                    ) : (
                      <>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="text-muted-foreground">
                            {label("finance.overview.income", "Income")}
                          </span>
                          <span className="font-medium tabular-nums">
                            {bookMoney(primary.totalIncome)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="text-muted-foreground">
                            {label("finance.overview.expenses", "Costs")}
                          </span>
                          <span className="font-medium tabular-nums">
                            {bookMoney(primary.totalExpenses)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between border-t pt-2 text-sm font-semibold">
                          <span>{label("finance.overview.net", "Net")}</span>
                          <span
                            className={cn(
                              "tabular-nums",
                              primary.net >= 0
                                ? "text-green-600"
                                : "text-destructive",
                            )}
                          >
                            {bookMoney(primary.net)}
                          </span>
                        </div>
                        {key === "own" && costGap ? (
                          <p className="pt-1 text-xs text-muted-foreground">
                            {labelWith(
                              "finance.overview.costGapShort",
                              "No cost recorded for {share} of product sales — net is before their cost of goods",
                              { share: percent(costGap.share) },
                            )}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* The hero. One figure the eye lands on, and the two it came from. */}
      <Card className="gap-0 py-6">
        <CardContent className="grid gap-8 px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <p className="text-sm text-muted-foreground">
              {label("finance.overview.net", "Net")}
            </p>
            <p className="mt-1.5 text-4xl font-semibold tracking-tight tabular-nums">
              {money(book.net)}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {label("finance.overview.netHint", "Income less costs")} ·{" "}
              {periodLabel}
            </p>

            <div className="mt-6 space-y-3.5">
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    {label("finance.overview.income", "Income")}
                  </span>
                  <span className="text-[15px] font-semibold tabular-nums">
                    {money(book.totalIncome)}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${incomeWidth}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    {label("finance.overview.expenses", "Costs")}
                  </span>
                  <span className="text-[15px] font-semibold tabular-nums">
                    {money(book.totalExpenses)}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-muted-foreground/50"
                    style={{ width: `${costWidth}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5 lg:border-s lg:ps-8">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Banknote className="size-4" />
                <span className="text-sm">
                  {label("finance.overview.gmv", "Order volume")}
                </span>
              </div>
              <p className="mt-2 text-[22px] font-semibold tracking-tight tabular-nums">
                {volume ? money(volume.amount) : money(0)}
              </p>
              {/* The sub-label that keeps GMV from being read as revenue. */}
              <p className="mt-1 text-[13px] text-muted-foreground">
                {volume
                  ? `${labelWith("finance.overview.orders", "{count} orders", { count: String(volume.orders) })} — `
                  : ""}
                {multiVendor
                  ? label(
                      "finance.overview.gmvHintMarketplace",
                      "Everything ordered through the store, vendors' sales included, without tax — counted when the order was placed",
                    )
                  : label(
                      "finance.overview.gmvHint",
                      "Everything ordered, before costs and without tax — counted when the order was placed",
                    )}
              </p>
            </div>
            <div className="border-t pt-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <TrendingUp className="size-4" />
                <span className="text-sm">
                  {label("finance.overview.shippingMargin", "Shipping margin")}
                </span>
              </div>
              <p
                className={cn(
                  "mt-2 text-[22px] font-semibold tracking-tight tabular-nums",
                  book.shippingMargin > 0 && "text-green-600",
                  book.shippingMargin < 0 && "text-destructive",
                )}
              >
                {money(book.shippingMargin)}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {label(
                  "finance.overview.shippingMarginHint",
                  "Charged to buyers, less what labels cost",
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Where it came from, where it went — with the proportions visible. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-0 py-6">
          <CardContent className="px-6">
            <p className="text-base font-semibold">
              {label("finance.overview.whereItCameFrom", "Where it came from")}
            </p>
            {/*
              A set of books with costs and no income at all is almost never a
              bad month — it is a currency the store does not trade in. A
              gateway charges a dispute fee, and a carrier charges for a label,
              in THEIR currency, and each rightly posts in the one it was
              charged in (see `disputeFeePostings`). The result is a currency
              chip whose whole profit and loss is one fee and a negative net,
              which reads like something has gone wrong.
            */}
            {book.income.length === 0 && book.expenses.length > 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                {label(
                  "finance.overview.noIncome",
                  "Nothing was sold in this currency. Costs can still land in it — a gateway or a carrier charges in its own currency, and each is recorded as it was charged.",
                )}
              </p>
            ) : null}
            <div className="mt-4 space-y-3.5">
              {book.income.map((line) => (
                <div key={`${line.account}:${line.part ?? ""}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={cn(
                        "text-sm",
                        line.amount < 0 && "text-muted-foreground",
                      )}
                    >
                      {lineLabel(line)}
                      {/* Not money handed back — the balance never arrived. */}
                      {line.part === CANCELLED_BALANCES_PART ? (
                        <span className="mt-0.5 block text-xs">
                          {label(
                            "finance.overview.cancelledBalancesHint",
                            "Never paid, so nothing was refunded",
                          )}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-medium tabular-nums",
                        line.amount < 0 && "text-muted-foreground",
                      )}
                    >
                      {money(line.amount)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-1 rounded-full",
                        // A contra line reduces income; painting it in the
                        // same blue as the lines it eats into would read as
                        // one more source of money.
                        line.amount < 0
                          ? "bg-muted-foreground/30"
                          : "bg-primary",
                      )}
                      style={{
                        width: `${Math.max(1, (Math.abs(line.amount) / incomeMax) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-baseline justify-between gap-3 border-t pt-3 text-sm font-semibold">
              <span>{label("finance.overview.income", "Income")}</span>
              <span className="tabular-nums">{money(book.totalIncome)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-0 py-6">
          <CardContent className="px-6">
            <p className="text-base font-semibold">
              {label("finance.overview.whereItWent", "Where it went")}
            </p>
            {book.expenses.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                {label(
                  "finance.overview.noCosts",
                  "No costs recorded in this period. Payment fees and shipping labels arrive on their own; rent and salaries have to be entered.",
                )}
              </p>
            ) : (
              <>
                <div className="mt-4 space-y-3.5">
                  {book.expenses.map((line) => (
                    <div key={`${line.account}:${line.part ?? ""}`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm">
                          {lineLabel(line)}
                        </span>
                        <span className="text-sm font-medium tabular-nums">
                          {money(line.amount)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 rounded-full bg-muted">
                        <div
                          className="h-1 rounded-full bg-muted-foreground/60"
                          style={{
                            width: `${Math.max(1, (Math.abs(line.amount) / expenseMax) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
                  {label(
                    "finance.overview.costsHint",
                    "Payment fees and shipping labels arrive on their own. Rent and salaries have to be entered under Expenses.",
                  )}
                </p>
              </>
            )}
            {/* Cost of goods can only count what somebody costed. Without this
                the net below read as profit on a store that records no costs,
                when it was sales less fees. */}
            {costGap ? (
              <WarningBanner
                className="mt-4"
                title={labelWith(
                  "finance.overview.costGapTitle",
                  "Cost of goods is missing for {amount} of product sales ({share})",
                  { amount: money(costGap.amount), share: percent(costGap.share) },
                )}
              >
                {label(
                  "finance.overview.costGapBody",
                  "Those products have no cost recorded, so what they cost is not in Costs and Net is higher than the real profit. Add a cost to the product to count it from its next sale.",
                )}
              </WarningBanner>
            ) : null}
            <div className="mt-4 flex items-baseline justify-between gap-3 border-t pt-3 text-sm font-semibold">
              <span>{label("finance.overview.expenses", "Costs")}</span>
              <span className="tabular-nums">{money(book.totalExpenses)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* What it holds, and what of it is not its own. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-0 py-6">
          <CardContent className="px-6">
            <p className="text-base font-semibold">
              {label(
                "finance.overview.holding",
                "What the business is holding",
              )}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {/* A balance is read at the end of the period. For a picked
                  period that has already ended, that is not "now". */}
              {holdingAsOf
                ? labelWith("finance.overview.holdingAsOf", "As of {date}", {
                    date: holdingAsOf,
                  })
                : label("finance.overview.holdingHint", "As things stand now")}
            </p>
            {bookFiltered ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {label(
                  "finance.overview.balancesNotFiltered",
                  "The gateway, bank, till and vendor balances are the whole business — one bank account, one gateway and one till sit behind both books.",
                )}
              </p>
            ) : null}
            <div className="mt-2 divide-y">
              {visibleHoldings.map((row) => {
                const account = CASH_ANOMALY_ACCOUNTS[row.key];
                const impossible = account ? faultFor(account) : false;
                return (
                  <div key={row.id} className="flex items-center gap-3 py-3">
                    <span
                      className={cn(
                        "shrink-0",
                        impossible
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {row.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{row.label}</p>
                      {impossible ? (
                        <p className="mt-0.5 text-xs text-destructive">
                          {label(
                            "finance.overview.anomalyCash",
                            "the account is holding less than nothing",
                          )}
                        </p>
                      ) : row.hint ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {row.hint}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "text-sm font-medium tabular-nums",
                        impossible && "text-destructive",
                      )}
                    >
                      {money(row.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-3 text-sm font-semibold">
              <span>
                {label(
                  "finance.overview.cashTotal",
                  "Cash across all accounts",
                )}
              </span>
              <span className="tabular-nums">{money(cashTotal)}</span>
            </div>
          </CardContent>
        </Card>

        {/*
          Money that is in an account but is not the store's to spend, and
          money it is owed. Every row is hidden at zero: a store that charges no
          duty, bills nothing on terms and takes no deposits has nothing to say,
          and empty rows would say it loudly.
        */}
        {owed.length > 0 ? (
          <Card className="gap-0 py-6">
            <CardContent className="px-6">
              <p className="text-base font-semibold">
                {label("finance.overview.owed", "Owed")}
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {label(
                  "finance.overview.owedHint",
                  "What the store owes others, and what others still owe it",
                )}
              </p>

              {youOwe.length > 0 ? (
                <>
                  <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {label("finance.overview.youOwe", "You owe")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {label(
                      "finance.overview.youOweHint",
                      "Sitting in the accounts above, but not the store's to spend",
                    )}
                  </p>
                  <div className="mt-1 divide-y">
                    {youOwe.map((row) => (
                      <OwedRow key={row.id} row={row} money={money} />
                    ))}
                  </div>
                </>
              ) : null}

              {owedToYou.length > 0 ? (
                <>
                  <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {label("finance.overview.owedToYou", "Owed to you")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {label(
                      "finance.overview.owedToYouHint",
                      "Not received yet, so not in the accounts above",
                    )}
                  </p>
                  <div className="mt-1 divide-y">
                    {owedToYou.map((row) => (
                      <OwedRow key={row.id} row={row} money={money} />
                    ))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {book.hasAssumedCurrency ? (
        <WarningBanner>
          {label(
            "finance.overview.assumedCurrency",
            "Some figures come from orders placed before the store recorded a currency. They are counted in the store's own currency.",
          )}
        </WarningBanner>
      ) : null}
    </div>
  );
}

function OwedRow({
  row,
  money,
}: {
  row: { label: string; hint: string; amount: number; fault: boolean };
  money: (value: number) => string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{row.label}</p>
        <p
          className={cn(
            "mt-0.5 text-xs",
            row.fault ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {row.hint}
        </p>
      </div>
      <span
        className={cn(
          "text-sm font-medium tabular-nums",
          row.fault && "text-destructive",
        )}
      >
        {money(row.amount)}
      </span>
    </div>
  );
}
