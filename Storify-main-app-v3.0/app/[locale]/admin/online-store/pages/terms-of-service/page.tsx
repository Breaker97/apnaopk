import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { ContentPageEditor } from "@/components/admin/online-store/content-page-editor";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function TermsOfServiceEditorPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <ContentPageEditor locale={locale} pageKey="terms" />;
}
