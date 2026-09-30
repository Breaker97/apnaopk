import { redirect } from "next/navigation";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminSettingsIndex({ params }: PageProps) {
  const { locale } = await params;
  redirect(await localeHref(locale, "/admin/settings/general"));
}
