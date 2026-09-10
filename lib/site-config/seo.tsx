import { localeConfig, type Locale } from "@/config/i18n.config";

interface OrganizationJsonLdInput {
  storeName: string;
  storeDescription?: string;
  /** Admin-configured logo; omitted from the payload when unset. */
  logoUrl?: string;
  storePhone?: string;
  /** Admin-configured social profile URLs, in any order. */
  socialUrls?: Array<string | undefined>;
  /**
   * Locales the store actually serves. Advertising every locale the build
   * ships would promise customer service in 18 languages the merchant does
   * not speak.
   */
  availableLocales: Locale[];
}

/**
 * Organization structured data, built entirely from store settings — Google
 * shows the `logo` and `name` next to the site in search results, so every
 * field here has to be the merchant's own, never this app's.
 */
export function generateOrganizationJsonLd({
  storeName,
  storeDescription,
  logoUrl,
  storePhone,
  socialUrls = [],
  availableLocales,
}: OrganizationJsonLdInput) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const absoluteLogo = logoUrl
    ? logoUrl.startsWith("http")
      ? logoUrl
      : `${baseUrl.replace(/\/+$/, "")}${logoUrl.startsWith("/") ? "" : "/"}${logoUrl}`
    : undefined;
  const sameAs = socialUrls
    .map((url) => (typeof url === "string" ? url.trim() : ""))
    .filter(Boolean);

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: storeName,
    description: storeDescription || undefined,
    url: baseUrl,
    logo: absoluteLogo,
    contactPoint: storePhone
      ? {
          "@type": "ContactPoint",
          telephone: storePhone,
          contactType: "customer service",
          availableLanguage: availableLocales.map((l) => localeConfig[l].name),
        }
      : undefined,
    sameAs: sameAs.length > 0 ? sameAs : undefined,
  };
}

/**
 * Strip HTML tags from a string for plain text SEO meta description
 * and JSON-LD structured data.
 */
function stripHtmlForSeo(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Truncate text to a maximum length, adding an ellipsis when exceeded.
 * Used for SEO descriptions and JSON-LD text fields.
 */
function truncateForSeo(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

/**
 * Generate JSON-LD structured data for a product
 */
export function generateProductJsonLd(product: {
  name: string;
  description: string;
  // For multi-variant products, supply priceRange to emit AggregateOffer.
  // Single-variant products can leave it undefined.
  price?: number;
  priceRange?: { min: number; max: number };
  /**
   * Sold by quote: the product has no price to publish. `offers` is omitted
   * entirely rather than filled with a zero — a `price: 0` offer is how a
   * "price on request" listing ends up advertised as free in a search result
   * or a shopping feed. The product loses its price rich result, which is
   * the honest outcome for a product that does not have a price.
   */
  priceOnRequest?: boolean;
  currency: string;
  // First image is required for backwards compatibility; pass additional
  // images to surface them all in Google Images search.
  image: string;
  images?: string[];
  sku?: string;
  // Brand (manufacturer) — preferred over vendorId for structured data.
  brand?: string;
  category?: { name: string; slug: string };
  rating?: number;
  reviewCount?: number;
  inStock: boolean;
  url: string;
  availability?: "instock" | "outofstock" | "preorder" | "discontinued";
}) {
  const availabilityMap = {
    instock: "https://schema.org/InStock",
    outofstock: "https://schema.org/OutOfStock",
    preorder: "https://schema.org/PreOrder",
    discontinued: "https://schema.org/Discontinued",
  } as const;
  const availabilityUrl =
    availabilityMap[
      product.availability ?? (product.inStock ? "instock" : "outofstock")
    ];

  const plainDescription = truncateForSeo(
    stripHtmlForSeo(product.description || ""),
    5000,
  );

  // Surface all product images (capped to 10) so Google Images can index them.
  const imageList = Array.from(
    new Set(
      [product.image, ...(product.images || [])]
        .filter(
          (img): img is string =>
            typeof img === "string" && img.trim().length > 0,
        )
        .map((img) => img.trim()),
    ),
  ).slice(0, 10);

  const hasPriceRange =
    product.priceRange &&
    typeof product.priceRange.min === "number" &&
    typeof product.priceRange.max === "number";

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: plainDescription,
    image: imageList.length > 0 ? imageList : product.image,
    sku: product.sku,
    brand: product.brand
      ? {
          "@type": "Brand",
          name: product.brand,
        }
      : undefined,
    category: product.category?.name,
    offers: product.priceOnRequest
      ? undefined
      : hasPriceRange
      ? {
          "@type": "AggregateOffer",
          priceCurrency: product.currency,
          lowPrice: product.priceRange!.min,
          highPrice: product.priceRange!.max,
          availability: availabilityUrl,
          url: product.url,
        }
      : {
          "@type": "Offer",
          price: product.price,
          priceCurrency: product.currency,
          availability: availabilityUrl,
          url: product.url,
        },
    aggregateRating:
      product.rating && product.rating > 0 && product.reviewCount
        ? {
            "@type": "AggregateRating",
            ratingValue: product.rating,
            reviewCount: product.reviewCount,
          }
        : undefined,
  };
}

/**
 * Generate JSON-LD structured data for breadcrumbs
 */
export function generateBreadcrumbJsonLd(
  items: Array<{ name: string; url?: string }>,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      // Optional by design: Google reads a crumb with no `item` as the current
      // page, which is exactly what the trailing crumb is. `undefined` drops
      // out of the serialized payload.
      item: item.url,
    })),
  };
}

/**
 * Generate JSON-LD structured data for a website
 */
export function generateWebsiteJsonLd({
  storeName,
  locale,
}: {
  storeName: string;
  locale: string;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: storeName,
    url: baseUrl,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${baseUrl}/${locale}/products?search={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * JsonLd Component for inserting structured data into pages
 */
export function JsonLd({ data, id }: { data: object; id?: string }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
      suppressHydrationWarning
    />
  );
}
