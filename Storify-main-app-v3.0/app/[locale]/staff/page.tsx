import { redirect } from "next/navigation";
import { localeHref } from "@/lib/i18n/locale-routing";

export default async function StaffRootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(await localeHref(locale, "/staff/dashboard"));
}

