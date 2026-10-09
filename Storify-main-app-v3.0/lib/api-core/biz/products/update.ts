import { PRODUCT_REASONS, ProductDetail, ProductUpdateRequest } from "@/contracts/mobile/biz/v1/products";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { bizAppAuditContext } from "@/lib/api-core/biz/audit-context";
import { productScopeFilter } from "@/lib/api-core/biz/scope";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute } from "@/lib/api-core/registry";
import { connectDB, mongoose } from "@/lib/db";
import type { PreorderVendorAccess } from "@/lib/orders/preorder-gating";
import { quickEditProduct } from "@/lib/products/product-quick-edit";
import { Vendor } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { readProductDetail } from "./detail";
import { productNotFound } from "./load";

/**
 * The versions an `If-Match` names: each entity tag with its quotes and weak
 * marker taken off (the `version` and the `ETag` are both accepted). Null
 * when there is none to hold the change to: no header, or `*` (any version
 * at all, which is no protection against a change made in between).
 */
export function ifMatchVersions(header: string | undefined): string[] | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1").trim())
    .filter(Boolean)
    .slice(0, 5);
  return tags.length === 0 || tags.includes("*") ? null : tags;
}

/**
 * PATCH /products/{id}: the price, compare-at price, status or variant
 * prices, held to the version the app read (lib/products/product-quick-edit.ts
 * says what is checked). Answered with the product as it now is, and its new
 * version as the `ETag`.
 */
export const productUpdateRoute = defineBizRoute({
  id: "products.update",
  method: "PATCH",
  path: "/products/{id}",
  auth: "user",
  ...BIZ_ACCESS.EDIT_PRODUCTS,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:products:update", preset: "moderate" },
  demo: "default",
  input: ProductUpdateRequest,
  output: ProductDetail,
  reasons: { values: PRODUCT_REASONS },
  entityTag: (product) => product.version,
  handler: async ({ input, params, scope, workspace, session, client, requestId, locale, defer }) => {
    const versions = ifMatchVersions(client.ifMatch);
    if (!versions) {
      throw new MobileApiError(
        428,
        "PRECONDITION_REQUIRED",
        "Say which version of the product this change is for: send If-Match with its version.",
      );
    }
    if (!mongoose.isValidObjectId(params.id)) throw productNotFound();

    await connectDB();
    const [settings, seller] = await Promise.all([
      getSettingsLean(),
      // A seller is held to the store's pre-order limits, as on their product PUT.
      workspace.kind === "vendor"
        ? Vendor.findById(workspace.vendor.id).select("preorder").lean<PreorderVendorAccess | null>()
        : Promise.resolve(undefined),
    ]);

    await quickEditProduct({
      productId: params.id,
      scopeFilter: productScopeFilter(scope),
      versions,
      changes: input,
      settings,
      seller,
      audit: bizAppAuditContext({
        session,
        client,
        requestId,
        locale,
        method: "PATCH",
        path: `/products/${params.id}`,
      }),
      defer: (task) => defer(task),
    });

    return readProductDetail(params.id, scope);
  },
});
