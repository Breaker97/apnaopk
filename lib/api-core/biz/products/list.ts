import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/biz/v1/common";
import { ProductList, ProductListQuery } from "@/contracts/mobile/biz/v1/products";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { productScopeFilter, type BizScope } from "@/lib/api-core/biz/scope";
import { defineBizRoute } from "@/lib/api-core/registry";
import { nextPageCursor, pageFromCursor } from "@/lib/api-core/shop/page-cursor";
import { fetchAdminProductList } from "@/lib/catalog/product-list";
import { connectDB } from "@/lib/db";
import { findBarcodeCandidates } from "@/lib/pos/barcode-candidates";
import { resolvePOSBarcodeMatch, type POSLookupProduct } from "@/lib/pos/barcode-lookup";
import { escapeRegExp } from "@/lib/strings";
import { fetchVendorProductList } from "@/lib/vendors/vendor-product-list";
import { Vendor } from "@/models";
import { toProductListItem, type ProductDocument, type ProductDtoContext } from "./dto";
import { productTaxonomyNarrowing } from "./filters";
import { productDtoContext } from "./load";

/**
 * GET /products: the operator's catalogue, newest first, through the readers
 * the dashboards use (a seller's own list, the store's list in the staff
 * member's scope), so the app and the website list the same products for the
 * same search. `barcode` finds what the point of sale's scan finds, in scope.
 * The category, brand and collection filters are ./filters.ts.
 */
export const productListRoute = defineBizRoute({
  id: "products.list",
  method: "GET",
  path: "/products",
  auth: "user",
  ...BIZ_ACCESS.VIEW_PRODUCTS,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:products:read", preset: "lenient" },
  input: ProductListQuery,
  output: ProductList,
  handler: async ({ input, scope }) => {
    await connectDB();
    const ctx = await productDtoContext(scope);
    if (input.barcode) {
      const items = await scannedProducts(input.barcode, scope, input.status);
      return { items: (await withVendorNames(items, ctx)).map((p) => toProductListItem(p, ctx)), nextCursor: null };
    }

    const page = pageFromCursor(input.cursor);
    const params = {
      page,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
      // The web's readers take the search regex-escaped, as SafeSearchSchema sends it.
      search: input.search ? escapeRegExp(input.search) : undefined,
      status: input.status,
      lowStock: input.lowStock,
      narrowing: await productTaxonomyNarrowing(input),
    };
    const list =
      scope.kind === "vendor"
        ? await fetchVendorProductList(params, scope.vendorId)
        : await fetchAdminProductList(params, {
            staffScope: scope.kind === "staff" ? scope.staff : null,
            isMultiVendor: ctx.multiVendor,
            vendorOptions: false,
          });
    return {
      items: (list.items as ProductDocument[]).map((product) => toProductListItem(product, ctx)),
      nextCursor: nextPageCursor(page, list.totalPages),
    };
  },
});

const SCAN_FIELDS =
  "name sku skuNormalized barcode barcodeNormalized status images media price priceRange priceOnRequest stock shipping.isPhysicalProduct inventory vendorId variants._id variants.sku variants.skuNormalized variants.barcode variants.barcodeNormalized variants.price variants.stock";

/** The products carrying a scanned code, as the register reads it, in scope. */
async function scannedProducts(
  code: string,
  scope: BizScope,
  status: string | undefined,
): Promise<ProductDocument[]> {
  const candidates = await findBarcodeCandidates<ProductDocument & POSLookupProduct>(code, {
    filter: { ...productScopeFilter(scope), ...(status ? { status } : {}) },
    select: SCAN_FIELDS,
  });
  const result = resolvePOSBarcodeMatch(candidates, code);
  if (result.status === "none") return [];
  const matched = result.status === "matched" ? [result.match] : result.matches;
  const seen = new Set<string>();
  return matched
    .map((match) => match.product)
    .filter((product) => {
      const id = String(product._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

/** Sellers' names for a few products found without the list reader's join. */
async function withVendorNames(products: ProductDocument[], ctx: ProductDtoContext): Promise<ProductDocument[]> {
  if (!ctx.showVendor || products.length === 0) return products;
  const ids = [...new Set(products.map((product) => String(product.vendorId ?? "")).filter(Boolean))];
  const vendors = await Vendor.find({ _id: { $in: ids } })
    .select("storeName")
    .lean<Array<{ _id: unknown; storeName?: string }>>();
  const byId = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));
  return products.map((product) => ({ ...product, vendorId: byId.get(String(product.vendorId)) ?? product.vendorId }));
}
