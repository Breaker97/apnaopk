import { setRequestLocale } from "next-intl/server";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { VendorDashboardContent } from "@/components/vendor/dashboard-content";
import {
  resolveDashboardPeriod,
  toDayString,
  type DashboardPeriodSearch,
} from "@/lib/admin/dashboard-period";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<DashboardPeriodSearch>;
}

export default async function VendorDashboardPage({
  params,
  searchParams,
}: PageProps) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const access = await requireVendorAreaAccess({ locale });

  // The admin dashboard's period, resolved the same way, so `?period=week` or
  // `?from=&to=` means one thing on both. The picker holds it in the URL.
  const period = resolveDashboardPeriod(search);

  return (
    <VendorDashboardContent
      setupMode={access.accessMode === "setup"}
      period={{
        key: period.key,
        from: period.range ? toDayString(period.range.from) : "",
        to: period.range ? toDayString(period.range.to) : "",
      }}
    />
  );
}
