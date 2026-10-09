import { redirect } from "next/navigation";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Channel configuration moved into Admin → Settings → Omnichannel Messaging,
 * where every other integration (payments, email, analytics) is configured.
 *
 * This route stays as a redirect rather than being deleted: it is linked from
 * the inbox and from the docs, and two pages rendering the same panels is how
 * configuration surfaces drift apart.
 */
export default async function AdminMessagingChannelsPage({ params }: PageProps) {
  const { locale } = await params;
  redirect(await localeHref(locale, "/admin/settings/messaging"));
}
