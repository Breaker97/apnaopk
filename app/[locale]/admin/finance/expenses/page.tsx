import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { FiscalPeriod } from "@/models/fiscal-period.model";
import { Product } from "@/models/product.model";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { ExpensesContent } from "@/components/admin/finance/expenses-content";
import { resolveRequestedPeriod } from "@/lib/finance/reports";
import { CURRENCIES } from "@/lib/intl/currencies";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const PAID_FROM_FILTERS = new Set(["bank", "cash", "gateway", "unpaid"]);

/**
 * Expenses — the only financial screen where the store tells the app something
 * rather than the other way round.
 *
 * `multiVendor` decides whether a cost can be filed against the marketplace
 * book at all. On a single-vendor install there is only one book, so the choice
 * is not shown and everything lands in the own store's accounts.
 *
 * The period is resolved here, above the client that lists against it: the
 * screen had none at all, so "total for this filter" quietly meant every
 * expense the store had ever recorded, under a list that looked like a month.
 *
 * Also resolved here, because the form has to say them before anything is
 * saved: the last closed day (a cost dated before it is booked after it), and
 * whether any product carries a cost price (without one, stock bought never
 * reaches the profit and loss at all).
 */
export default async function AdminExpensesPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  const search = await searchParams;
  const read = (key: string) =>
    typeof search[key] === "string" ? (search[key] as string) : undefined;
  const period = resolveRequestedPeriod({
    period: read("period") || "30d",
    from: read("from"),
    to: read("to"),
  });
  const paidFrom = read("paidFrom");

  await connectDB();
  const [settings, lastClose, costed] = await Promise.all([
    getSettings(),
    FiscalPeriod.findOne()
      .sort({ to: -1 })
      .select("to")
      .lean<{ to?: Date } | null>(),
    Product.exists({
      $or: [{ cost: { $gt: 0 } }, { "variants.cost": { $gt: 0 } }],
    }),
  ]);

  const storeCurrency = (settings.general?.defaultCurrency || "USD").toUpperCase();
  // The store's own currency first, then every other one a bill might be paid
  // in — hosting in dollars on a store that sells in taka.
  const currencies = [
    ...new Set([storeCurrency, ...CURRENCIES.map((currency) => currency.code)]),
  ];

  return (
    <ExpensesContent
      multiVendor={Boolean(settings.multiVendorMode?.enabled)}
      storeCurrency={storeCurrency}
      currencies={currencies}
      period={period.key}
      from={period.from.toISOString()}
      to={period.to.toISOString()}
      closedThrough={lastClose?.to ? lastClose.to.toISOString() : null}
      hasProductCosts={Boolean(costed)}
      initialPaidFrom={
        paidFrom && PAID_FROM_FILTERS.has(paidFrom) ? paidFrom : "all"
      }
    />
  );
}
