import { setRequestLocale } from "next-intl/server";
import { VendorPlanForm } from "@/components/admin/vendor-plan-form";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditVendorPlanPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <VendorPlanForm locale={locale} planId={id} />;
}
