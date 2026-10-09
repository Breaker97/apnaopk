import { redirect } from "next/navigation";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Online Store opens on its first screen, the landing-page editor. */
export default async function VendorOnlineStorePage({ params }: PageProps) {
  const { locale } = await params;
  redirect(await localeHref(locale, "/vendor/online-store/customize"));
}
