import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Scale } from "lucide-react";
import { type Locale } from "@/config/i18n.config";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { CompareUrlSync } from "@/components/store/compare/compare-bar";
import { CompareSearch } from "@/components/store/compare/compare-search";
import { CompareTable } from "@/components/store/compare/compare-table";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import { getStorefrontProductBySlug } from "@/lib/products/storefront-product-detail";
import {
  parseCompareSelection,
  type CompareProduct,
} from "@/lib/products/compare";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { themeUsesTwoToneHeadings } from "@/lib/storefront/themes/registry";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return {
    title: t("compare.title"),
    description: t("compare.subtitle"),
    // The interesting page is always a specific comparison, and those are
    // query-string permutations of one route — nothing worth indexing.
    robots: { index: false, follow: true },
  };
}

/**
 * Side-by-side product comparison.
 *
 * A plain storefront route rather than a section-built template, for the
 * same reason checkout is: the page is a TOOL with a fixed shape, not a
 * content surface a merchant arranges. It is available under every theme —
 * the engine has no notion of a route one theme owns — and simply wears the
 * active theme's heading treatment, so the Electronics design is what an
 * Electronics store gets without the page becoming theme-specific.
 *
 * The selection lives entirely in `?products=` (see lib/products/compare.ts):
 * server-rendered, shareable, reload-proof, and undoable with the back
 * button — no store, no persistence, nothing to rehydrate.
 */
export default async function ComparePage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [query, t, settings] = await Promise.all([
    searchParams,
    getTranslations({ locale }),
    getStorefrontSettings(),
  ]);
  const selection = parseCompareSelection(query.products);

  // A slug that no longer resolves (unpublished, renamed, hand-typed) drops
  // out silently rather than 404ing the whole comparison.
  const resolved = await Promise.all(
    selection.map((slug) => getStorefrontProductBySlug(slug)),
  );
  const products: CompareProduct[] = resolved.flatMap((product) => {
    if (!product) return [];
    const source = product as unknown as Record<string, unknown>;
    const images = Array.isArray(source.images)
      ? (source.images as unknown[]).filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const attributes = Array.isArray(source.attributes)
      ? (source.attributes as { name?: unknown; value?: unknown }[]).flatMap(
          (entry) =>
            typeof entry?.name === "string" && typeof entry?.value === "string"
              ? [{ name: entry.name, value: entry.value }]
              : [],
        )
      : [];
    return [
      {
        id: String(source._id),
        slug: String(source.slug),
        name: String(source.name ?? ""),
        image: images[0],
        rating: typeof source.rating === "number" ? source.rating : 0,
        reviewCount:
          typeof source.reviewCount === "number" ? source.reviewCount : 0,
        attributes,
        priceOnRequest: source.priceOnRequest === true,
        price: typeof source.price === "number" ? source.price : undefined,
        comparePrice:
          typeof source.comparePrice === "number"
            ? source.comparePrice
            : undefined,
        priceRange: source.priceRange as CompareProduct["priceRange"],
        compareAtPriceRange:
          source.compareAtPriceRange as CompareProduct["compareAtPriceRange"],
        variants: source.variants as CompareProduct["variants"],
      },
    ];
  });

  // The slugs that actually resolved, so every remove link rebuilds a URL
  // that stays truthful.
  const liveSelection = products.map((product) => product.slug);
  const twoToneHeading = themeUsesTwoToneHeadings(settings.theme.id);

  return (
    <div className="container mx-auto px-4 py-8 lg:py-12">
      {/* The tray follows what this page renders, so the floating bar's
          count can never disagree with the columns below. */}
      <CompareUrlSync slugs={liveSelection} />
      <StoreBreadcrumb
        locale={locale as Locale}
        items={[{ label: t("compare.title") }]}
        className="mb-8"
        // noindex page — the trail is navigation here, not site hierarchy
        // a crawler will ever print.
        jsonLd={false}
      />

      {twoToneHeading ? (
        <ElectronicsSectionHeading
          as="h1"
          emphasis="first"
          title={t("compare.title")}
          className="text-[32px] sm:text-[44px] lg:text-[50px]"
        />
      ) : (
        <h1 className="text-center text-[32px] font-bold tracking-tight text-foreground sm:text-[44px]">
          {t("compare.title")}
        </h1>
      )}

      <div className="mt-8 lg:mt-10">
        <CompareSearch locale={locale as Locale} selection={liveSelection} />
      </div>

      <div className="mt-10 lg:mt-12">
        {products.length > 0 ? (
          <CompareTable
            locale={locale as Locale}
            products={products}
            selection={liveSelection}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-4xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
            <Scale className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-base font-semibold text-foreground">
              {t("compare.emptyTitle")}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              {t("compare.emptyHint")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
