import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { PaymentsOverviewContent } from "@/components/admin/payments/payments-overview-content";
import {
  dashboardPickerBounds,
  financePeriodLabel,
  resolveFinanceDashboardPeriod,
} from "@/lib/finance/dashboard-finance-period";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminPaymentsOverviewPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  // Resolved here rather than in the client, so the picker and the request it
  // triggers agree about which days they mean before the first render. It is the
  // dashboard's period (`?period=today|yesterday|week|month|all` or
  // `?from=&to=`), and the screen opens on the month, the nearest of those to
  // the 30 days it used to open on.
  const search = await searchParams;
  const read = (key: string) =>
    typeof search[key] === "string" ? (search[key] as string) : undefined;
  const period = resolveFinanceDashboardPeriod({
    period: read("period"),
    from: read("from"),
    to: read("to"),
  });

  const t = await getTranslations({ locale });
  const periodLabel = financePeriodLabel(period, locale, (key, fallback) =>
    t.has(key) ? t(key) : fallback,
  );
  const pickerBounds = dashboardPickerBounds(period);

  return (
    <PaymentsOverviewContent
      locale={locale}
      period={period.key}
      periodLabel={periodLabel}
      from={pickerBounds.from}
      to={pickerBounds.to}
    />
  );
}
