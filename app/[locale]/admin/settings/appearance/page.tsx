import { redirect } from "next/navigation";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Settings → Branding opens the store's one Branding page, Online Store →
 * Themes → Branding (logos, brand colours, the default light/dark). The
 * dashboard look toggles this page used to hold — contrast, right-to-left,
 * collapsed sidebar, sidebar colour — are each person's own now, in the
 * Preferences drawer of every dashboard.
 */
export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  redirect(await localeHref(locale, "/admin/online-store/theme?tab=branding"));
}
