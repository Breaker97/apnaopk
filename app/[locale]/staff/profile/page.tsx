import { setRequestLocale } from "next-intl/server";
import { AdminProfileContent } from "@/components/admin/admin-profile-content";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function StaffProfilePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireStaffAreaAccess({ locale });

  return <AdminProfileContent />;
}

