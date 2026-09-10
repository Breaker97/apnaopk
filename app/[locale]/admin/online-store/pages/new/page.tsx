import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { CreateCustomPageForm } from "@/components/admin/online-store/create-custom-page-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewCustomPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <CreateCustomPageForm locale={locale} />;
}
