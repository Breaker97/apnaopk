import type { ProductProfit } from "@/lib/finance/product-profit";
import Link from "@/components/language/link";
import { getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  Landmark,
  Plus,
  Receipt,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
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
  [LEDGER_ACCOUNT.OPENING_INVENTORY_EQUITY]: "Opening inventory equity",
  [LEDGER_ACCOUNT.INVENTORY_ADJUSTMENTS]: "Inventory adjustments",
  [LEDGER_ACCOUNT.UNAPPLIED_PAYMENT_PAYABLE]:
    "Received payments awaiting application",
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
 * Every currency the overview can show for a period, in a stable order.
 *
 * Balance-only currencies count: opening stock, a bank balance or an
 * unfinished posting is still something to show when nothing traded. So does a
 * currency whose balances cannot be right — its warning needs somewhere to
 * appear even in a period it did not trade in.
 */
export function listOverviewCurrencies({
  profitAndLoss,
  cash,
  gmv,
  productProfit = [],
  postingCoverage = [],
  anomalies,
}: {
  profitAndLoss: ReadonlyArray<{ currency: string }>;
  cash: ReadonlyArray<{ currency: string }>;
  gmv: ReadonlyArray<{ currency: string }>;
  productProfit?: ReadonlyArray<{ currency: string }>;
  postingCoverage?: ReadonlyArray<{ currency: string }>;
  anomalies: ReadonlyArray<{ currency: string }>;
}): string[] {
  return [
    ...new Set([
      ...profitAndLoss.map((row) => row.currency),
      ...cash.map((row) => row.currency),
      ...gmv.map((row) => row.currency),
      ...productProfit.map((row) => row.currency),
      ...postingCoverage.map((row) => row.currency),
      ...anomalies.map((row) => row.currency),
    ]),
  ];
}

/**
 * One set of books is shown at a time. A currency asked for but absent from
 * this period falls back to the first one rather than an empty screen.
 */
export function pickOverviewCurrency(
  currencies: readonly string[],
  requested?: string,
): string {
  return requested && currencies.includes(requested)
    ? requested
    : currencies[0]!;
}

/**
 * The currency choice, in the filter row beside the period. Each currency is
 * its own set of books and is never added to another, so this switches the
 * page rather than stacking sections a reader would sum.
 */
export async function FinanceCurrencySwitch({
  locale,
  currencies,
  selected,
  buildCurrencyHref,
}: {
  locale: string;
  currencies: readonly string[];
  selected: string;
  buildCurrencyHref: (currency: string) => string;
}) {
  if (currencies.length < 2) return null;
  const t = await getTranslations({ locale });
  const label = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;
  return (
    <div className="flex items-center gap-1">
      <div
        role="group"
        aria-label={label("finance.overview.currency", "Currency")}
        className="inline-flex h-9 items-center gap-0.5 rounded-md border bg-background p-[3px] shadow-xs"
      >
        {currencies.map((currency) => (
          <Link
            key={currency}
            href={buildCurrencyHref(currency)}
            aria-current={currency === selected ? "true" : undefined}
            className={cn(
              "inline-flex h-7 items-center rounded-[10px] px-3 text-[13px] font-medium transition-colors",
              currency === selected
                ? "bg-accent font-semibold text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {currency}
          </Link>
        ))}
      </div>
      <InfoTip
        text={label(
          "finance.overview.currencyHint",
          "Never added together — each is its own set of books",
        )}
      />
    </div>
  );
}

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
  multiVendor,
  books,
  anomalies,
  activeCurrency,
  buildCurrencyHref,
  bookFiltered = false,
  costCoverage = [],
  productProfit = [],
  postingCoverage = [],
  holdingAsOf = null,
}: {
  locale: string;
  profitAndLoss: ProfitAndLoss[];
  cash: CashPosition[];
  gmv: Array<{ currency: string; amount: number; orders: number }>;
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
  productProfit?: ProductProfit[];
  postingCoverage?: Array<{
    currency: string;
    pending: number;
    conflicts: number;
  }>;
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

  const faultCurrencies = [...new Set(anomalies.map((row) => row.currency))];
  const currencies = listOverviewCurrencies({
    profitAndLoss,
    cash,
    gmv,
    productProfit,
    postingCoverage,
    anomalies,
  });
  if (currencies.length === 0) {
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
              "finance.overview.emptyGuidance",
              "Try a wider reporting period, or record your stock purchases and expenses to start building your financial picture.",
            )}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin/inventory/finance">
                <Boxes className="size-4" />
                {label("inventoryFinance.title", "Inventory and ledger")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin/finance/expenses">
                <Receipt className="size-4" />
                {label("finance.navigation.expenses", "Expenses")}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const selectedCurrency = pickOverviewCurrency(currencies, activeCurrency);
  const book: ProfitAndLoss = profitAndLoss.find(
    (row) => row.currency === selectedCurrency,
  ) ?? {
    currency: selectedCurrency,
    income: [],
    expenses: [],
    totalIncome: 0,
    totalExpenses: 0,
    net: 0,
    shippingMargin: 0,
    hasAssumedCurrency: false,
  };
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
      // "100%" of sales uncosted reads as "nothing was costed"; 99.9% is not.
      maximumFractionDigits:
        (share > 0 && share < 0.01) || (share > 0.99 && share < 1) ? 1 : 0,
    }).format(share);

  const faultFor = (account: LedgerAccount) =>
    faults.some((fault) => fault.account === account);

  // Bars are read against the largest line, not against the total: the total
  // includes the line itself, so the biggest cost would always paint as a
  // fraction of a bar it defines.
  const incomeMax = Math.max(...book.income.map((line) => line.amount), 1);
  const expenseMax = Math.max(...book.expenses.map((line) => line.amount), 1);
  // Product sales with no cost recorded — see `getCostCoverage`.
  const coverage = costCoverage.find((row) => row.currency === book.currency);
  const postingGap = postingCoverage.find(
    (row) => row.currency === book.currency,
  );
  const productMargin = productProfit.find(
    (row) => row.currency === book.currency,
  );
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
      label: label(
        "finance.overview.storeCredit",
        "Store credit held by shoppers",
      ),
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
  // An impossible balance always shows, even where its row would normally
  // hide: the alert above names it, so the figure has to be somewhere.
  const owed = owedRows.filter(
    (row) => (row.show || row.fault) && row.amount !== 0,
  );

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

  // The stock balance alone is the common case, and it has one cause worth
  // naming: sales took cost out of stock whose opening value never went in.
  const inventoryFault = faultFor(LEDGER_ACCOUNT.INVENTORY);
  const stockFaultOnly = inventoryFault && faults.length === 1;
  const faultReason = (fault: LedgerAnomaly) =>
    fault.account === LEDGER_ACCOUNT.INVENTORY
      ? label(
          "finance.overview.inventoryBalanceIssue",
          "Recorded stock costs exceed the inventory value added to the ledger",
        )
      : fault.kind === "negative-liability"
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
            );
  const inventoryHref = `/admin/inventory/finance?currency=${book.currency}`;

  // Own store and marketplace inside the net, not as two more cards: the net
  // is their sum, and three "Net" figures in a row read as three answers.
  const split = books
    ? (
        [
          ["own", books.own, label("finance.book.own", "Own store")],
          [
            "marketplace",
            books.marketplace,
            label("finance.book.marketplace", "Marketplace"),
          ],
        ] as const
      ).map(([key, lines, title]) => ({
        key,
        title,
        hint:
          key === "own"
            ? label(
                "finance.book.ownHint",
                "You are the seller: all of it is yours, and so is the stock it cost",
              )
            : label(
                "finance.book.marketplaceHint",
                "You are an agent: only your commission and fees are income",
              ),
        // This currency's figure or none: falling back to the book's first
        // currency once put dollar figures on the euro screen.
        net: lines.find((line) => line.currency === book.currency)?.net ?? 0,
      }))
    : null;

  // Product profit counts only sales with a recorded cost; what is left out is
  // said once, here, as one figure.
  const uncosted = productMargin
    ? productMargin.netSalesWithoutCost
    : (costGap?.amount ?? 0);
  const salesBase = productMargin
    ? productMargin.netSalesWithCost + productMargin.netSalesWithoutCost
    : (coverage?.sales ?? 0);
  const uncostedShare = salesBase > 0 ? uncosted / salesBase : 0;
  const showProductProfit = Boolean(productMargin) || uncosted > 0;
  const hasCostedSales = Boolean(
    productMargin && productMargin.netSalesWithCost !== 0,
  );

  return (
    <div className="space-y-5">
      {/*
        Balances that cannot be true, said out loud and at the top. The figure
        itself stays on its own row below, painted red; this box says what is
        wrong with it and where to go, so the number is not printed twice.
      */}
      {faults.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertTriangle
            aria-hidden="true"
            className="size-[18px] shrink-0 text-destructive"
          />
          <div className="min-w-0 flex-[1_1_22rem]">
            <p className="flex items-center gap-1 text-sm font-semibold text-destructive">
              {stockFaultOnly
                ? label(
                    "finance.overview.stockBelowZeroTitle",
                    "Stock on hand is below zero",
                  )
                : label(
                    "finance.overview.balanceReviewTitle",
                    "Balances need review",
                  )}
              {stockFaultOnly ? null : (
                <InfoTip
                  text={label(
                    "finance.overview.balanceReviewHint",
                    "Review the source records before recording a correction. Inventory balances can need opening stock, cost allocations or pending entries.",
                  )}
                />
              )}
            </p>
            {stockFaultOnly ? (
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {label(
                  "finance.overview.stockBelowZeroBody",
                  "The ledger has taken out more stock cost than it ever put in. Usually this is opening stock that hasn't been moved in yet.",
                )}
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-[13px] text-muted-foreground">
                {faults.map((fault) => (
                  <li key={`${fault.account}-${fault.currency}`}>
                    <span className="font-medium text-foreground">
                      {accountLabel(fault.account)}
                    </span>
                    {/* `ms-`, not `ml-`: a left margin does not flip in Arabic. */}
                    <span className="ms-1.5">{faultReason(fault)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {inventoryFault ? (
            <Button size="sm" variant="outline" className="bg-background" asChild>
              <Link href={inventoryHref}>
                {label(
                  "finance.overview.reviewInInventoryLedger",
                  "Review in Inventory and ledger",
                )}
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          ) : null}
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

      {/* The one figure the eye lands on, its split, and the volume beside it. */}
      <Card className="gap-0 py-0 shadow-xs">
        <CardContent className="flex flex-wrap gap-x-10 gap-y-6 p-6">
          <div className="min-w-0 flex-[1_1_26rem]">
            <p className="text-sm text-muted-foreground">
              {label("finance.overview.net", "Net")}
            </p>
            <p
              className={cn(
                "mt-1.5 text-4xl font-semibold tracking-tight tabular-nums",
                book.net < 0 && "text-destructive",
              )}
            >
              {money(book.net)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {label("finance.overview.netHint", "Income less costs")}
            </p>
            {split ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {split.map((part) => (
                  <div
                    key={part.key}
                    className="rounded-xl border bg-muted/30 px-3.5 py-3"
                  >
                    <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-2 rounded-full",
                          part.key === "own" ? "bg-primary" : "bg-primary/45",
                        )}
                      />
                      {part.title}
                      <InfoTip text={part.hint} />
                    </p>
                    <p
                      className={cn(
                        "mt-1 text-[17px] font-semibold tabular-nums",
                        part.net < 0 && "text-destructive",
                      )}
                    >
                      {money(part.net)}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex min-w-[13.75rem] flex-[0_1_18.75rem] flex-col justify-center lg:border-s lg:ps-8">
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              {label("finance.overview.gmv", "Order volume")}
              {/* The sub-label that keeps GMV from being read as revenue. */}
              <InfoTip
                text={
                  multiVendor
                    ? label(
                        "finance.overview.gmvHintMarketplace",
                        "Everything ordered through the store, vendors' sales included, without tax — counted when the order was placed",
                      )
                    : label(
                        "finance.overview.gmvHint",
                        "Everything ordered, before costs and without tax — counted when the order was placed",
                      )
                }
              />
            </p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
              {money(volume?.amount ?? 0)}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {labelWith("finance.overview.orders", "{count} orders", {
                count: String(volume?.orders ?? 0),
              })}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Where it came from, where it went — each total said once, at the top
          of its own list, with the proportions visible. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-0 py-0">
          <CardContent className="p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold">
                {label("finance.overview.income", "Income")}
              </h2>
              <p className="text-base font-semibold tabular-nums">
                {money(book.totalIncome)}
              </p>
            </div>
            {/*
              A set of books with costs and no income at all is almost never a
              bad month — it is a currency the store does not trade in. A
              gateway or a carrier charges in its own currency, and each fee
              rightly posts in the one it was charged in.
            */}
            {book.income.length === 0 ? (
              <p className="pt-4 text-sm text-muted-foreground">
                {book.expenses.length > 0
                  ? label(
                      "finance.overview.noIncome",
                      "Nothing was sold in this currency. Costs can still land in it — a gateway or a carrier charges in its own currency, and each is recorded as it was charged.",
                    )
                  : label(
                      "finance.overview.noIncomeYet",
                      "No income in this period.",
                    )}
              </p>
            ) : (
              <div className="mt-4 space-y-3.5">
                {book.income.map((line) => (
                  <div key={`${line.account}:${line.part ?? ""}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={cn(
                          "inline-flex min-w-0 items-center gap-1 text-sm",
                          line.amount < 0 && "text-muted-foreground",
                        )}
                      >
                        {lineLabel(line)}
                        {/* Not money handed back — the balance never arrived. */}
                        {line.part === CANCELLED_BALANCES_PART ? (
                          <InfoTip
                            text={label(
                              "finance.overview.cancelledBalancesHint",
                              "Never paid, so nothing was refunded",
                            )}
                          />
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
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <CardContent className="flex h-full flex-col p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold">
                {label("finance.overview.expenses", "Costs")}
              </h2>
              <p className="text-base font-semibold tabular-nums">
                {money(book.totalExpenses)}
              </p>
            </div>
            {book.expenses.length === 0 ? (
              <p className="pt-4 text-sm text-muted-foreground">
                {label(
                  "finance.overview.noCosts",
                  "No costs recorded in this period. Payment fees and shipping labels arrive on their own; rent and salaries have to be entered.",
                )}
              </p>
            ) : (
              <div className="mt-4 space-y-3.5">
                {book.expenses.map((line) => (
                  <div key={`${line.account}:${line.part ?? ""}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm">{lineLabel(line)}</span>
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
            )}
            {/* Payment fees and labels post themselves; rent and salaries are
                the costs somebody has to enter, so the way there sits here. */}
            <div className="mt-auto pt-5">
              <Link
                href="/admin/finance/expenses"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
              >
                <Plus className="size-3.5" />
                {label(
                  "finance.overview.recordCosts",
                  "Record rent, salaries or other costs",
                )}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {postingGap && (postingGap.pending > 0 || postingGap.conflicts > 0) ? (
        <WarningBanner
          title={label(
            "finance.overview.postingPendingTitle",
            "Bookkeeping needs completion",
          )}
        >
          <p>
            {label(
              "finance.overview.postingPendingBody",
              "Net and product profit currently include only verified posted entries. Recorded changes are still pending or need review; open Inventory and ledger for their status.",
            )}{" "}
            · {label("finance.overview.pendingCount", "Pending")}:{" "}
            {postingGap.pending} ·{" "}
            {label("finance.overview.conflictCount", "Needs review")}:{" "}
            {postingGap.conflicts}
          </p>
        </WarningBanner>
      ) : null}

      {showProductProfit ? (
        <Card className="gap-0 py-0">
          <CardContent className="p-6">
            <div className="flex items-center gap-1">
              <h2 className="text-base font-semibold">
                {label("finance.overview.productProfit", "Product profit")}
              </h2>
              <InfoTip
                text={label(
                  "finance.overview.productProfitBasis",
                  "Uses original order costs and recorded cost sources. Uncosted sales and their refunds are excluded from gross profit; inventory valuation adjustments are included separately in Net.",
                )}
              />
            </div>
            {hasCostedSales && productMargin ? (
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                <p
                  className={cn(
                    "text-[1.75rem] font-semibold leading-9 tracking-tight tabular-nums",
                    productMargin.grossProfit < 0 && "text-destructive",
                  )}
                >
                  {money(productMargin.grossProfit)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {labelWith(
                    "finance.overview.grossProfitLine",
                    "gross profit, a {margin} margin on {sales} of sales with a recorded cost",
                    {
                      margin: percent(
                        productMargin.grossProfit /
                          productMargin.netSalesWithCost,
                      ),
                      sales: money(productMargin.netSalesWithCost),
                    },
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {label(
                  "finance.overview.noCostedSales",
                  "No sales with a recorded cost in this period yet.",
                )}
              </p>
            )}
            {uncosted > 0 ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-xl border border-amber-200 bg-amber-50/60 py-2.5 pe-2.5 ps-3.5 dark:border-amber-900 dark:bg-amber-950/20">
                <p className="flex min-w-0 flex-[1_1_20rem] items-center gap-2.5 text-[13px] text-amber-900 dark:text-amber-300">
                  <AlertTriangle
                    aria-hidden="true"
                    className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
                  />
                  <span>
                    {labelWith(
                      "finance.overview.uncostedSales",
                      "{amount} of product sales ({share}) have no cost yet, so they're not in this profit.",
                      { amount: money(uncosted), share: percent(uncostedShare) },
                    )}
                  </span>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-background"
                  asChild
                >
                  <Link href={inventoryHref}>
                    {label("finance.overview.setCosts", "Set costs")}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            ) : null}
            {productMargin &&
            (productMargin.deferredQuantity > 0 ||
              productMargin.unattributedRefunds > 0) ? (
              <div className="mt-3 space-y-1 text-[13px] text-amber-700 dark:text-amber-400">
                {productMargin.deferredQuantity > 0 ? (
                  <p>
                    {label(
                      "finance.overview.deferredCostUnits",
                      "Sale units awaiting cost allocation",
                    )}
                    : {productMargin.deferredQuantity}
                  </p>
                ) : null}
                {productMargin.unattributedRefunds > 0 ? (
                  <p>
                    {label(
                      "finance.overview.unattributedRefunds",
                      "Refunds awaiting original-line attribution",
                    )}
                    : {money(productMargin.unattributedRefunds)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* What it holds, and what of it is not its own. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-0 py-0">
          <CardContent className="p-6 pb-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="flex items-center gap-1 text-base font-semibold">
                {label("finance.overview.holding", "Holding")}
                {bookFiltered ? (
                  <InfoTip
                    text={label(
                      "finance.overview.balancesNotFiltered",
                      "The gateway, bank, till and vendor balances are the whole business — one bank account, one gateway and one till sit behind both books.",
                    )}
                  />
                ) : null}
              </h2>
              <p className="text-[13px] text-muted-foreground">
                {/* A balance is read at the end of the period. For a picked
                    period that has already ended, that is not "now". */}
                {holdingAsOf
                  ? labelWith("finance.overview.holdingAsOf", "As of {date}", {
                      date: holdingAsOf,
                    })
                  : label(
                      "finance.overview.holdingHint",
                      "As things stand now",
                    )}
              </p>
            </div>
            <div className="mt-2">
              {visibleHoldings.map((row) => {
                const account = CASH_ANOMALY_ACCOUNTS[row.key];
                const impossible = account ? faultFor(account) : false;
                return (
                  <div
                    key={row.id}
                    className="flex items-center gap-3 border-t border-border/60 py-3"
                  >
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
                    <p
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-1 text-sm",
                        impossible && "text-destructive",
                      )}
                    >
                      {row.label}
                      {/* The alert above already says what is wrong with an
                          impossible balance; its usual hint would not. */}
                      {row.hint && !impossible ? (
                        <InfoTip text={row.hint} />
                      ) : null}
                    </p>
                    <span
                      className={cn(
                        "text-sm font-medium tabular-nums",
                        impossible && "font-semibold text-destructive",
                      )}
                    >
                      {money(row.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t pt-3 text-sm font-semibold">
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
          <Card className="gap-0 py-0">
            <CardContent className="p-6 pb-5">
              <h2 className="flex items-center gap-1 text-base font-semibold">
                {label("finance.overview.owed", "Owed")}
                <InfoTip
                  text={label(
                    "finance.overview.owedHint",
                    "What the store owes others, and what others still owe it",
                  )}
                />
              </h2>
              {youOwe.length > 0 ? (
                <OwedGroup
                  title={label("finance.overview.youOwe", "You owe")}
                  hint={label(
                    "finance.overview.youOweHint",
                    "Sitting in the accounts above, but not the store's to spend",
                  )}
                  rows={youOwe}
                  money={money}
                />
              ) : null}
              {owedToYou.length > 0 ? (
                <OwedGroup
                  title={label("finance.overview.owedToYou", "Owed to you")}
                  hint={label(
                    "finance.overview.owedToYouHint",
                    "Not received yet, so not in the accounts above",
                  )}
                  rows={owedToYou}
                  money={money}
                />
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

function OwedGroup({
  title,
  hint,
  rows,
  money,
}: {
  title: string;
  hint: string;
  rows: Array<{
    id: string;
    label: string;
    hint: string;
    amount: number;
    fault: boolean;
  }>;
  money: (value: number) => string;
}) {
  return (
    <>
      <p className="mt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        <InfoTip text={hint} />
      </p>
      <div className="mt-1">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-3 border-t border-border/60 py-2.5"
          >
            <p
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1 text-sm",
                row.fault && "text-destructive",
              )}
            >
              {row.label}
              {row.fault ? null : <InfoTip text={row.hint} />}
            </p>
            <span
              className={cn(
                "text-sm font-medium tabular-nums",
                row.fault && "font-semibold text-destructive",
              )}
            >
              {money(row.amount)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
