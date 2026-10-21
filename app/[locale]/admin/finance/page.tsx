import { getInventoryPostingCoverage } from "@/lib/finance/inventory-posting-evidence";
import { getProductProfit } from "@/lib/finance/product-profit";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { InventoryPosition } from "@/models/inventory-position.model";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import {
  FinanceCurrencySwitch,
  FinanceOverview,
  listOverviewCurrencies,
  pickOverviewCurrency,
} from "@/components/admin/finance/finance-overview";
import { FinanceBookFilter } from "@/components/admin/finance/finance-book-filter";
import { DashboardPeriodPicker } from "@/components/admin/dashboard-period-picker";
import { Skeleton } from "@/components/ui/skeleton";
import {
  findLedgerAnomalies,
  getCashPosition,
  getCostCoverage,
  getLedgerCurrencies,
  getGrossMerchandiseValue,
  getProfitAndLoss,
} from "@/lib/finance/reports";
import {
  dashboardPickerBounds,
  resolveFinanceDashboardPeriod,
} from "@/lib/finance/dashboard-finance-period";
import { formatBalancesAsOf } from "@/lib/finance/period-label";
import { AdjustmentDialog } from "@/components/admin/finance/adjustment-dialog";
import { LEDGER_BOOK } from "@/lib/finance/accounts";
import { getDefaultVendorIds } from "@/lib/finance/post-events";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Finance overview.
 *
 * Server-rendered from the ledger, the way the admin dashboard reads its own
 * sections: the aggregation is the page, so there is no client fetch, no
 * loading spinner over the numbers, and no API surface to keep in step with the
 * report code.
 *
 * `book` is only offered on a marketplace. A single-vendor store has one book,
 * so filtering by it would be a control with one meaningful position.
 */
