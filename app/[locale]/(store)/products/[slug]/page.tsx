import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { appConfig } from "@/config/app.config";
import { type Locale } from "@/config/i18n.config";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { StoreSections } from "@/components/store/store-sections";
import { generateProductJsonLd, JsonLd } from "@/lib/site-config/seo";
import {
  buildStorefrontAlternates,
  getStorefrontIcons,
  getStorefrontMetadataSettings,
  normalizeMetadataText,
  truncateMetadataText,
} from "@/lib/storefront/storefront-metadata";
import { getStorefrontProductBySlug } from "@/lib/products/storefront-product-detail";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { getTemplateSections } from "@/lib/storefront/pages/get-template";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { resolveRequestLocation } from "@/lib/locations/resolve-request-location";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

async function getProduct(slug: string) {
  return getStorefrontProductBySlug(slug);
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const [product, storeMetadata] = await Promise.all([
    getProduct(slug),
    getStorefrontMetadataSettings(),
  ]);

  if (!product) return {};

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const page = `/products/${slug}`;
  // Title priority: admin-set SEO pageTitle → product.title → product.name → store name.
  const title =
    normalizeMetadataText(
      product.seo?.pageTitle || product.title || product.name,
    ) || storeMetadata.storeName;
  // Description priority: admin metaDescription → product.shortDescription
  // → product.description → store metaDescription → store description → app default.
  const description =
    truncateMetadataText(
      normalizeMetadataText(
        product.seo?.metaDescription ||
          product.shortDescription ||
          product.description ||
          storeMetadata.seo.metaDescription ||
          storeMetadata.storeDescription ||
          appConfig.description,
      ),
      160,
    ) || appConfig.description;
  const productImages: string[] = Array.isArray(product.images)
    ? product.images.filter(
        (image: unknown): image is string =>
          typeof image === "string" && image.trim().length > 0,
      )
    : [];
  // Product images, then the store's OG image. There is no bundled fallback:
  // a link with no preview image beats one showing this app's own artwork.
  const images: string[] =
    productImages.length > 0
      ? productImages
      : storeMetadata.seo.ogImage
        ? [storeMetadata.seo.ogImage]
        : [];
  const productTags: string[] = Array.isArray(product.tags)
    ? product.tags.filter(
        (tag: unknown): tag is string =>
          typeof tag === "string" && tag.trim().length > 0,
      )
    : [];
  // Keywords priority: product tags → store meta keywords.
  const keywords =
    productTags.length > 0 ? productTags : storeMetadata.seo.metaKeywords;
  // OG image alt should describe the product, not echo the SEO title.
  const imageAlt = normalizeMetadataText(product.name) || title;

  // Twitter handle is parsed from settings.social.twitterUrl (admin-configured).
  const twitterHandle = storeMetadata.social?.twitterHandle;
  const twitterSite = twitterHandle ? `@${twitterHandle}` : undefined;

  // `product.priceRange` is set by the model pre-validate hook for both
  // multi-variant and single-variant products. Multi-variant products expose
  // min ≠ max, which downstream OG/JSON-LD use to emit AggregateOffer.
  // "Price on request" products publish no price anywhere — including the
  // link-preview tags, where a `product:price:amount` of 0 is how a quoted
  // product gets shared as free.
  const priceOnRequest = isQuoteOnlyProduct(product);
  const hasPriceRange =
    !priceOnRequest &&
    product.priceRange &&
    typeof product.priceRange.min === "number" &&
    typeof product.priceRange.max === "number";
  const productPrice = priceOnRequest
    ? undefined
    : hasPriceRange
    ? product.priceRange.min
    : typeof product.price === "number"
      ? product.price
      : undefined;
  const productPriceMax = hasPriceRange ? product.priceRange.max : undefined;
  const productAvailability = product.stock > 0 ? "instock" : "oos";

  // Brand for OG/social: populated product.brand first, then vendor storeName.
  const productBrand =
    normalizeMetadataText(
      (product.brand as { name?: string } | undefined)?.name,
    ) || normalizeMetadataText(product.vendorId?.storeName);

  return {
    title,
    description,
    keywords,
    authors: [{ name: storeMetadata.storeName }],
    creator: storeMetadata.storeName,
    publisher: storeMetadata.storeName,
    metadataBase: new URL(baseUrl),
    alternates: await buildStorefrontAlternates({ locale, page }),
    // Next.js 15 only accepts a fixed set of OG types at runtime
    // (website/article/book/profile/music.*/video.*). `og:type: product`
    // throws `Invalid OpenGraph type: product`, so we keep `website` here
    // and surface product-specific tags via the `other` field below.
    // Google reads JSON-LD for product rich results; Facebook/Messenger
    // pick up `product:*` tags from `other` for richer link previews.
    openGraph: {
      type: "website",
      title,
      description,
      url: `${baseUrl}/${locale}${page}`,
      siteName: storeMetadata.storeName,
      images:
        images.length > 0
          ? images.map((url) => ({ url, alt: imageAlt }))
          : undefined,
      locale,
    },
    other: {
      // Note: Next.js renders `other` entries as `<meta name="...">` (not
      // `<meta property="...">`), so we cannot emit a true `og:type: product`
      // here without a custom meta-tag injection. The product-specific tags
      // below are still picked up by Facebook/Messenger when the product
      // object extension is enabled, and JSON-LD remains the authoritative
      // source for Google product rich results.
      ...(productPrice !== undefined
        ? { "product:price:amount": String(productPrice) }
        : {}),
      ...(priceOnRequest
        ? {}
        : { "product:price:currency": storeMetadata.defaultCurrency }),
      ...(productPriceMax && productPriceMax !== productPrice
        ? { "product:price:amount:max": String(productPriceMax) }
        : {}),
      "product:availability":
        productAvailability === "instock" ? "instock" : "oos",
      "product:retailer_item_id": product.sku || product.slug,
      ...(productBrand ? { "product:brand": productBrand } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: images.length > 0 ? images : undefined,
      ...(twitterSite ? { site: twitterSite, creator: twitterSite } : {}),
    },
    robots: { index: true, follow: true },
    icons: getStorefrontIcons(storeMetadata),
  };
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const location = resolveRequestLocation(await searchParams);
  const [t, product, storeMetadata, template, storefront] = await Promise.all([
    getTranslations({ locale }),
    getProduct(slug),
    getStorefrontMetadataSettings(),
    getTemplateSections("product"),
    getStorefrontSettings(),
  ]);
  const defaultCurrency = storeMetadata.defaultCurrency;

  if (!product) {
    notFound();
  }

  // The template's sections render everything below the breadcrumb. The
  // product and the shopper's coarse location are resolved ONCE here and
  // shared through the render context; per-section data (collection offer,
  // related picks, sponsored lane) stays with the sections that need it.
  const ctx: SectionRenderContext = {
    locale: locale as Locale,
    defaultLanguage: storefront.defaultLanguage,
    isMultiVendorEnabled: storefront.isMultiVendorEnabled,
    themeId: storefront.theme.id,
    themeSettings: storefront.theme.settings,
    templateType: "product",
    resource: {
      type: "product",
      product,
      location: {
        lat: location.lat,
        lng: location.lng,
        radius: location.radius,
      },
    },
  };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Shared by the structured data and the breadcrumb, so the category a shopper
  // walks back up through is the same one Google is told this product sits in.
  const category =
    product.category &&
    typeof (product.category as { name?: string }).name === "string"
      ? (product.category as { name: string; slug: string })
      : undefined;

  return (
    <div className="pb-8 lg:pb-10">
      {/* Invisible chrome: JSON-LD only — the visible breadcrumb lives in
          the product template's buy box, so this row takes no space. */}
      <div className="container mx-auto px-4">
      {/* JSON-LD — Google's authoritative source for product rich results.
          Mirrors the admin-defined SEO fields and product data so what
          merchants set in /admin/products/[id] reflects on the storefront. */}
      <JsonLd
        data={generateProductJsonLd({
          name: product.name,
          description: product.description,
          price: product.price,
          priceOnRequest: isQuoteOnlyProduct(product),
          priceRange:
            product.priceRange &&
            typeof product.priceRange.min === "number" &&
            typeof product.priceRange.max === "number"
              ? {
                  min: product.priceRange.min,
                  max: product.priceRange.max,
                }
              : undefined,
          currency: defaultCurrency,
          image: product.images?.[0] || "",
          images: product.images,
          url: `${baseUrl}/${locale}/products/${slug}`,
          sku: product.sku,
          inStock: product.stock > 0,
          rating: product.rating,
          reviewCount: product.reviewCount,
          // Brand (manufacturer) takes precedence over vendor storeName.
          brand:
            normalizeMetadataText(
              (product.brand as { name?: string } | undefined)?.name,
            ) || normalizeMetadataText(product.vendorId?.storeName),
          category: category
            ? { name: category.name, slug: category.slug }
            : undefined,
        })}
      />

      {/* Structured data only (hidden): the buy box renders the visible
          trail, but Google still gets the BreadcrumbList hierarchy, routed
          through the product's own category rather than straight to the
          grid — the page it prints under the search result. */}
      <StoreBreadcrumb
        locale={locale}
        hidden
        items={[
          { label: t("nav.products"), href: "/products" },
          ...(category
            ? [{ label: category.name, href: `/categories/${category.slug}` }]
            : []),
          { label: product.name },
        ]}
      />
      </div>

      {/* The product TEMPLATE: product-main + reviews + sponsored + related
          by default, admin-arranged once a template is published. Sections
          carry their own containers so full-bleed content sections can
          escape; the breadcrumb and JSON-LD above are page chrome, not
          template content. */}
      <StoreSections sections={template.sections} ctx={ctx} />
    </div>
  );
}
