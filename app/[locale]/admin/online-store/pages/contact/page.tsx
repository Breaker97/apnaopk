import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { ContactPageEditor } from "@/components/admin/online-store/contact-page-editor";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ContactEditorPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <ContactPageEditor locale={locale} />;
}
