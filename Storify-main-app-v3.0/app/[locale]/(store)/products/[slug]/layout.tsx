import type { Metadata } from "next";
import { getStorefrontProductBySlug } from "@/lib/products/storefront-product-detail";
import { storefrontResourceGate } from "@/lib/storefront/resource-gate";
import { storefrontPageMetadata } from "@/lib/storefront/storefront-metadata";

// A product the storefront does not show answers 404 before the page streams.
export default storefrontResourceGate(getStorefrontProductBySlug);

/**
 * Canonical, hreflang and Open Graph URL from the params, not the request: the
 * page is served from the cache and may not read it. A product's own metadata
 * (page.tsx) replaces all of this; a slug the store does not show keeps it on
 * its 404, as it did while the layout above read the request path.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  return storefrontPageMetadata(locale, `/products/${slug}`);
}
