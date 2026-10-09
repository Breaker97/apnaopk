import { MobileApiError } from "@/lib/api-core/errors";
import { productScopeFilter, staffLocationIds, type BizScope } from "@/lib/api-core/biz/scope";
import { resolveCurrency } from "@/lib/intl/currencies";
import { connectDB, mongoose } from "@/lib/db";
import { getStoreFacts } from "@/lib/storefront/store-facts";
import { InventoryLocation } from "@/models/inventory-location.model";
import { Product } from "@/models";
import type { LocationView, ProductDocument, ProductDtoContext } from "./dto";
import { stockLocationIds } from "./dto";

/**
 * What the product endpoints share: the product in the operator's scope, and
 * the store facts and location names their answers need.
 */

export function productNotFound(): MobileApiError {
  return new MobileApiError(404, "NOT_FOUND", "Product not found.");
}

/** The product, when it is in scope; 404 for one that is not, as for one that does not exist. */
export async function findScopedProduct(
  id: string,
  scope: BizScope,
  options: { vendorName?: boolean } = {},
): Promise<ProductDocument> {
  if (!mongoose.isValidObjectId(id)) throw productNotFound();
  await connectDB();
  const query = Product.findOne({ _id: id, ...productScopeFilter(scope) }).select(
    "-description -shortDescription -seo -attributes -search",
  );
  if (options.vendorName) query.populate("vendorId", "storeName");
  const product = await query.lean<ProductDocument | null>();
  if (!product) throw productNotFound();
  return product;
}

/** The currency, and whether the answer names each product's seller. */
export async function productDtoContext(scope: BizScope): Promise<ProductDtoContext & { multiVendor: boolean }> {
  const facts = await getStoreFacts();
  const storeSide = scope.kind === "store" || (scope.kind === "staff" && !scope.vendorOwned);
  return {
    currency: resolveCurrency(facts.currencyCode),
    multiVendor: facts.multiVendor,
    showVendor: facts.multiVendor && storeSide,
  };
}

/** The names of the locations a product's stock is at, and which of them this operator sees. */
export async function locationViewOf(product: ProductDocument, scope: BizScope): Promise<LocationView> {
  const ids = stockLocationIds(product).filter((id) => mongoose.isValidObjectId(id));
  const rows = ids.length
    ? await InventoryLocation.find({ _id: { $in: ids } })
        .select("name")
        .lean<Array<{ _id: unknown; name?: string }>>()
    : [];
  const assigned = staffLocationIds(scope);
  return {
    names: new Map(rows.map((row) => [String(row._id), row.name ?? ""])),
    visible: (locationId) => assigned.length === 0 || assigned.includes(locationId),
  };
}
