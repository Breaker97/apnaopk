import { Product } from "@/models";
import {
  buildStaffProductScopeFilter,
  hasStaffScope,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";

/**
 * Staff limited to vendors or locations see and moderate only the reviews of
 * products inside that scope — the same product scope the products screen
 * applies.
 *
 * The review routes checked the permission and nothing else, so a vendor could
 * hand its own staff `edit_reviews` and let them edit or delete any review on
 * the marketplace, competitors' included. Admins and unscoped platform staff
 * are unaffected.
 */
export async function staffReviewScopeFilter(
  scope?: StaffAccessScope | null,
): Promise<Record<string, unknown>> {
  const productIds = await staffScopedProductIds(scope);
  return productIds ? { productId: { $in: productIds } } : {};
}

/**
 * The products inside a staff member's scope, or null when the caller is not
 * scoped and every product is in reach.
 */
export async function staffScopedProductIds(
  scope?: StaffAccessScope | null,
): Promise<unknown[] | null> {
  if (!hasStaffScope(scope)) return null;
  return Product.distinct("_id", buildStaffProductScopeFilter(scope));
}

/** Whether one review's product is inside the scope. */
export async function isReviewInStaffScope(
  productId: unknown,
  scope?: StaffAccessScope | null,
): Promise<boolean> {
  if (!hasStaffScope(scope)) return true;
  const id =
    productId && typeof productId === "object" && "_id" in productId
      ? (productId as { _id: unknown })._id
      : productId;
  if (!id) return false;
  const inScope = await Product.exists(
    mergeScopeFilter({ _id: id }, buildStaffProductScopeFilter(scope)),
  );
  return Boolean(inScope);
}
