/**
 * Shared brand helpers used by the admin and vendor brand APIs.
 */

export const BRAND_APPROVAL_STATUS = {
  APPROVED: "approved",
  PENDING: "pending",
  REJECTED: "rejected",
} as const;

/**
 * Matches brands that are approved for public display. Brands created before
 * the moderation feature have no `approvalStatus` field; `$nin` treats those
 * legacy/missing values as approved so they stay visible without a migration.
 */
export const APPROVED_BRAND_CONDITION = {
  $nin: [BRAND_APPROVAL_STATUS.PENDING, BRAND_APPROVAL_STATUS.REJECTED],
} as const;

/**
 * Brands that are publicly visible (storefront, product filters, assignment):
 * approved, live, and not soft-deleted. (`deletedAt: null` also matches
 * documents where the field is absent.)
 */
export const STOREFRONT_BRAND_FILTER = {
  isActive: true,
  approvalStatus: APPROVED_BRAND_CONDITION,
  deletedAt: null,
} as const;

export function slugifyBrand(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function getRequestedBrandSlug(body: Record<string, unknown>): string {
  const directSlug = typeof body.slug === "string" ? body.slug : "";
  const seo = body.seo as { slug?: unknown } | undefined;
  const seoSlug = typeof seo?.slug === "string" ? seo.slug : "";
  return slugifyBrand(directSlug || seoSlug);
}

export function normalizeBrandSeo(
  body: Record<string, unknown>,
): { pageTitle?: string; metaDescription?: string } | undefined {
  const seo = body.seo as
    | { pageTitle?: unknown; metaDescription?: unknown }
    | undefined;
  const pageTitle =
    typeof seo?.pageTitle === "string" ? seo.pageTitle.trim() : "";
  const metaDescription =
    typeof seo?.metaDescription === "string" ? seo.metaDescription.trim() : "";

  if (!pageTitle && !metaDescription) return undefined;

  return {
    ...(pageTitle ? { pageTitle } : {}),
    ...(metaDescription ? { metaDescription } : {}),
  };
}
