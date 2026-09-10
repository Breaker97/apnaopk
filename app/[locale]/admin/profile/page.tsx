import { setRequestLocale } from "next-intl/server";
import { AdminProfileContent } from "@/components/admin/admin-profile-content";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminProfilePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <AdminProfileContent allowEmailEdit />;
}
