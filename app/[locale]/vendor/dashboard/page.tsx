import { setRequestLocale } from "next-intl/server";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { VendorDashboardContent } from "@/components/vendor/dashboard-content";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function VendorDashboardPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const access = await requireVendorAreaAccess({ locale });

  return (
    <VendorDashboardContent setupMode={access.accessMode === "setup"} />
  );
}
