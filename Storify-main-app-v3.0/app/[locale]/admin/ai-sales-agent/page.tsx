import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { AISalesAgentAdmin } from "@/components/admin/ai-sales-agent-admin";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminAISalesAgentPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return <AISalesAgentAdmin locale={locale} />;
}
