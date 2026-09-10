import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { StoreSections } from "@/components/store/store-sections";
import { getStorefrontCollectionDetail } from "@/lib/storefront/storefront-collections";
import { getTemplateSections } from "@/lib/storefront/pages/get-template";
import type {
  CollectionTemplateResource,
  SectionRenderContext,
} from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import type { CollectionSortOrder } from "@/types";
import { resolveRequestLocation } from "@/lib/locations/resolve-request-location";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * The collection TEMPLATE: collection-header (banner, description, sort —
 * deletable) + collection-main (grid and pagination, the locked core) by
 * default, with story blocks, offers, and testimonials an admin arranges
 * around them. The page resolves the ONE collection-detail fetch and every
 * section reads it through the resource.
 *
 * The shopper's location is deliberately not passed to the query: it is a
 * lens on the storefront, not a filter, so it does not change which
 * products a collection holds. It still travels in the sort/page links,
 * because the header pill and every other page do read it.
 */
export default async function CollectionDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { locale, slug } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const page = typeof search.page === "string" ? parseInt(search.page) : 1;
  const sort = typeof search.sort === "string" ? search.sort : undefined;

  const location = resolveRequestLocation(search);
  const [t, data, template, storefront] = await Promise.all([
    getTranslations({ locale }),
    getStorefrontCollectionDetail({
      slug,
      page,
      limit: 24,
      sort: sort as CollectionSortOrder | undefined,
    }),
    getTemplateSections("collection"),
    getStorefrontSettings(),
  ]);

  if (!data) {
    notFound();
  }

  const detail = data as unknown as Pick<
    CollectionTemplateResource,
    "collection" | "products" | "pagination"
  >;

  const ctx: SectionRenderContext = {
    locale: locale as Locale,
    defaultLanguage: storefront.defaultLanguage,
    isMultiVendorEnabled: storefront.isMultiVendorEnabled,
    themeId: storefront.theme.id,
    themeSettings: storefront.theme.settings,
    templateType: "collection",
    resource: {
      type: "collection",
      collection: detail.collection,
      products: detail.products,
      pagination: detail.pagination,
      searchParams: search,
      location,
    },
  };

  return (
    <div className="pb-8">
      <div className="container mx-auto px-4 pt-8">
        <StoreBreadcrumb
          locale={locale}
          items={[
            { label: t("nav.collections"), href: "/collections" },
            { label: detail.collection.title },
          ]}
        />
      </div>

      <StoreSections sections={template.sections} ctx={ctx} />
    </div>
  );
}
