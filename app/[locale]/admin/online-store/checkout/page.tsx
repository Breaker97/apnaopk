import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { buildPageSwitcher } from "@/lib/storefront/pages/page-switcher";
import { CheckoutBuilder } from "@/components/admin/online-store/checkout-builder";
import { getSettings } from "@/models/settings.model";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function OnlineStoreCheckoutPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  // The same switcher the section builder shows — see `buildPageSwitcher`.
  const settings = await getSettings();
  const switcher = await buildPageSwitcher(
    locale,
    "nav:/admin/online-store/checkout",
    settings.general?.defaultLanguage || "en",
  );

  return <CheckoutBuilder locale={locale} switcher={switcher} />;
}
