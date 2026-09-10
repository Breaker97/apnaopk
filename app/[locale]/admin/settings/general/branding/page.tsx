import { redirect } from "next/navigation";

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
  redirect(`/${locale}/admin/online-store/theme?tab=branding`);
}
