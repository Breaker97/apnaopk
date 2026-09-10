import { Brand } from "@/models";
import {
  createdResponse,
  paginatedResponse,
  successResponse,
} from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { isAdmin } from "@/lib/access/rbac";
import {
  slugifyBrand,
  getRequestedBrandSlug,
  normalizeBrandSeo,
  BRAND_APPROVAL_STATUS,
} from "@/lib/catalog/brands";
import { revalidateBrandContent } from "@/lib/cache-invalidation";
import { fetchBrandList } from "@/lib/catalog/brand-list";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

const BrandSeoSchema = z.record(z.string(), z.unknown());
// Shape check + allow-list: only these keys reach `Brand.create` / `$set`.
const BrandCreateSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required").max(120),
  slug: z.string().max(120).optional(),
  description: z.string().max(5000).optional(),
  logo: z.string().max(2048).optional(),
  website: z.string().max(2048).optional(),
  displayOrder: z.number().optional(),
  order: z.number().optional(),
  isActive: z.boolean().optional(),
  featured: z.boolean().optional(),
  seo: BrandSeoSchema.optional(),
});

/**
 * GET /api/brands
 * Fetch brands with optional pagination/search/status filters.
 *
 * - `assignable=true` returns only brands that can be attached to a product
 *   (approved, active, not archived) regardless of caller role. Used by the
 *   product form brand selector.
 * - Admins otherwise see all non-archived brands and can filter by moderation
 *   state (`status=pending|rejected|archived`).
 * - Everyone else only sees the public storefront set.
 */
export const GET = withApi({ auth: "optional" }, async ({ request, session }) => {
  const searchParams = request.nextUrl.searchParams;
  const list = await fetchBrandList(searchParams, {
    isAdmin: isAdmin(session?.user),
    assignable: searchParams.get("assignable") === "true",
  });

  // `limit=0` means "no pagination" for this endpoint, and callers rely on the
  // plain-array response that produces.
  const paginated = parseInt(searchParams.get("page") || "0", 10) > 0 &&
    parseInt(searchParams.get("limit") || "0", 10) > 0;

  return paginated
    ? paginatedResponse(list.items, list.page, list.limit, list.total)
    : successResponse(list.items);
});

/**
 * POST /api/brands
 * Create a new brand (Admin only)
 */
export const POST = withApi({ auth: "admin" }, async ({ request }) => {
  const body = await validateBody(request, BrandCreateSchema);

  const requestedSlug = getRequestedBrandSlug(body);
  const slug = requestedSlug || slugifyBrand(body.name);
  const seo = normalizeBrandSeo(body);
  if (seo) {
    body.seo = seo;
  } else {
    delete body.seo;
  }

  const existing = await Brand.findOne({ slug });
  const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

  // Admin-created brands are platform-owned and auto-approved.
  const brand = await Brand.create({
    ...body,
    slug: finalSlug,
    order: body.displayOrder || 0,
    ownerVendorId: null,
    approvalStatus: BRAND_APPROVAL_STATUS.APPROVED,
  });

  revalidateBrandContent({ slugs: [brand.slug] });

  return createdResponse(brand);
});
