import {
  ProductEditorDetail,
  ProductEditorFields,
  ProductFormOptions,
  PRODUCT_EDITOR_FIELDS,
} from "@/contracts/mobile/biz/v1/product-editor";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { grantCan } from "@/lib/api-core/biz/access";
import {
  productScopeFilter,
  staffLocationIds,
  type BizScope,
} from "@/lib/api-core/biz/scope";
import { connectDB, mongoose } from "@/lib/db";
import { hasStaffScope } from "@/lib/access/staff-scope";
import { MobileApiError } from "@/lib/api-core/errors";
import {
  adminProductCreateVendorId,
  productStockScope,
  allowedLocationIds,
  storeProfileUnavailable,
} from "@/lib/inventory/inventory-location-scope";
import { ensureDefaultVendorId } from "@/lib/vendors/multi-vendor";
import { checkPlanLimit } from "@/lib/vendors/vendor-limits";
import { buildProductFormOptions } from "@/lib/products/form-options";
import { resolveProductFeatures } from "@/lib/products/product-features";
import { resolveVendorPreorderAccess } from "@/lib/orders/preorder-gating";
import { storeCanCollectDeferredBalance } from "@/lib/payments/deferred-balance";
import { bizUploadPolicy } from "@/lib/api-core/biz/uploads/policy";
import { getStorageConfig } from "@/lib/storage";
import { Product, Vendor, Order } from "@/models";
import { getSettingsLean, type ISettings } from "@/models/settings.model";
import { productNotFound, productDtoContext, locationViewOf } from "./load";
import { productVersion, toProductDetail, toProductListItem } from "./dto";
import { storedEditorMedia } from "./editor-stored-media";
import type { EditorDocument } from "@/lib/products/business-editor";

export async function findEditorProduct(
  id: string,
  scope: BizScope,
): Promise<EditorDocument> {
  if (!mongoose.isValidObjectId(id)) throw productNotFound();
  await connectDB();
  const product = await Product.findOne({
    _id: id,
    ...productScopeFilter(scope),
  })
    .select("+stockAdjustmentReceipts")
    .lean();
  if (!product) throw productNotFound();
  return product;
}

export async function productEditorContext(input: {
  grant: BizWorkspaceGrant;
  scope: BizScope;
  actorId: string;
  product?: EditorDocument;
}) {
  await connectDB();
  let ownerId = input.product?.vendorId
    ? String(input.product.vendorId)
    : input.grant.workspace === "vendor"
      ? input.grant.vendor.id
      : input.grant.kind === "staff"
        ? adminProductCreateVendorId(input.grant.staffScope)
        : null;
  if (!ownerId) {
    if (
      !input.product &&
      input.grant.kind === "staff" &&
      hasStaffScope(input.grant.staffScope)
    )
      throw new MobileApiError(
        403,
        "AUTHORIZATION_ERROR",
        "Staff must be assigned to a vendor before creating products.",
      );
    const house = await ensureDefaultVendorId({
      preferredOwnerId: input.actorId,
    });
    if (!house.vendorId) throw storeProfileUnavailable(house.problem);
    ownerId = house.vendorId;
  }
  const [settings, vendor, locations] = await Promise.all([
    getSettingsLean(),
    Vendor.findById(ownerId).select("planId preorder shipping").lean(),
    allowedLocationIds(
      productStockScope(ownerId, staffLocationIds(input.scope)),
    ),
  ]);
  const features = resolveProductFeatures(settings);
  const limit =
    input.grant.workspace === "vendor"
      ? await checkPlanLimit(ownerId, "products", {
          planId: vendor?.planId ?? null,
          settings: settings as ISettings,
        })
      : null;
  return { ownerId, settings, vendor, locations, features, limit };
}

export function editorWritableFields(
  grant: BizWorkspaceGrant,
  product?: EditorDocument,
): ProductFormOptions["writableFields"] {
  if (!grantCan(grant, product ? "EDIT_PRODUCTS" : "CREATE_PRODUCTS"))
    return [];
  return PRODUCT_EDITOR_FIELDS.filter(
    (field) =>
      !(grant.workspace === "vendor" && field === "featured") &&
      !(product && (field === "stock" || field === "locationInventory")) &&
      !(
        product?.shipping?.isPhysicalProduct !== false &&
        product &&
        ["digitalAssets", "digitalDelivery", "digitalPreview"].includes(field)
      ),
  );
}

export function editorActions(
  grant: BizWorkspaceGrant,
): ProductFormOptions["actions"] {
  return [
    ...(grantCan(grant, "EDIT_PRODUCTS")
      ? (["set_active", "set_draft", "set_unlisted"] as const)
      : []),
    ...(grantCan(grant, "DELETE_PRODUCTS") ? (["delete"] as const) : []),
  ];
}

