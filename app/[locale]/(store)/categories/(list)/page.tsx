import Link from "next/link";
import { ArrowRight, ImageOff, Package, PackageSearch, Search } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { type Locale } from "@/config/i18n.config";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { ElectronicsPager } from "@/components/store/electronics-pager";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import {
  getStorefrontCategories,
  type StorefrontCategory,
} from "@/lib/storefront/storefront-categories";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import {
  themeCategoriesPageTiles,
  themeUsesTwoToneHeadings,
} from "@/lib/storefront/themes/registry";
import { cn } from "@/lib/utils";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** Whole rows at the widest grid: four tiles across, or five cards. */
const PAGE_SIZE = { tiles: 12, cards: 20 } as const;

/**
 * Every category in one place, under every template: a search bar, the
 * categories as tiles, and a numbered pager. Query and page live in the URL
 * (`?q=`, `?page=`) so every state is server-rendered, shareable, and one
 * back-press away — the same reason the compare page keeps its selection in
 * the query string.
 *
 * The template's data decides only the drawing: its heading treatment
 * (`headingStyle`) and its tiles (`categoriesPage` — bordered cards with the
 * category's description, or square picture tiles).
 */
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

  const tiles = themeCategoriesPageTiles(settings.theme.id);
  const twoTone = themeUsesTwoToneHeadings(settings.theme.id);
  const query = typeof search.q === "string" ? search.q.trim().slice(0, 80) : "";
  const rawPage = typeof search.page === "string" ? parseInt(search.page, 10) : 1;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const { categories, pagination } = await getStorefrontCategories({
    flat: true,
    page,
    limit: PAGE_SIZE[tiles],
    search: query,
  });

  const basePath = `/${locale}/categories`;
  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const subtitle = t.has("storeCategoriesPage.subtitle")
    ? t("storeCategoriesPage.subtitle")
    : "Browse every product category in one place.";

  return (
    <div className="container mx-auto px-4 py-8 lg:py-12">
      <StoreBreadcrumb
        className={twoTone ? "mb-8" : "mb-4"}
        locale={locale}
        items={[{ label: t("nav.categories") }]}
      />

      {twoTone ? (
        <ElectronicsSectionHeading
          as="h1"
          restStyle="plain"
          title={t("common.allCategories")}
          className="text-[26px] sm:text-[34px]"
        />
      ) : (
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("nav.categories")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            {subtitle}
          </p>
        </div>
      )}

      <form
        action={basePath}
        className={cn(
          "mt-6 flex w-full max-w-[768px] items-center rounded-input border border-border bg-background p-[5px]",
          twoTone && "mx-auto",
        )}
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
          className="grid h-[38px] w-[62px] shrink-0 place-items-center rounded-input bg-foreground text-background transition-opacity hover:opacity-85"
        >
          <Search className="size-4" aria-hidden />
        </button>
      </form>

      <div className={twoTone ? "mt-10 lg:mt-14" : "mt-8"}>
        {categories.length > 0 ? (
          tiles === "tiles" ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 lg:gap-[26px]">
              {categories.map((category) => (
                <CategoryTile key={category._id} locale={locale} category={category} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {categories.map((category) => (
                <CategoryCard
                  key={category._id}
                  locale={locale}
                  category={category}
                  countLabel={t("storeCategoryDetailPage.productsCount", {
                    count: category.productCount || 0,
                  })}
                  viewLabel={
                    t.has("storeCategoriesPage.viewProducts")
                      ? t("storeCategoriesPage.viewProducts")
                      : "View products"
                  }
                />
              ))}
            </div>
          )
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

/** A square picture tile with the name under it. */
function CategoryTile({
  locale,
  category,
}: {
  locale: string;
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

/** A bordered card: picture, name, description (or count), and a link line. */
function CategoryCard({
  locale,
  category,
  countLabel,
  viewLabel,
}: {
  locale: string;
  category: StorefrontCategory;
  countLabel: string;
  viewLabel: string;
}) {
  const image = category.image || category.icon;
  return (
    <Link
      href={`/${locale}/categories/${encodeURIComponent(category.slug)}`}
      className="group overflow-hidden rounded-md border bg-background transition-colors hover:border-primary/45"
    >
      <div className="relative aspect-4/3 bg-muted/45">
        {image ? (
          <AppImage
            src={image}
            alt={category.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className="object-contain p-6 transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground/55">
            <ImageOff className="h-8 w-8" />
          </div>
        )}
      </div>

      <div className="space-y-2 p-3 sm:p-4">
        <div>
          <h2 className="line-clamp-1 text-sm font-semibold text-foreground sm:text-base">
            {category.name}
          </h2>
          <p className="mt-1 line-clamp-2 min-h-9 text-xs leading-4 text-muted-foreground">
            {category.description || countLabel}
          </p>
        </div>

        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          {viewLabel}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
