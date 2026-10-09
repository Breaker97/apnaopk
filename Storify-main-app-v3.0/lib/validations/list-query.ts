import * as z from "zod";

/**
 * Paginated list-query schemas shared by admin API routes and the client-side
 * list views (products, customers, staff, discounts). Separate from `./index`
 * for the same reason as `./auth`: the list views are client components, and
 * the barrel would pull the whole schema catalogue into their bundles.
 */

/**
 * Transform that sanitizes search strings to prevent ReDoS attacks
 * Escapes all regex special characters
 */
const sanitizeSearch = (val: string) =>
  val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Safe search schema - auto-sanitizes regex special characters
 */
export const SafeSearchSchema = z
  .string()
  .max(100, "Search query too long")
  .transform(sanitizeSearch)
  .optional();

/**
 * Admin list query params with pagination and safe search
 */
export const AdminListQuerySchema = z.object({
  page: z.coerce.number().min(1).max(1000).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: SafeSearchSchema,
  status: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Product list query params with filters
 */
export const ProductListQuerySchema = AdminListQuerySchema.extend({
  category: z.string().optional(),
  vendor: z.string().optional(),
  source: z.enum(["all", "admin", "vendor"]).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  featured: z.coerce.boolean().optional(),
  inStock: z.coerce.boolean().optional(),
  /** Only products with a compare-at price above their price — deals. */
  onSale: z.coerce.boolean().optional(),
  /**
   * Products a sponsored placement could actually render: active AND published
   * to the online store. The boost booking forms offer nothing else — a
   * POS-only product is refused at the end of the flow, which is the worst
   * moment to learn it.
   */
  boostable: z.coerce.boolean().optional(),
});

/**
 * Boost campaigns list: the admin view adds a seller filter and a rung filter.
 * `position` stays a string so the select's "all" passes through like
 * `vendor`'s does; the list query reads a positive integer out of it or
 * ignores it.
 */
export const BoostCampaignListQuerySchema = AdminListQuerySchema.extend({
  vendor: z.string().optional(),
  position: z.string().max(4).optional(),
});

export const CustomerListQuerySchema = AdminListQuerySchema.extend({
  loyaltyTier: z.enum(["bronze", "silver", "gold", "platinum"]).optional(),
  /**
   * Email marketing consent state. The URL says `subscription` (what the
   * filter control is called); the query takes this name, the same rename
   * `tier` → `loyaltyTier` has always used.
   */
  emailSubscription: z
    .enum([
      "not_subscribed",
      "pending",
      "subscribed",
      "unsubscribed",
      "invalid",
      "redacted",
    ])
    .optional(),
  tag: z.string().max(50).optional(),
  minSpent: z.coerce.number().min(0).optional(),
  maxSpent: z.coerce.number().min(0).optional(),
});

