import { setRequestLocale } from "next-intl/server";
import { VendorExpenses } from "@/components/vendor/finance/vendor-expenses";
import { guardVendorFinance } from "@/lib/finance/vendor-page-data";
import {
  resolveDashboardPeriod,
  toDayString,
  type DashboardPeriodSearch,
} from "@/lib/admin/dashboard-period";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<DashboardPeriodSearch>;
}

/**
 * A vendor's own costs, on their own screen.
 *
 * They deliberately do not appear on the statement: nothing here changes what
 * the marketplace owes, and mixing them into the balance would suggest it does.
 *
 * The period is the dashboard's (`?period=` or `?from=&to=`), and opens on the
 * month like the admin's expenses screen.
 */
export default async function VendorExpensesPage({
  params,
  searchParams,
}: PageProps) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { storeCurrency } = await guardVendorFinance(locale);
  const period = resolveDashboardPeriod(search, new Date(), "month");

  return (
    <VendorExpenses
      storeCurrency={storeCurrency}
      period={period.key}
      from={period.range ? toDayString(period.range.from) : ""}
      to={period.range ? toDayString(period.range.to) : ""}
    />
  );
}
