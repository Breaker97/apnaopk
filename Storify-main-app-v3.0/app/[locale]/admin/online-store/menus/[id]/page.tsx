import { redirect } from "next/navigation";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function MenuDetailRedirectPage({ params }: PageProps) {
  const { locale, id } = await params;
  redirect(await localeHref(locale, `/admin/online-store/menus/${encodeURIComponent(id)}/edit`));
}
