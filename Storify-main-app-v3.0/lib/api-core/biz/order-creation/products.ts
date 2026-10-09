import { Types } from "mongoose";
import type { OrderProductSelector, OrderProductSelectorQuery, OrderProductSelectors } from "@/contracts/mobile/biz/v1/order-creation";
import { Product } from "@/models/product.model";
import { productScopeFilter, staffLocationIds } from "@/lib/api-core/biz/scope";
import { toMoney } from "@/lib/api-core/shop/money";
import { imageSet } from "@/lib/api-core/shop/images";
import { pageFromCursor, nextPageCursor } from "@/lib/api-core/shop/page-cursor";
import { escapeRegExp } from "@/lib/strings";
import { productTracksStock, productAllowsOversell } from "@/lib/products/stock-policy";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { findBarcodeCandidates } from "@/lib/pos/barcode-candidates";
import type { ResolvedAdminOrderLine } from "@/lib/orders/create-admin-order";
import { creationProductOwner, loadCreationOptions } from "./options";
import { assertCanCreate, creationRefusal, type CreationContext, type CreationSession } from "./policy";

type CreationProduct = Omit<ResolvedAdminOrderLine["product"], "variants"> & {
  _id: Types.ObjectId; updatedAt?: Date; barcode?: string; status?: string; priceOnRequest?: boolean;
  shipping?: { isPhysicalProduct?: boolean }; inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
  preorder?: { enabled?: boolean }; locationInventory?: Array<{ locationId?: unknown; quantity?: number }>;
  variants?: Array<NonNullable<ResolvedAdminOrderLine["product"]["variants"]>[number] & {
    barcode?: string; preorder?: { enabled?: boolean }; locationInventory?: Array<{ locationId?: unknown; quantity?: number }>;
  }>;
};
export const CREATION_PRODUCT_FIELDS = "_id name title sku barcode barcodeNormalized skuNormalized status price cost images priceOnRequest shipping inventory preorder.enabled vendorId updatedAt stock locationInventory variants";
type CreationVariant = NonNullable<CreationProduct["variants"]>[number];

/** Exact branch availability, never stock from a different branch as a fallback. */
export function creationAvailability(product: CreationProduct, variant: CreationVariant | undefined, locationId?: string) {
  const item = variant || product;
  const at = item.locationInventory || [];
  if (!productTracksStock(product)) return { available: 999, reason: undefined };
  if (locationId && !at.length) return { available: 0, reason: "LOCATION_NOT_ALLOWED" };
  if (at.length && !locationId) return { available: 0, reason: "LOCATION_NOT_ALLOWED" };
  if (at.length && !at.some((row) => String(row.locationId) === locationId)) return { available: 0, reason: "LOCATION_NOT_ALLOWED" };
  const stock = at.length ? at.find((row) => String(row.locationId) === locationId)?.quantity : item.stock;
  const available = Math.max(0, Math.trunc(Number(stock ?? 0)));
  return { available, reason: !productAllowsOversell(product) && available === 0 ? "INSUFFICIENT_STOCK" : undefined };
}
export function orderability(product: CreationProduct, variant?: NonNullable<CreationProduct["variants"]>[number]): string | undefined {
  if (product.status !== "active" || isQuoteOnlyProduct(product) || product.preorder?.enabled || variant?.preorder?.enabled) return "PRODUCT_NOT_ORDERABLE";
  const price = Number(variant?.price ?? product.price);
  if (!Number.isFinite(price) || price < 0 || !(variant?.sku || product.sku)?.trim()) return "PRODUCT_NOT_ORDERABLE";
  return undefined;
}

export async function loadCreationProducts(context: CreationContext, ids: string[], session: CreationSession = null) {
  if (!ids.every((id) => Types.ObjectId.isValid(id))) creationRefusal("PRODUCT_NOT_ORDERABLE", "Invalid product selection.");
  return Product.find({ $and: [{ _id: { $in: ids } }, productScopeFilter(context.scope)] })
    .select(CREATION_PRODUCT_FIELDS).session(session).lean<CreationProduct[]>();
}

export async function listCreationProducts(context: CreationContext, query: OrderProductSelectorQuery): Promise<OrderProductSelectors> {
  assertCanCreate(context);
  const { options, settings, locations, vendors } = await loadCreationOptions(context);
  if (query.locationId && !locations.some((location) => String(location._id) === query.locationId)) creationRefusal("LOCATION_NOT_ALLOWED", "Location is not available in this workspace.", 403);
  const page = pageFromCursor(query.cursor); const limit = query.limit ?? 20;
  const search = query.search ? { $or: ["name", "title", "sku", "variants.sku"].map((field) => ({ [field]: { $regex: escapeRegExp(query.search!), $options: "i" } })) } : {};
  const filter = { $and: [productScopeFilter(context.scope), search] };
  const rows = query.barcode
    ? await findBarcodeCandidates<CreationProduct>(query.barcode, { filter, select: CREATION_PRODUCT_FIELDS })
    : await Product.find(filter).select(CREATION_PRODUCT_FIELDS).sort({ _id: 1 }).skip((page - 1) * limit).limit(limit + 1).lean<CreationProduct[]>();
  const items = rows.slice(0, limit).map((product): OrderProductSelector => {
    const location = locations.find((row) => String(row._id) === query.locationId);
    const owner = creationProductOwner(product, settings, vendors);
    const ownerReason = !owner || (!query.locationId && staffLocationIds(context.scope).length > 0) ||
      (location?.vendorId && String(location.vendorId) !== String(owner._id)) ? "LOCATION_NOT_ALLOWED" : undefined;
    const available = creationAvailability(product, undefined, query.locationId);
    const reason = ownerReason || orderability(product) || available.reason;
    const variants = (product.variants || []).map((variant) => {
      const counted = creationAvailability(product, variant, query.locationId);
      const refusal = ownerReason || orderability(product, variant) || counted.reason;
      return { id: String(variant._id), name: variant.name || "", sku: variant.sku, barcode: variant.barcode,
        price: toMoney(variant.price ?? product.price, options.currency), available: counted.available,
        image: imageSet(variant.image), selectable: !refusal, ...(refusal ? { reason: refusal } : {}) };
    });
    return { id: String(product._id), name: product.title || product.name || "", sku: product.sku,
      vendorName: owner?.storeName, image: imageSet(product.images?.[0]), price: toMoney(product.price, options.currency),
      selectable: variants.length ? variants.some((variant) => variant.selectable) : !reason,
      ...(reason && !variants.some((variant) => variant.selectable) ? { reason } : {}),
      available: variants.length ? variants.reduce((sum, variant) => sum + variant.available, 0) : available.available,
      untracked: !productTracksStock(product), variants };
  });
  return { items, nextCursor: !query.barcode && rows.length > limit ? nextPageCursor(page, page + 1) : null };
}
