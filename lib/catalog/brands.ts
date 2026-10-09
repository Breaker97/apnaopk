/**
 * Shared brand helpers used by the admin and vendor brand APIs.
 */

import { foldForSlug } from "@/lib/strings";

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

/**
 * Whether a brand is approved. Brands from before moderation existed have no
 * `approvalStatus` and count as approved, same as `APPROVED_BRAND_CONDITION`.
 */
export function isApprovedBrand(brand: { approvalStatus?: string | null }): boolean {
  return (
    brand.approvalStatus !== BRAND_APPROVAL_STATUS.PENDING &&
    brand.approvalStatus !== BRAND_APPROVAL_STATUS.REJECTED
  );
}

/**
 * Re-moderation rule for a vendor's edit: an already-approved brand whose name or
 * logo changes goes back to the review queue before it can go live again. The
 * same rule `PUT /api/vendor/brands/[id]` applies; a field that is not part of
 * the edit (`undefined`) is not a change.
 */
export function vendorBrandEditNeedsReview(
  current: { approvalStatus?: string | null; name?: string; logo?: string },
  edit: { name?: string; logo?: string },
): boolean {
  if (current.approvalStatus !== BRAND_APPROVAL_STATUS.APPROVED) return false;
  const nameChanged = edit.name !== undefined && edit.name.trim() !== current.name;
  const logoChanged = edit.logo !== undefined && edit.logo !== current.logo;
  return nameChanged || logoChanged;
}

export function slugifyBrand(value: string): string {
  return foldForSlug(value)
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
