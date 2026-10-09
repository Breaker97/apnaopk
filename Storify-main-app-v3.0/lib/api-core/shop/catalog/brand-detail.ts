import { BrandDetail } from "@/contracts/mobile/shop/v1/catalog";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { getStorefrontBrandDetail } from "@/lib/brands/storefront-brands";
import { toBrandSummary } from "./summaries";

function webAddress(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * GET /brands/{slug}: the brand's own page header. Its products come from
 * `GET /products?brand=`. Static: expired by the brands and products tags.
 */
export const brandDetailRoute = defineRoute({
  id: "catalog.brands.detail",
  method: "GET",
  path: "/brands/{slug}",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: BrandDetail,
  handler: async ({ params }) => {
    // One product is the least the reader pages by; only its count is used.
    const detail = await getStorefrontBrandDetail({ slug: params.slug, page: 1, limit: 1 });
    if (!detail) throw new MobileApiError(404, "NOT_FOUND", "This brand is not available.");
    const { brand } = detail;
    const description = typeof brand.description === "string" ? brand.description.trim() : "";
    const websiteUrl = webAddress(brand.website);
    return {
      ...toBrandSummary(brand),
      ...(description ? { description } : {}),
      ...(websiteUrl ? { websiteUrl } : {}),
    };
  },
});
