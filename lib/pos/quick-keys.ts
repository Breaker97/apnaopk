import "server-only";

import { Types } from "mongoose";
import { PosQuickKeys, type IPosQuickKeys } from "@/models/pos-quick-keys.model";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { canApplyPosDiscount } from "@/lib/access/rbac";
import { listPOSProducts } from "@/lib/pos/list-products";
import { registerVendorScope, type SessionUser } from "@/lib/pos/register-session";
import type { POSProduct } from "@/components/pos/pos-types";

/**
 * Quick keys: the products a till shows first, set by whoever manages the POS
 * (the same seats that may give discounts) and shared by every register of
 * the merchant. Products are read back through the register's own catalogue
 * query, so a key never shows a product this till may not sell — one that
 * was archived, made "price on request", or belongs to another merchant.
 */

export const MAX_QUICK_KEYS = 60;

const listUser = (user: SessionUser) => ({
  id: user.id,
  role: String(user.role ?? ""),
  roles: (user.roles ?? []).filter((role): role is string => Boolean(role)),
});

export async function canManageQuickKeys(user: SessionUser): Promise<boolean> {
  return canApplyPosDiscount({
    id: user.id,
    role: user.role ?? undefined,
    roles: (user.roles ?? undefined) as string[] | undefined,
  });
}

/** This merchant's quick keys, as products this register may sell, in order. */
export async function readQuickKeys(
  user: SessionUser,
  locationId?: string,
): Promise<{ productIds: string[]; products: POSProduct[]; canEdit: boolean }> {
  const vendorId = await registerVendorScope(user);
  const row = await PosQuickKeys.findOne({ vendorId }).lean<IPosQuickKeys | null>();
  const productIds = (row?.keys ?? []).map((key) => String(key.productId));
  const [listing, canEdit] = await Promise.all([
    productIds.length
      ? listPOSProducts(listUser(user), { ids: productIds, locationId: locationId || "" })
      : Promise.resolve({ products: [] as POSProduct[] }),
    canManageQuickKeys(user),
  ]);
  const byId = new Map(listing.products.map((product) => [String(product._id), product]));
  const products = productIds.map((id) => byId.get(id)).filter((product): product is POSProduct => Boolean(product));
  return { productIds: products.map((product) => String(product._id)), products, canEdit };
}

/** Replace this merchant's quick keys (a manager only). */
export async function saveQuickKeys(user: SessionUser, productIds: string[]): Promise<string[]> {
  if (!(await canManageQuickKeys(user))) {
    throw new AuthorizationError("Only a seat that manages the POS can change the quick keys");
  }
  const unique = [...new Set(productIds.map((id) => String(id).trim()))];
  if (unique.length > MAX_QUICK_KEYS) {
    throw new ValidationError(`A till holds up to ${MAX_QUICK_KEYS} quick keys`);
  }
  if (unique.some((id) => !Types.ObjectId.isValid(id))) {
    throw new ValidationError("A quick key names a product that does not exist");
  }
  const vendorId = await registerVendorScope(user);
  // Only products this register may sell: the catalogue query is the judge.
  const { products } = unique.length
    ? await listPOSProducts(listUser(user), { ids: unique })
    : { products: [] as POSProduct[] };
  const sellable = new Set(products.map((product) => String(product._id)));
  const kept = unique.filter((id) => sellable.has(id));
  await PosQuickKeys.updateOne(
    { vendorId },
    { $set: { keys: kept.map((id) => ({ productId: new Types.ObjectId(id) })), updatedBy: user.id } },
    { upsert: true },
  );
  return kept;
}
