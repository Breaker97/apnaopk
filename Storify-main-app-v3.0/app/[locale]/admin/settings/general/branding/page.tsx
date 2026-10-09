import { redirect } from "next/navigation";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Brand assets used to be edited here (and, a second time, on Settings →
 * Appearance). Both now live on Online Store → Themes → Branding, next to
 * the theme they dress. The route stays so bookmarks and old links land on
 * the new home instead of a 404.
 */
export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  redirect(await localeHref(locale, "/admin/online-store/theme?tab=branding"));
}
