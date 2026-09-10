import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { StoreSections } from "@/components/store/store-sections";
import { getTemplateSections } from "@/lib/storefront/pages/get-template";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * The cart TEMPLATE: `cart-main` (the client shopping-bag experience) by
 * default, with merchandising sections an admin arranges around it —
 * trust badges, coupon banners, recommendations. The bag itself lives in
 * the client cart store, so this page resolves no resource and stays
 * cache-friendly like the home page.
 */
export default async function CartPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [template, storefront] = await Promise.all([
    getTemplateSections("cart"),
    getStorefrontSettings(),
  ]);

  const ctx: SectionRenderContext = {
    locale: locale as Locale,
    defaultLanguage: storefront.defaultLanguage,
    isMultiVendorEnabled: storefront.isMultiVendorEnabled,
    themeId: storefront.theme.id,
    themeSettings: storefront.theme.settings,
    templateType: "cart",
    resource: { type: "cart" },
  };

  return <StoreSections sections={template.sections} ctx={ctx} />;
}
