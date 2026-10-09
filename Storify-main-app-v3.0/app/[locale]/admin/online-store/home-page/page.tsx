import { redirect } from "next/navigation";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * The pre-Customize builder URL. Kept as a redirect: bookmarks, docs, and
 * the admin search index all pointed here for a release.
 */
export default async function OnlineStoreHomePage({ params }: PageProps) {
  const { locale } = await params;
  redirect(await localeHref(locale, "/admin/online-store/customize"));
}
