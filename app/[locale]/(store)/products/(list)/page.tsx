import type { Metadata } from "next";
import { type Locale } from "@/config/i18n.config";
import {
  listingCategoryTrail,
  resolveListingCategory,
} from "@/lib/storefront/listing-category";
import { resolveRequestLocation } from "@/lib/locations/resolve-request-location";
import { ProductsBreadcrumb } from "@/components/store/sections/listing/products-breadcrumb";
import { StoreSections } from "@/components/store/store-sections";
import { setRequestLocale } from "next-intl/server";
import {
  listingBreadcrumbAlignClass,
  listingBreadcrumbInCover,
  readProductsListingLayout,
} from "@/lib/storefront/sections/products-listing-layout";
import { getTemplateSections } from "@/lib/storefront/pages/get-template";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { SearchAnalytics } from "@/components/analytics/search-analytics";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Opened on one category, the tab and the share card name the category;
 * otherwise the store's own metadata stands, as it always has.
 */
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const context = await resolveListingCategory(await searchParams);
  if (!context) return {};
  const { category } = context;
  const title = category.seo?.pageTitle || category.name;
  const description = category.seo?.metaDescription || category.description;
  return {
    title,
    ...(description ? { description } : {}),
    openGraph: {
      title,
      ...(description ? { description } : {}),
      ...(category.image ? { images: [{ url: category.image, alt: category.name }] } : {}),
    },
  };
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
  const [template, storefront] = await Promise.all([
    getTemplateSections("products"),
    getStorefrontSettings(),
  ]);

  const searchQuery =
    typeof search.search === "string" ? search.search : undefined;
  // The category the listing is opened on, if one: the trail comes from it.
  const listingCategory = await resolveListingCategory(search);
  const trail = listingCategory
    ? listingCategoryTrail(listingCategory, { searchQuery })
    : [];

  const ctx: SectionRenderContext = {
    locale: locale as Locale,
    defaultLanguage: storefront.defaultLanguage,
    isMultiVendorEnabled: storefront.isMultiVendorEnabled,
    themeId: storefront.theme.id,
    themeSettings: storefront.theme.settings,
    templateType: "products",
    resource: { type: "products", searchParams: search, location },
  };

  // A listing cover can carry the breadcrumb; then the cover draws it and
  // the page must not draw a second one above.
  const listing = template.sections.find(
    (section) => section.type === "products-main",
  );
  const listingLayout = listing
    ? readProductsListingLayout(listing.settings)
    : null;
  const breadcrumbInCover = listingLayout
    ? listingBreadcrumbInCover(listingLayout)
    : false;
  // The trail the page draws follows the same alignment as the one a cover
  // would: the setting describes the breadcrumb, not where it happens to sit.
  const crumbAlign = listingLayout
    ? listingBreadcrumbAlignClass(listingLayout, "left")
    : "";

  return (
    <div className={breadcrumbInCover ? "pb-8 pt-6" : "pb-8"}>
      <SearchAnalytics query={searchQuery} />
      {breadcrumbInCover ? null : (
        <div className="container mx-auto px-4 pt-8">
          <ProductsBreadcrumb
            className={`mb-4 ${crumbAlign}`}
            locale={locale}
            searchQuery={searchQuery}
            trail={trail}
          />
        </div>
      )}

      <StoreSections sections={template.sections} ctx={ctx} />
    </div>
  );
}
