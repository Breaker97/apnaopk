import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { FaqPageEditor } from "@/components/admin/online-store/faq-page-editor";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function FaqEditorPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <FaqPageEditor locale={locale} />;
}
