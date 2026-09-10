import { setRequestLocale } from "next-intl/server";
import { ReturnPolicyPageEditor } from "@/components/admin/online-store/return-policy-page-editor";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ReturnAndRefundPolicyEditorPage({
  params,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <ReturnPolicyPageEditor locale={locale} />;
}
