import { setRequestLocale } from "next-intl/server";
import { StaffForm } from "@/components/admin/staff-form";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewStaffPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <StaffForm locale={locale} />;
}
