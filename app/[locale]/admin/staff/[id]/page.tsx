import { setRequestLocale } from "next-intl/server";
import { StaffDetailShell } from "@/components/admin/staff/staff-detail-shell";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditStaffPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <StaffDetailShell locale={locale} staffId={id} />;
}
