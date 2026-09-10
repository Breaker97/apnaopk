import { type Locale } from "@/config/i18n.config";
import { resolveRequestLocation } from "@/lib/locations/resolve-request-location";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { StoreSections } from "@/components/store/store-sections";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getTemplateSections } from "@/lib/storefront/pages/get-template";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { SearchAnalytics } from "@/components/analytics/search-analytics";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * The products TEMPLATE: `products-main` (title, facets, infinite grid) by
 * default, with content sections an admin arranges around it. The page
 * keeps its chrome — analytics and the breadcrumb, which is the one thing
 * a shopper landing from search has no other way to learn — and resolves
 * the request-scoped inputs (searchParams, coarse location) once into the
 * render context.
 */
export default async function ProductsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const location = resolveRequestLocation(search);
  const [t, template, storefront] = await Promise.all([
    getTranslations({ locale }),
    getTemplateSections("products"),
    getStorefrontSettings(),
  ]);

  const searchQuery =
    typeof search.search === "string" ? search.search : undefined;

  const ctx: SectionRenderContext = {
    locale: locale as Locale,
    defaultLanguage: storefront.defaultLanguage,
    isMultiVendorEnabled: storefront.isMultiVendorEnabled,
    themeId: storefront.theme.id,
    themeSettings: storefront.theme.settings,
    templateType: "products",
    resource: { type: "products", searchParams: search, location },
  };

  return (
    <div className="pb-8">
      <div className="container mx-auto px-4 pt-8">
        <SearchAnalytics query={searchQuery} />
        {/* A search narrows this listing rather than leaving it, so
            "Products" becomes the link back to the unfiltered grid and the
            query takes the current-page slot. */}
        <StoreBreadcrumb
          className="mb-4"
          locale={locale}
          items={
            searchQuery
              ? [
                  { label: t("nav.products"), href: "/products" },
                  { label: `${t("common.search")}: "${searchQuery}"` },
                ]
              : [{ label: t("nav.products") }]
          }
        />
      </div>

      <StoreSections sections={template.sections} ctx={ctx} />
    </div>
  );
}
