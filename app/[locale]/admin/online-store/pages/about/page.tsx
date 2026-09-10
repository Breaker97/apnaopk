import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { AboutPageEditor } from "@/components/admin/online-store/about-page-editor";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AboutEditorPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <AboutPageEditor locale={locale} />;
}
