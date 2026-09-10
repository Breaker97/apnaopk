import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Layers } from "lucide-react";
import { type Locale } from "@/config/i18n.config";
import type { RequestLocation } from "@/lib/locations/shopper-location";
import { AppImage } from "@/components/ui/app-image";
import {
  ModernProductCardSkeleton,
  type ModernProduct,
} from "@/components/products/modern-product-card";
import { CollectionProductsGrid } from "@/components/products/collection-products-grid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CollectionTemplateResource } from "@/lib/storefront/sections/types";

/**
 * The collection template's two halves — header (banner, description,
 * count, sort) and grid+pagination core — moved verbatim from the
 * hand-wired /collections/[slug] page. Both read the page's ONE
 * `getStorefrontCollectionDetail` response through the resource.
 */

export async function CollectionDetailHeader({
  locale,
  resource,
}: {
  locale: Locale;
  resource: CollectionTemplateResource;
}) {
  const t = await getTranslations({ locale });
  const collection = resource.collection;
  const sort =
    typeof resource.searchParams.sort === "string"
      ? resource.searchParams.sort
      : undefined;
  const image = collection.image as
    | { url?: string; alt?: string }
    | undefined;
  const description =
    typeof collection.description === "string" ? collection.description : "";

  return (
    <div className="container mx-auto mb-8 px-4">
      {image?.url ? (
        <div className="relative mb-6 h-40 overflow-hidden rounded-lg bg-muted sm:h-52">
          <AppImage
            src={image.url}
            alt={image.alt || collection.title}
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
            <h1 className="text-4xl font-bold mb-2">{collection.title}</h1>
            {description && (
              <p className="text-lg opacity-90 max-w-2xl">{description}</p>
            )}
          </div>
        </div>
      ) : (
        <>
          <h1 className="text-3xl font-bold mb-2">{collection.title}</h1>
          {description && (
            <p className="text-muted-foreground max-w-2xl mb-4">
              {description}
            </p>
          )}
        </>
      )}

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">
          {t("storeCollectionDetailPage.productsCount", {
            count: resource.pagination.total,
          })}
        </p>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("storeCollectionDetailPage.sortByLabel")}
          </span>
          <SortSelect
            currentSort={sort}
            slug={collection.slug}
            locale={locale}
            location={resource.location}
            labels={{
              placeholder: t("storeCollectionDetailPage.sortPlaceholder"),
              featured: t("storeCollectionDetailPage.sortOptions.featured"),
              bestSelling: t(
                "storeCollectionDetailPage.sortOptions.bestSelling",
              ),
              aToZ: t("storeCollectionDetailPage.sortOptions.aToZ"),
              zToA: t("storeCollectionDetailPage.sortOptions.zToA"),
              priceLowHigh: t(
                "storeCollectionDetailPage.sortOptions.priceLowHigh",
              ),
              priceHighLow: t(
                "storeCollectionDetailPage.sortOptions.priceHighLow",
              ),
              newest: t("storeCollectionDetailPage.sortOptions.newest"),
            }}
          />
        </div>
      </div>
    </div>
  );
}

export async function CollectionDetailMain({
  locale,
  resource,
}: {
  locale: Locale;
  resource: CollectionTemplateResource;
}) {
  const t = await getTranslations({ locale });
  const { products, pagination } = resource;
  const sort =
    typeof resource.searchParams.sort === "string"
      ? resource.searchParams.sort
      : undefined;

  return (
    <div className="container mx-auto px-4">
      <Suspense fallback={<ProductsGridSkeleton />}>
        {products.length === 0 ? (
          <div className="text-center py-12">
            <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">
              {t("storeCollectionDetailPage.emptyProductsTitle")}
            </h2>
            <p className="text-muted-foreground">
              {t("storeCollectionDetailPage.emptyProductsDescription")}
            </p>
          </div>
        ) : (
          <CollectionProductsGrid
            products={products as ModernProduct[]}
            locale={locale}
          />
        )}
      </Suspense>

      {pagination.totalPages > 1 && (
        <div className="mt-8">
          <CollectionPagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            sort={sort}
            locale={locale}
            location={resource.location}
          />
        </div>
      )}
    </div>
  );
}

function SortSelect({
  currentSort,
  slug,
  locale,
  location,
  labels,
}: {
  currentSort?: string;
  slug: string;
  locale: string;
  location: RequestLocation;
  labels: {
    placeholder: string;
    featured: string;
    bestSelling: string;
    aToZ: string;
    zToA: string;
    priceLowHigh: string;
    priceHighLow: string;
    newest: string;
  };
}) {
  const sortHref = (sort?: string) => {
    const params = new URLSearchParams();
    params.set("page", "1");
    if (sort) params.set("sort", sort);
    if (location.lat) params.set("lat", location.lat);
    if (location.lng) params.set("lng", location.lng);
    if (location.radius) params.set("radius", location.radius);
    if (location.city) params.set("city", location.city);
    return `/${locale}/collections/${slug}?${params.toString()}`;
  };

  return (
    <Select defaultValue={currentSort || "manual"}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={labels.placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="manual">
          <a href={sortHref()}>{labels.featured}</a>
        </SelectItem>
        <SelectItem value="best-selling">
          <a href={sortHref("best-selling")}>{labels.bestSelling}</a>
        </SelectItem>
        <SelectItem value="title-asc">
          <a href={sortHref("title-asc")}>{labels.aToZ}</a>
        </SelectItem>
        <SelectItem value="title-desc">
          <a href={sortHref("title-desc")}>{labels.zToA}</a>
        </SelectItem>
        <SelectItem value="price-asc">
          <a href={sortHref("price-asc")}>{labels.priceLowHigh}</a>
        </SelectItem>
        <SelectItem value="price-desc">
          <a href={sortHref("price-desc")}>{labels.priceHighLow}</a>
        </SelectItem>
        <SelectItem value="created-desc">
          <a href={sortHref("created-desc")}>{labels.newest}</a>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

async function CollectionPagination({
  currentPage,
  totalPages,
  sort,
  locale,
  location,
}: {
  currentPage: number;
  totalPages: number;
  sort?: string;
  locale: string;
  location: RequestLocation;
}) {
  const t = await getTranslations({ locale });

  const buildUrl = (page: number) => {
    const params = new URLSearchParams();
    params.set("page", page.toString());
    if (sort) params.set("sort", sort);
    if (location.lat) params.set("lat", location.lat);
    if (location.lng) params.set("lng", location.lng);
    if (location.radius) params.set("radius", location.radius);
    if (location.city) params.set("city", location.city);
    return `?${params.toString()}`;
  };

  return (
    <div className="flex justify-center gap-2">
      {currentPage > 1 && (
        <a
          href={buildUrl(currentPage - 1)}
          className="px-4 py-2 border rounded-md hover:bg-muted"
        >
          {t("storeCollectionDetailPage.pagination.previous")}
        </a>
      )}

      <span className="px-4 py-2">
        {t("storeCollectionDetailPage.pagination.pageOf", {
          current: currentPage,
          total: totalPages,
        })}
      </span>

      {currentPage < totalPages && (
        <a
          href={buildUrl(currentPage + 1)}
          className="px-4 py-2 border rounded-md hover:bg-muted"
        >
          {t("storeCollectionDetailPage.pagination.next")}
        </a>
      )}
    </div>
  );
}

function ProductsGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <ModernProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
