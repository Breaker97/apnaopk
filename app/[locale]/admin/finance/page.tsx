import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { FinanceOverview } from "@/components/admin/finance/finance-overview";
import { FinancePeriodPicker } from "@/components/admin/finance/finance-period-picker";
import { Card, CardContent } from "@/components/ui/card";
import {
  findLedgerAnomalies,
  getCashPosition,
  getLedgerCurrencies,
  getGrossMerchandiseValue,
  getProfitAndLoss,
  resolveRequestedPeriod,
} from "@/lib/finance/reports";
import { formatPeriodRange } from "@/lib/finance/period-label";
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
  const period = resolveRequestedPeriod({
    period: read("period") || "30d",
    from: read("from"),
    to: read("to"),
  });
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

  // A named period says its name; a picked one has to spell out its dates,
  // because "custom" tells a reader nothing about which days they are seeing.
  const periodLabel =
    period.key === "custom"
      ? formatPeriodRange(period, locale)
      : label(
          `finance.period.${period.key}`,
          period.key === "all" ? "All time" : `Last ${period.key}`,
        );

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
              "What the business earned, what it spent, and what it is holding.",
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
          <FinancePeriodPicker
            period={period.key}
          from={period.from.toISOString()}
          to={period.to.toISOString()}
            book={book ?? "all"}
            showBookFilter={multiVendor}
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
}) {
  // The split is only fetched when a marketplace is looking at both books —
  // two extra aggregations that would answer nothing on a single-vendor store.
  const wantsSplit = multiVendor && !book;
  const [profitAndLoss, cash, gmv, own, marketplace] = await Promise.all([
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
    />
  );
}
