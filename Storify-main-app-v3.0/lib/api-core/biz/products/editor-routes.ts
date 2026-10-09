import {
  ProductCreateRequest,
  ProductSaveRequest,
  ProductEditorActionRequest,
  ProductEditorDetail,
  ProductEditorResult,
  ProductFormOptions,
  ProductFormOptionsQuery,
  ProductVariantGenerateRequest,
  ProductVariantGeneration,
  PRODUCT_EDITOR_REASONS,
} from "@/contracts/mobile/biz/v1/product-editor";
import { BizUploadAccess } from "@/contracts/mobile/biz/v1/uploads";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { bizAppAuditContext } from "@/lib/api-core/biz/audit-context";
import {
  defineBizRoute,
  type BizHandlerContext,
} from "@/lib/api-core/registry";
import { generateEditorVariants } from "@/lib/products/business-editor";
import { getStorageService } from "@/lib/storage";
import {
  readProductEditor,
  readProductFormOptions,
  findEditorProduct,
} from "./editor-read";
import { writeProductEditor } from "./editor-write";
import { productNotFound } from "./load";

function context(
  ctx: BizHandlerContext<unknown, string, "any">,
  method: string,
  path: string,
) {
  return {
    actorId: ctx.session.user.id,
    grant: ctx.workspace,
    scope: ctx.scope,
    key: ctx.client.idempotencyKey,
    ifMatch: ctx.client.ifMatch,
    audit: bizAppAuditContext({
      ...ctx,
      method,
      path,
      ...(ctx.workspace.workspace === "vendor"
        ? { vendorId: ctx.workspace.vendor.id }
        : {}),
    }),
    defer: (task: () => Promise<unknown>) => ctx.defer(task),
  };
}

export const productFormOptionsRoute = defineBizRoute({
  auth: "user",
  ...BIZ_ACCESS.VIEW_PRODUCTS,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:products:editor:read", preset: "lenient" },
  id: "products.form-options",
  method: "GET",
  path: "/products/form-options",
  input: ProductFormOptionsQuery,
  output: ProductFormOptions,
  handler: async (ctx) =>
    readProductFormOptions({
      grant: ctx.workspace,
      scope: ctx.scope,
      actorId: ctx.session.user.id,
      productId: ctx.input.productId,
    }),
});
export const productEditorDetailRoute = defineBizRoute({
  auth: "user",
  ...BIZ_ACCESS.VIEW_PRODUCTS,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:products:editor:read", preset: "lenient" },
  id: "products.editor.detail",
  method: "GET",
  path: "/products/{id}/editor",
  output: ProductEditorDetail,
  entityTag: (result) => result.version,
  handler: async (ctx) =>
    readProductEditor(ctx.params.id, ctx.scope, ctx.workspace),
});
export const productCreateRoute = defineBizRoute({
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:products:editor:write", preset: "moderate" },
  demo: "default",
  idempotency: "required",
  durable: true,
  reasons: { values: PRODUCT_EDITOR_REASONS },
  ...BIZ_ACCESS.CREATE_PRODUCTS,
  id: "products.create",
  method: "POST",
  path: "/products",
  status: 201,
  input: ProductCreateRequest,
  output: ProductEditorResult,
  handler: async (ctx) =>
    writeProductEditor(
      { kind: "create", input: ctx.input },
      context(ctx, "POST", "/products"),
    ),
});
export const productEditorSaveRoute = defineBizRoute({
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:products:editor:write", preset: "moderate" },
  demo: "default",
  idempotency: "required",
  durable: true,
  reasons: { values: PRODUCT_EDITOR_REASONS },
  ...BIZ_ACCESS.EDIT_PRODUCTS,
  id: "products.editor.save",
  method: "PATCH",
  path: "/products/{id}/editor",
  input: ProductSaveRequest,
  output: ProductEditorResult,
  handler: async (ctx) =>
    writeProductEditor(
      { kind: "save", id: ctx.params.id, input: ctx.input },
      context(ctx, "PATCH", `/products/${ctx.params.id}/editor`),
    ),
});
// The action handler checks EDIT or DELETE for its selected action, rather than requiring both.
export const productEditorActionRoute = defineBizRoute({
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:products:editor:write", preset: "moderate" },
  demo: "default",
  idempotency: "required",
  durable: true,
  reasons: { values: PRODUCT_EDITOR_REASONS },
  ...BIZ_ACCESS.workspace,
  id: "products.editor.action",
  method: "POST",
  path: "/products/{id}/actions",
  input: ProductEditorActionRequest,
  output: ProductEditorResult,
  handler: async (ctx) =>
    writeProductEditor(
      { kind: "action", id: ctx.params.id, input: ctx.input },
      context(ctx, "POST", `/products/${ctx.params.id}/actions`),
    ),
});
export const productVariantGenerateRoute = defineBizRoute({
  auth: "user",
  ...BIZ_ACCESS.VIEW_PRODUCTS,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:products:editor:read", preset: "lenient" },
  ...BIZ_ACCESS.EDIT_PRODUCTS,
  id: "products.variants.generate",
  method: "POST",
  path: "/products/variants/generate",
  input: ProductVariantGenerateRequest,
  output: ProductVariantGeneration,
  demo: "default",
  handler: async (ctx) => generateEditorVariants(ctx.input),
});
export const productDigitalAssetRoute = defineBizRoute({
  auth: "user",
  ...BIZ_ACCESS.VIEW_PRODUCTS,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:products:editor:read", preset: "lenient" },
  id: "products.digital-assets.access",
  method: "GET",
  path: "/products/{id}/digital-assets/{assetId}",
  output: BizUploadAccess,
  handler: async (ctx) => {
    const product = await findEditorProduct(ctx.params.id, ctx.scope);
    const asset = product.digitalAssets?.find(
      (item: { _id: unknown }) => String(item._id) === ctx.params.assetId,
    );
    if (!asset?.storageKey) throw productNotFound();
    const result = await (
      await getStorageService()
    ).getPrivateDownload(asset.storageKey, {
      expiresInSeconds: 300,
      filename: asset.filename,
      disposition: "attachment",
    });
    if (result.kind !== "redirect") throw productNotFound();
    return {
      url: result.url,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  },
});

/** Integrator adds these to the shared business route registry. */
export const productEditorRoutes = [
  productFormOptionsRoute,
  productEditorDetailRoute,
  productCreateRoute,
  productEditorSaveRoute,
  productEditorActionRoute,
  productVariantGenerateRoute,
  productDigitalAssetRoute,
] as const;
