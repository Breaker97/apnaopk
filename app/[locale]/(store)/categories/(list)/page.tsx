import Link from "next/link";
import { Package, PackageSearch, Search } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { AppImage } from "@/components/ui/app-image";
import { type Locale } from "@/config/i18n.config";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { CategoriesPageClient } from "@/components/store/categories-page-client";
import { ElectronicsPager } from "@/components/store/electronics-pager";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import {
  getStorefrontCategories,
  type StorefrontCategory,
} from "@/lib/storefront/storefront-categories";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const PAGE_SIZE = 20;
/** The Electronics grid is four tiles across, so pages fill whole rows. */
const ELECTRONICS_PAGE_SIZE = 12;

export default async function CategoriesPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, search, settings] = await Promise.all([
    getTranslations({ locale }),
    searchParams,
    getStorefrontSettings(),
  ]);

  if (settings.theme.id === "electronics") {
    return (
      <ElectronicsCategoriesPage locale={locale as Locale} search={search} />
    );
  }

  const { categories, pagination } = await getStorefrontCategories({
    flat: true,
    page: 1,
    limit: PAGE_SIZE,
  });

  return (
    <div className="container mx-auto px-4 py-8 lg:py-12">
      <StoreBreadcrumb
        className="mb-4"
        locale={locale}
        items={[{ label: t("nav.categories") }]}
      />

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          {t("nav.categories")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Browse every product category in one place.
        </p>
      </div>

      <Separator className="mb-8" />

      <CategoriesPageClient
        locale={locale as Locale}
        initialCategories={categories}
        initialPagination={pagination}
      />
    </div>
  );
}

/**
 * The Electronics reading of this page: centred two-tone title, a pill
 * search bar, square tiles, and a numbered pager instead of infinite
 * scroll. Query and page live in the URL (`?q=`, `?page=`) so every state
 * is server-rendered, shareable, and one back-press away — the same reason
 * the compare page keeps its selection in the query string.
 */
async function ElectronicsCategoriesPage({
  locale,
  search,
}: {
  locale: Locale;
  search: { [key: string]: string | string[] | undefined };
}) {
  const query = typeof search.q === "string" ? search.q.trim().slice(0, 80) : "";
  const rawPage = typeof search.page === "string" ? parseInt(search.page, 10) : 1;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const [t, { categories, pagination }] = await Promise.all([
    getTranslations({ locale }),
    getStorefrontCategories({
      flat: true,
      page,
      limit: ELECTRONICS_PAGE_SIZE,
      search: query,
    }),
  ]);

  const basePath = `/${locale}/categories`;
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="container mx-auto px-4 py-8 lg:py-12">
      <StoreBreadcrumb
        className="mb-8"
        locale={locale}
        items={[{ label: t("nav.categories") }]}
      />

      <ElectronicsSectionHeading
        as="h1"
        restStyle="plain"
        title={t("common.allCategories")}
        className="text-[26px] sm:text-[34px]"
      />

      <form
        action={basePath}
        className="mx-auto mt-6 flex w-full max-w-[768px] items-center rounded-full border border-border bg-background p-[5px]"
      >
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={t("storeCategoriesPage.searchPlaceholder")}
          className="h-[38px] min-w-0 flex-1 bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        <button
          type="submit"
          aria-label={t("common.search")}
          className="grid h-[38px] w-[62px] shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85"
        >
          <Search className="size-4" aria-hidden />
        </button>
      </form>

      <div className="mt-10 lg:mt-14">
        {categories.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 lg:gap-[26px]">
            {categories.map((category) => (
              <ElectronicsCategoryTile
                key={category._id}
                locale={locale}
                category={category}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-4xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
            <PackageSearch className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-base font-semibold text-foreground">
              {t("common.noCategories")}
            </p>
          </div>
        )}
      </div>

      {pagination.totalPages > 1 ? (
        <nav className="mt-10 flex justify-end border-t border-border pt-7">
          <ElectronicsPager
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageHref={pageHref}
            previousLabel={t("common.previous")}
            nextLabel={t("common.next")}
          />
        </nav>
      ) : null}
    </div>
  );
}

function ElectronicsCategoryTile({
  locale,
  category,
}: {
  locale: Locale;
  category: StorefrontCategory;
}) {
  const image = category.image || category.icon;
  return (
    <Link
      href={`/${locale}/categories/${encodeURIComponent(category.slug)}`}
      className="group flex flex-col"
    >
      <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-muted transition-colors group-hover:bg-muted/70">
        {image ? (
          <AppImage
            src={image}
            alt=""
            width={360}
            height={360}
            aria-hidden
            className="h-[64%] w-[64%] object-contain transition-transform duration-300 group-hover:scale-[1.05]"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px"
          />
        ) : (
          <Package className="size-9 text-muted-foreground" aria-hidden />
        )}
      </span>
      <span className="mt-3 line-clamp-2 px-1 text-[15px] font-bold leading-tight tracking-[-0.01em] text-foreground transition-colors group-hover:text-primary sm:text-[17px]">
        {category.name}
      </span>
    </Link>
  );
}
