import { z } from "zod";

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
});

export const CustomerListQuerySchema = AdminListQuerySchema.extend({
  loyaltyTier: z.enum(["bronze", "silver", "gold", "platinum"]).optional(),
  tag: z.string().max(50).optional(),
  minSpent: z.coerce.number().min(0).optional(),
  maxSpent: z.coerce.number().min(0).optional(),
});