export default async function AdminFinancePage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  const search = await searchParams;
  const read = (key: string) =>
    typeof search[key] === "string" ? (search[key] as string) : undefined;
  const bookParam = read("book") || "";

  await connectDB();
  const settings = await getSettings();
  const multiVendor = Boolean(settings.multiVendorMode?.enabled);
  // The dashboard's period (`?period=today|yesterday|week|month|all` or
  // `?from=&to=`), so the picker is the dashboard's too. Opens on the month,
  // the nearest of those to the 30 days it used to open on.
  const period = resolveFinanceDashboardPeriod({
    period: read("period"),
    from: read("from"),
    to: read("to"),
  });
  const pickerBounds = dashboardPickerBounds(period);
  // Cheap (`distinct` over an indexed field) and needed in the header, above
  // the Suspense boundary the balances load behind.
  const [ledgerCurrencies, synchronizedCurrencies] = await Promise.all([
    getLedgerCurrencies(),
    InventoryPosition.distinct("currency"),
  ]);
  const book =
    multiVendor &&
    (bookParam === LEDGER_BOOK.OWN || bookParam === LEDGER_BOOK.MARKETPLACE)
      ? bookParam
      : undefined;

  const t = await getTranslations({ locale });
  const label = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;

  /** The same URL with one currency swapped in — every other filter kept. */
  const buildCurrencyHref = (currency: string) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === "string" && key !== "currency")
        params.set(key, value);
    }
    params.set("currency", currency);
    return `?${params.toString()}`;
  };

  // Started once and awaited twice: the currency switch in the filter row and
  // the sections below read the same figures, so neither repeats the queries.
  const data = loadOverview({
    period,
    book,
    multiVendor,
    storeCurrency: settings.general?.defaultCurrency || "USD",
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {label("finance.overview.title", "Finance")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {label(
              "finance.overview.pageSubtitle",
              "Income, costs and balances for the period you pick.",
            )}
          </p>
        </div>
        {/* In the header rather than buried in a menu: the entry it posts is
            the only way to answer a warning the balances below may raise. */}
        <AdjustmentDialog
          storeCurrency={settings.general?.defaultCurrency || "USD"}
          multiVendor={multiVendor}
          currencies={ledgerCurrencies}
          synchronizedCurrencies={synchronizedCurrencies}
        />
      </div>

      {/* Book, period and currency in one row: the three things that decide
          which figures the page is showing. */}
      <div className="flex flex-wrap items-center gap-2">
        {multiVendor ? <FinanceBookFilter book={book ?? "all"} /> : null}
        <DashboardPeriodPicker
          period={period.key}
          from={pickerBounds.from}
          to={pickerBounds.to}
          defaultPeriod="month"
        />
        <Suspense fallback={null}>
          <OverviewCurrency
            data={data}
            locale={locale}
            activeCurrency={read("currency")}
            buildCurrencyHref={buildCurrencyHref}
          />
        </Suspense>
      </div>

      <Suspense
        fallback={
          <div
            role="status"
            aria-label={label("common.loading", "Loading…")}
            className="space-y-4"
          >
            <Skeleton className="h-48 rounded-xl" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-64 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
          </div>
        }
      >
        <OverviewSections
          data={data}
          locale={locale}
          bookFiltered={Boolean(book)}
          multiVendor={multiVendor}
          activeCurrency={read("currency")}
          buildCurrencyHref={buildCurrencyHref}
          // Balances are read at the period's end. A picked period that has
          // already ended is not "now", so the card names its last day.
          holdingAsOf={formatBalancesAsOf(period, locale)}
        />
      </Suspense>
    </div>
  );
}

type OverviewData = Awaited<ReturnType<typeof loadOverview>>;

/** Every figure the overview reads, fetched in one go. */
async function loadOverview({
  period,
  book,
  multiVendor,
  storeCurrency,
}: {
  period: { from: Date; to: Date };
  book?: "own" | "marketplace";
  multiVendor: boolean;
  /** What the ledger counts a currency-less order as; GMV has to agree. */
  storeCurrency: string;
}) {
  // The split is only fetched when a marketplace is looking at both books —
  // two extra aggregations that would answer nothing on a single-vendor store.
  const wantsSplit = multiVendor && !book;
  const [
    profitAndLoss,
    cash,
    gmv,
    own,
    marketplace,
    costCoverage,
    productProfit,
    postingCoverage,
  ] = await Promise.all([
    getProfitAndLoss(period, book),
    // No book: one bank account, one till. See `getCashPosition`.
    getCashPosition(period.to),
    // The book split needs to know which vendors ARE the store; only fetched
    // when a book is actually selected.
    book
      ? getDefaultVendorIds().then((ids) =>
          getGrossMerchandiseValue(period, storeCurrency, book, ids),
        )
      : getGrossMerchandiseValue(period, storeCurrency),
    wantsSplit
      ? getProfitAndLoss(period, LEDGER_BOOK.OWN)
      : Promise.resolve([]),
    wantsSplit
      ? getProfitAndLoss(period, LEDGER_BOOK.MARKETPLACE)
      : Promise.resolve([]),
    // How much of the store's own sales has no cost behind it — the part of
    // the net that is not profit. See `getCostCoverage`.
    getCostCoverage(period, book),
    book === LEDGER_BOOK.MARKETPLACE
      ? Promise.resolve([])
      : getProductProfit(period),
    book === LEDGER_BOOK.MARKETPLACE
      ? Promise.resolve([])
      : getInventoryPostingCoverage(period.to),
  ]);
  return {
    profitAndLoss,
    cash,
    gmv,
    // Read off the position that is already loaded, so a balance that cannot
    // be true costs no extra query to notice.
    anomalies: findLedgerAnomalies(cash),
    books: wantsSplit ? { own, marketplace } : null,
    costCoverage,
    productProfit,
    postingCoverage,
  };
}

async function OverviewCurrency({
  data,
  locale,
  activeCurrency,
  buildCurrencyHref,
}: {
  data: Promise<OverviewData>;
  locale: string;
  activeCurrency?: string;
  buildCurrencyHref: (currency: string) => string;
}) {
  const figures = await data;
  const currencies = listOverviewCurrencies(figures);
  if (currencies.length < 2) return null;
  return (
    <FinanceCurrencySwitch
      locale={locale}
      currencies={currencies}
      selected={pickOverviewCurrency(currencies, activeCurrency)}
      buildCurrencyHref={buildCurrencyHref}
    />
  );
}

async function OverviewSections({
  data,
  locale,
  bookFiltered,
  multiVendor,
  activeCurrency,
  buildCurrencyHref,
  holdingAsOf,
}: {
  data: Promise<OverviewData>;
  locale: string;
  bookFiltered: boolean;
  multiVendor: boolean;
  activeCurrency?: string;
  buildCurrencyHref: (currency: string) => string;
  holdingAsOf: string | null;
}) {
  const figures = await data;
  return (
    <FinanceOverview
      locale={locale}
      {...figures}
      multiVendor={multiVendor}
      activeCurrency={activeCurrency}
      buildCurrencyHref={buildCurrencyHref}
      bookFiltered={bookFiltered}
      holdingAsOf={holdingAsOf}
    />
  );
}
