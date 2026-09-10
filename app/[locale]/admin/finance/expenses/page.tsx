import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { ExpensesContent } from "@/components/admin/finance/expenses-content";
import { resolveRequestedPeriod } from "@/lib/finance/reports";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

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

  await connectDB();
  const settings = await getSettings();

  return (
    <ExpensesContent
      multiVendor={Boolean(settings.multiVendorMode?.enabled)}
      storeCurrency={settings.general?.defaultCurrency || "USD"}
      period={period.key}
      from={period.from.toISOString()}
      to={period.to.toISOString()}
    />
  );
}
