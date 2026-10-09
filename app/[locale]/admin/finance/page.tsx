import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { FinanceOverview } from "@/components/admin/finance/finance-overview";
import { FinanceBookFilter } from "@/components/admin/finance/finance-book-filter";
import { DashboardPeriodPicker } from "@/components/admin/dashboard-period-picker";
import { Card, CardContent } from "@/components/ui/card";
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
  financePeriodLabel,
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
  const ledgerCurrencies = await getLedgerCurrencies();
  const book =
    multiVendor && (bookParam === LEDGER_BOOK.OWN || bookParam === LEDGER_BOOK.MARKETPLACE)
      ? bookParam
      : undefined;

  const t = await getTranslations({ locale });
  const label = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;

  const periodLabel = financePeriodLabel(period, locale, label);

  /** The same URL with one currency swapped in — every other filter kept. */
  const buildCurrencyHref = (currency: string) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === "string" && key !== "currency") params.set(key, value);
    }
    params.set("currency", currency);
    return `?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {label("finance.overview.title", "Finance")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {label(
              "finance.overview.subtitle",
              "What the business earned, what it spent, and what it is holding. Sales count when the money arrives — a deposit pre-order in full when its deposit does, with the rest shown as owed by customers.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Beside the period picker rather than buried in a menu: the entry
              it posts is the only way to answer the warning the balances below
              may be raising, so it has to be reachable from the same screen. */}
          <AdjustmentDialog
            storeCurrency={settings.general?.defaultCurrency || "USD"}
            multiVendor={multiVendor}
            currencies={ledgerCurrencies}
          />
          {multiVendor ? <FinanceBookFilter book={book ?? "all"} /> : null}
          <DashboardPeriodPicker
            period={period.key}
            from={pickerBounds.from}
            to={pickerBounds.to}
            defaultPeriod="month"
          />
        </div>
      </div>

      <Suspense
        fallback={
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              {label("common.loading", "Loading…")}
            </CardContent>
          </Card>
        }
      >
        <OverviewSections
          locale={locale}
          period={period}
          book={book}
          multiVendor={multiVendor}
          storeCurrency={settings.general?.defaultCurrency || "USD"}
          periodLabel={periodLabel}
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

async function OverviewSections({
  locale,
  period,
  book,
  multiVendor,
  periodLabel,
  activeCurrency,
  buildCurrencyHref,
  storeCurrency,
  holdingAsOf,
}: {
  locale: string;
  period: { from: Date; to: Date };
  book?: "own" | "marketplace";
  multiVendor: boolean;
  periodLabel: string;
  activeCurrency?: string;
  buildCurrencyHref: (currency: string) => string;
  /** What the ledger counts a currency-less order as; GMV has to agree. */
  storeCurrency: string;
  holdingAsOf: string | null;
}) {
  // The split is only fetched when a marketplace is looking at both books —
  // two extra aggregations that would answer nothing on a single-vendor store.
  const wantsSplit = multiVendor && !book;
  const [profitAndLoss, cash, gmv, own, marketplace, costCoverage] = await Promise.all([
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
    wantsSplit ? getProfitAndLoss(period, LEDGER_BOOK.OWN) : Promise.resolve([]),
    wantsSplit
      ? getProfitAndLoss(period, LEDGER_BOOK.MARKETPLACE)
      : Promise.resolve([]),
    // How much of the store's own sales has no cost behind it — the part of
    // the net that is not profit. See `getCostCoverage`.
    getCostCoverage(period, book),
  ]);

  return (
    <FinanceOverview
      locale={locale}
      profitAndLoss={profitAndLoss}
      cash={cash}
      // Read off the position that is already loaded, so a balance that cannot
      // be true costs no extra query to notice.
      anomalies={findLedgerAnomalies(cash)}
      gmv={gmv}
      periodLabel={periodLabel}
      multiVendor={multiVendor}
      activeCurrency={activeCurrency}
      buildCurrencyHref={buildCurrencyHref}
      bookFiltered={Boolean(book)}
      books={wantsSplit ? { own, marketplace } : null}
      costCoverage={costCoverage}
      holdingAsOf={holdingAsOf}
    />
  );
}