export async function readProductFormOptions(input: {
  grant: BizWorkspaceGrant;
  scope: BizScope;
  actorId: string;
  productId?: string;
}): Promise<ProductFormOptions> {
  const product = input.productId
    ? await findEditorProduct(input.productId, input.scope)
    : undefined;
  const context = await productEditorContext({ ...input, product });
  const deferredBalanceSupported = storeCanCollectDeferredBalance(
    context.settings.payment,
  );
  const preorder = resolveVendorPreorderAccess(
    context.settings.preorder,
    input.grant.workspace === "vendor"
      ? context.vendor
      : { preorder: { enabled: true } },
  );
  const options = await buildProductFormOptions({
    includeInactiveCategories: input.grant.kind === "admin",
    vendorShipping: context.vendor?.shipping,
    scope: productStockScope(context.ownerId, staffLocationIds(input.scope)),
    deferredBalanceSupported,
  });
  const storage = await getStorageConfig();
  return ProductFormOptions.parse({
    currency: (await productDtoContext(input.scope)).currency.code,
    formats: [
      ...(context.features.physical ? ["physical"] : []),
      ...(context.features.digital ? ["digital"] : []),
    ],
    descriptionFormat: "html",
    features: context.features,
    writableFields: editorWritableFields(input.grant, product),
    actions: product ? editorActions(input.grant) : [],
    categories: options.categories.map((row) => ({
      id: row._id,
      name: row.name,
      path: row.path,
      isLeaf: row.isLeaf,
      options: row.options,
    })),
    brands: options.brands.map((row) => ({ id: row._id, name: row.name })),
    collections: options.collections.map((row) => ({
      id: row._id,
      title: row.title,
    })),
    locations: options.locations.map((row) => ({
      id: row._id,
      name: row.name,
      isDefault: row.isDefault,
    })),
    shipping: options.shipping,
    preorder: {
      ...preorder,
      ...(preorder.blockedBy
        ? { blockedBy: preorder.blockedBy }
        : { blockedBy: undefined }),
      deferredBalanceSupported,
    },
    limits: {
      media: 250,
      variants: 250,
      digitalAssets: 20,
      ...(context.limit?.limit != null
        ? {
            productsRemaining: Math.max(
              0,
              context.limit.limit - context.limit.current,
            ),
          }
        : {}),
    },
    uploads: [
      bizUploadPolicy("product_media", storage),
      ...(context.features.digital ||
      product?.shipping?.isPhysicalProduct === false
        ? [
            bizUploadPolicy("digital_asset", storage),
            bizUploadPolicy("digital_preview", storage),
          ]
        : []),
    ],
  });
}

const jsonValue = (value: unknown) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const optionValues = (values: EditorDocument[]) =>
  values.map(({ _id, ...value }) => ({ ...value, id: String(_id) }));

/**
 * A stored inventory policy as the editor's contract states it: both flags
 * present. Older and imported products can hold a partial one (`tracked`
 * missing), which the schema refused with a 500; read it as the stock policy
 * does (lib/products/stock-policy.ts: tracked unless `false`) and as the
 * model defaults the rest.
 */
const editorInventory = (inventory: EditorDocument) => ({
  tracked: inventory.tracked !== false,
  continueSellingWhenOutOfStock:
    inventory.continueSellingWhenOutOfStock === true,
});

/** Private keys, live reservation counters and unassigned locations never enter editor answers. */
export function toEditorValues(
  product: EditorDocument,
  scope: BizScope,
): ProductEditorFields {
  const values: EditorDocument = {};
  for (const key of PRODUCT_EDITOR_FIELDS)
    if (product[key] !== undefined) values[key] = jsonValue(product[key]);
  const assigned = staffLocationIds(scope);
  const visible = (row: EditorDocument) =>
    !assigned.length || assigned.includes(String(row.locationId));
  if (values.locationInventory)
    values.locationInventory = values.locationInventory.filter(visible);
  if (values.category)
    values.category = String(product.category?._id || product.category);
  if (values.brand) values.brand = String(product.brand?._id || product.brand);
  if (values.options)
    values.options = values.options.map(
      ({ _id, values: entries, ...option }: EditorDocument) => ({
        ...option,
        id: String(_id),
        values: optionValues(entries || []),
      }),
    );
  if (values.variants)
    values.variants = values.variants.map(
      ({ _id, ...variant }: EditorDocument) => ({
        ...variant,
        id: String(_id),
        locationInventory: (variant.locationInventory || []).filter(visible),
      }),
    );
  if (product.media || product.images)
    values.media = storedEditorMedia(product).map(
      ({ _id, ...media }: EditorDocument) => ({
        ...media,
        id: String(_id),
      }),
    );
  if (values.digitalAssets)
    values.digitalAssets = values.digitalAssets.map(
      ({ _id, storageKey: _private, ...asset }: EditorDocument) => ({
        ...asset,
        id: String(_id),
      }),
    );
  if (values.preorder)
    values.preorder.enabled = values.preorder.enabled === true;
  if (values.inventory) values.inventory = editorInventory(values.inventory);
  for (const variant of values.variants || []) {
    if (variant.preorder)
      variant.preorder.enabled = variant.preorder.enabled === true;
    if (variant.inventory)
      variant.inventory = editorInventory(variant.inventory);
  }
  return ProductEditorFields.parse(values);
}

export async function readProductEditor(
  id: string,
  scope: BizScope,
  grant: BizWorkspaceGrant,
): Promise<ProductEditorDetail> {
  const [product, context] = await Promise.all([
    findEditorProduct(id, scope),
    productDtoContext(scope),
  ]);
  const productDetail = toProductDetail(
    product as never,
    context,
    await locationViewOf(product as never, scope),
  );
  const summary = toProductListItem(product as never, context);
  const historicalOrders = await Order.countDocuments({
    "items.productId": id,
  });
  return ProductEditorDetail.parse({
    id,
    version: productVersion(product.updatedAt),
    values: toEditorValues(product, scope),
    product: productDetail,
    writableFields: editorWritableFields(grant, product),
    actions: editorActions(grant),
    pricing: { price: summary.price, maxPrice: summary.maxPrice },
    dependencies: historicalOrders
      ? [
          {
            kind: "orders",
            count: historicalOrders,
            message: "PRODUCT_HAS_DEPENDENCIES",
          },
        ]
      : [],
  });
}
