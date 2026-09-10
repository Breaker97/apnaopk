import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { PaymentsOverviewContent } from "@/components/admin/payments/payments-overview-content";
import { resolveRequestedPeriod } from "@/lib/finance/reports";
import { formatPeriodRange } from "@/lib/finance/period-label";

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
  // triggers agree about which days they mean before the first render.
  const search = await searchParams;
  const read = (key: string) =>
    typeof search[key] === "string" ? (search[key] as string) : undefined;
  const period = resolveRequestedPeriod({
    period: read("period") || "30d",
    from: read("from"),
    to: read("to"),
  });

  const t = await getTranslations({ locale });
  const periodLabel =
    period.key === "custom"
      ? formatPeriodRange(period, locale)
      : t.has(`finance.period.${period.key}`)
        ? t(`finance.period.${period.key}`)
        : period.key === "all"
          ? "All time"
          : `Last ${period.key}`;

  return (
    <PaymentsOverviewContent
      locale={locale}
      period={period.key}
      periodLabel={periodLabel}
      from={period.from.toISOString()}
      to={period.to.toISOString()}
    />
  );
}
