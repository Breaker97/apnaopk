import { createHash } from "node:crypto";
import type {
  ProductCreateRequest,
  ProductSaveRequest,
  ProductEditorActionRequest,
  ProductEditorResult,
  ProductEditorFields,
} from "@/contracts/mobile/biz/v1/product-editor";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { assertCapability } from "@/lib/api-core/biz/access";
import { productScopeFilter, type BizScope } from "@/lib/api-core/biz/scope";
import {
  bizOperationBinding,
  runDurableBizOperation,
  DefiniteOperationFailure,
  type BizOperationExecution,
  type OperationResourceRef,
} from "@/lib/api-core/biz/durable-operation";
import { mongoBizOperationStore } from "@/lib/api-next/biz-operation-store";
import { MobileApiError } from "@/lib/api-core/errors";
import { ApiError } from "@/lib/api/errors";
import type { AuditContext } from "@/lib/audit";
import { connectDB, mongoose } from "@/lib/db";
import { runTransaction } from "@/lib/db-transaction";
import { Product, Order, Brand, Collection, Category } from "@/models";
import {
  BizProductWrite,
  BizProductOwnerLock,
} from "@/models/biz-product-write.model";
import { syncProductCategory } from "@/lib/catalog/categories";
import { removeProductFromAllCollections } from "@/lib/catalog/collections";
import {
  auditCatalogCreate,
  auditCatalogDelete,
  PRODUCT_AUDIT,
} from "@/lib/catalog/catalog-audit";
import { assertProductFeaturesAllowed } from "@/lib/products/product-features";
import { assertProductPreorderAllowed } from "@/lib/orders/preorder-gating";
import { storeCanCollectDeferredBalance } from "@/lib/payments/deferred-balance";
import { isProductFormatChange } from "@/lib/catalog/product-shipping";
import {
  productSlugBase,
  uniqueProductSlug,
} from "@/lib/products/product-slug";
import {
  assignMissingProductBarcodes,
  extractClearedProductFields,
} from "@/lib/products/sanitize";
import { assignProductLookupCodes } from "@/lib/products/barcode-normalization";
import { assertProductBarcodesAreUnique } from "@/lib/products/barcode-validation";
import {
  syncProductBarcodeRegistry,
  releaseProductBarcodeRegistry,
} from "@/lib/products/barcode-registry";
import { runProductAfterSave } from "@/lib/products/product-after-save";
import { cleanupDeletedProductReferences } from "@/lib/products/product-cleanup";
import { deleteProductDigitalFiles } from "@/lib/products/digital-assets";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import {
  normalizeEditorChanges,
  editorRefusal,
  type EditorDocument,
} from "@/lib/products/business-editor";
import { releaseTermsChanged } from "@/lib/products/preorder-counters";
import { resolveEditorMedia } from "./editor-media";
import {
  editorWritableFields,
  findEditorProduct,
  productEditorContext,
  readProductEditor,
  toEditorValues,
} from "./editor-read";
import { productVersion } from "./dto";
import { productNotFound } from "./load";
import { ifMatchVersions } from "./update";

interface WriteContext {
  actorId: string;
  grant: BizWorkspaceGrant;
  scope: BizScope;
  key?: string;
  ifMatch?: string;
  audit: AuditContext;
  defer: (task: () => Promise<unknown>) => void;
}
type Intent =
  | { kind: "create"; input: ProductCreateRequest }
  | { kind: "save"; id: string; input: ProductSaveRequest }
  | { kind: "action"; id: string; input: ProductEditorActionRequest };

/** Cleanup is resumable from the committed domain receipt, never from a client snapshot. */
async function finalizeProductWrite(
  receipt: EditorDocument,
  context: WriteContext,
) {
  if (receipt.finalized) return;
  const id = String(receipt.productId);
  if (receipt.kind === "delete") {
    await removeProductFromAllCollections(id);
    if (receipt.before.category)
      await syncProductCategory(String(receipt.before.category), null);
    await cleanupDeletedProductReferences(id, { strict: true });
    await deleteProductDigitalFiles(receipt.before.digitalAssets, {
      strict: true,
    });
    await auditCatalogDelete(context.audit, PRODUCT_AUDIT, receipt.before);
    revalidateProductContent({ slugs: [receipt.before.slug] });
  } else {
    await runProductAfterSave({
      productId: id,
      before: receipt.before || {},
      after: receipt.after,
      savedStatus: receipt.after.status,
      audit: context.audit,
      defer: context.defer,
      strictCleanup: true,
    });
    if (receipt.kind === "create")
      await auditCatalogCreate(context.audit, PRODUCT_AUDIT, receipt.after);
  }
  await BizProductWrite.updateOne(
    { operationId: receipt.operationId },
    { $set: { finalized: true } },
  );
}

async function assertTaxonomy(
  changes: EditorDocument,
  before?: EditorDocument,
) {
  if (
    changes.category &&
    String(changes.category) !== String(before?.category || "")
  ) {
    if (
      !mongoose.isValidObjectId(changes.category) ||
      !(await Category.exists({ _id: changes.category }))
    )
      editorRefusal(
        "PRODUCT_FIELD_NOT_ALLOWED",
        "Select an existing category.",
        "category",
      );
  }
  if (
    changes.brand &&
    (!mongoose.isValidObjectId(changes.brand) ||
      !(await Brand.exists({ _id: changes.brand })))
  )
    editorRefusal(
      "PRODUCT_FIELD_NOT_ALLOWED",
      "Select an existing brand.",
      "brand",
    );
  if (changes.collectionIds) {
    if (
      changes.collectionIds.some(
        (id: string) => !mongoose.isValidObjectId(id),
      ) ||
      new Set(changes.collectionIds).size !== changes.collectionIds.length ||
      (await Collection.countDocuments({
        _id: { $in: changes.collectionIds },
      })) !== changes.collectionIds.length
    )
      editorRefusal(
        "PRODUCT_FIELD_NOT_ALLOWED",
        "Select existing collections once each.",
        "collectionIds",
      );
  }
}

/** Full writes retain domain receipts indefinitely. No stock/order effect is inferred from response loss. */
export async function writeProductEditor(
  intent: Intent,
  context: WriteContext,
): Promise<ProductEditorResult> {
  await connectDB();
  const deleting = intent.kind === "action" && intent.input.action === "delete";
  assertCapability(
    context.grant,
    intent.kind === "create"
      ? "CREATE_PRODUCTS"
      : deleting
        ? "DELETE_PRODUCTS"
        : "EDIT_PRODUCTS",
  );
  const versions =
    intent.kind === "create" ? null : ifMatchVersions(context.ifMatch);
  if (intent.kind !== "create" && !versions)
    throw new MobileApiError(
      428,
      "PRECONDITION_REQUIRED",
      "Send If-Match with the product version.",
    );
  const createContext =
    intent.kind === "create"
      ? await productEditorContext({
          grant: context.grant,
          scope: context.scope,
          actorId: context.actorId,
        })
      : undefined;
  const binding = bizOperationBinding({
    actorId: context.actorId,
    workspace: context.grant,
    key: context.key,
    routeId:
      intent.kind === "create"
        ? "products.create"
        : intent.kind === "save"
          ? "products.editor.save"
          : "products.editor.action",
    target: intent.kind === "create" ? intent.input.draftId : intent.id,
    payload: {
      input: intent.input,
      versions,
      ...(createContext ? { ownerId: createContext.ownerId } : {}),
    },
  });
  const productId =
    intent.kind === "create"
      ? createHash("sha256")
          .update(`${binding.actorId}:${binding.key}`)
          .digest("hex")
          .slice(0, 24)
      : intent.id;
  if (!mongoose.isValidObjectId(productId)) throw productNotFound();
  const refs: OperationResourceRef[] = [{ kind: "product", id: productId }];
  const authorize = async (resources: readonly OperationResourceRef[]) => {
    if (intent.kind !== "create" || resources.length) {
      const exists = await Product.exists({
        _id: productId,
        ...productScopeFilter(context.scope),
      });
      if (!exists) {
        if (
          intent.kind === "create" &&
          !(await Product.exists({ _id: productId })) &&
          !(await BizProductWrite.exists({ productId }))
        )
          return;
        // A deleted result is authorized against its durable scoped tombstone.
        const tombstone = deleting
          ? await BizProductWrite.findOne({
              productId,
              kind: "delete",
            }).lean<EditorDocument | null>()
          : null;
        if (
          !tombstone ||
          !(await BizProductWrite.exists({
            _id: tombstone._id,
            ...deletedReceiptScope(context.scope),
          }))
        )
          throw productNotFound();
      }
    }
  };
  try {
    const result = await runDurableBizOperation<{
      id: string;
      deleted: boolean;
    }>({
      binding,
      store: mongoBizOperationStore,
      authorize,
      reconcile: async (operation) => {
        const receipt = await BizProductWrite.findOne({
          operationId: operation.id,
        }).lean<EditorDocument | null>();
        if (!receipt) return { state: "not_applied" };
        await finalizeProductWrite(receipt, context);
        return {
          state: "succeeded",
          data: { id: productId, deleted: receipt.kind === "delete" },
          resources: refs,
        };
      },
      execute: async (operation: BizOperationExecution) => {
        const before =
          intent.kind === "create"
            ? undefined
            : await findEditorProduct(productId, context.scope);
        if (before && !versions!.includes(productVersion(before.updatedAt)))
          throw new DefiniteOperationFailure({
            status: 412,
            code: "CONFLICT",
            reason: "PRODUCT_CHANGED",
            message: "The product changed. Reload it before saving.",
          });
        const config =
          createContext ||
          (await productEditorContext({
            grant: context.grant,
            scope: context.scope,
            actorId: context.actorId,
            product: before,
          }));
        await operation.remember({ productId, writeKind: intent.kind, ...(intent.kind === "action" ? { action: intent.input.action } : {}) }, refs);
        let changes: EditorDocument = {};
        // Every known refusal here precedes effects; DB/network failures remain unknown.
        try {
          if (!deleting) {
            if (
              intent.kind === "create" &&
              (await BizProductWrite.exists({
                createDraftKey: `${context.actorId}:${binding.workspaceId}:${intent.input.draftId}`,
              }))
            )
              editorRefusal(
                "PRODUCT_HAS_DEPENDENCIES",
                "This draft has already created a product. Open that product to edit it.",
                "draftId",
              );
            const values: Partial<ProductEditorFields> =
              intent.kind === "create"
                ? intent.input.values
                : intent.kind === "save"
                  ? intent.input.changes
                  : {
                      status:
                        intent.input.action === "set_active"
                          ? "active"
                          : intent.input.action === "set_draft"
                            ? "draft"
                            : "unlisted",
                    };
            const allowed = editorWritableFields(context.grant, before);
            for (const field of Object.keys(values))
              if (
                !allowed.includes(field as never) &&
                !["stock", "locationInventory"].includes(field)
              )
                editorRefusal(
                  "PRODUCT_FIELD_NOT_ALLOWED",
                  "This field is not writable in this workspace.",
                  field,
                );
            const resolved = await resolveEditorMedia({
              changes: values,
              before,
              actorId: context.actorId,
              grant: context.grant,
              target:
                intent.kind === "create"
                  ? { kind: "product_draft", id: intent.input.draftId }
                  : { kind: "product", id: productId },
            });
            // Resolve only media fields; normalized domain arrays/counters are retained.
            const normalized = normalizeEditorChanges({
              changes: values,
              before,
              baseline:
                intent.kind === "save" ? intent.input.stockBaseline : undefined,
              locations: config.locations,
            });
            for (const field of [
              "media",
              "images",
              "digitalAssets",
              "digitalPreview",
            ])
              if (field in resolved) normalized[field] = resolved[field];
            changes = normalized;
            if (
              before &&
              isProductFormatChange(before.shipping, changes.shipping)
            )
              editorRefusal(
                "PRODUCT_FORMAT_IMMUTABLE",
                "Product format is fixed after creation.",
                "shipping",
              );
            const physical =
              (changes.shipping?.isPhysicalProduct ??
                before?.shipping?.isPhysicalProduct) !== false;
            if (
              physical &&
              (changes.digitalAssets?.length ||
                changes.digitalPreview ||
                changes.digitalDelivery)
            )
              editorRefusal(
                "PRODUCT_FIELD_NOT_ALLOWED",
                "Digital settings apply only to digital products.",
                "digitalAssets",
              );
            try {
              assertProductFeaturesAllowed({
                features: config.features,
                product: changes,
                stored: before,
              });
            } catch (error) {
              if (error instanceof ApiError)
                editorRefusal("PRODUCT_FEATURE_DISABLED", error.message);
              throw error;
            }
            if (context.grant.workspace === "vendor")
              assertProductPreorderAllowed({
                product: { ...changes, price: changes.price ?? before?.price },
                stored: before,
                policy: config.settings.preorder,
                vendor: config.vendor,
                storeCanCollectBalance: storeCanCollectDeferredBalance(
                  config.settings.payment,
                ),
              });
            await assertTaxonomy(changes, before);
            const options = changes.options || before?.options || [];
            const media = changes.media || before?.media || [];
            for (const variant of changes.variants || before?.variants || []) {
              if (
                variant.mediaId &&
                !media.some(
                  (item: EditorDocument) => item._id === variant.mediaId,
                )
              )
                editorRefusal(
                  "PRODUCT_HAS_DEPENDENCIES",
                  "Clear variant media associations before removing their media.",
                  "media",
                );
              if (changes.variants && variant.mediaId)
                variant.image = media.find(
                  (item: EditorDocument) => item._id === variant.mediaId,
                )?.url;
              for (const value of variant.optionValues || []) {
                const option = options.find((row: EditorDocument) =>
                  value.optionId
                    ? row._id === value.optionId
                    : row.name === value.optionName,
                );
                if (
                  !option ||
                  !option.values.some((row: EditorDocument) =>
                    value.valueId
                      ? row._id === value.valueId && row.value === value.value
                      : row.value === value.value,
                  )
                )
                  editorRefusal(
                    "PRODUCT_FIELD_NOT_ALLOWED",
                    "Variant values must belong to the product options.",
                    "variants",
                  );
              }
            }
            if (before && changes.variants) {
              const ids = new Set(
                changes.variants.map((variant: EditorDocument) =>
                  String(variant._id),
                ),
              );
              const removed = (before.variants || []).filter(
                (variant: EditorDocument) => !ids.has(String(variant._id)),
              );
              if (
                removed.length &&
                (await Order.exists({
                  items: {
                    $elemMatch: {
                      productId,
                      variantId: {
                        $in: removed.map(
                          (variant: EditorDocument) => variant._id,
                        ),
                      },
                    },
                  },
                  status: { $nin: ["delivered", "cancelled", "refunded"] },
                }))
              )
                editorRefusal(
                  "PRODUCT_HAS_DEPENDENCIES",
                  "An open order still needs a removed variant.",
                  "variants",
                );
            }
            const title = changes.title || before?.title || changes.name;
            if (!before || changes.seo?.handle) {
              changes.slug = await uniqueProductSlug(
                productSlugBase({
                  handle: changes.seo?.handle,
                  title,
                  sku: changes.sku,
                  productId,
                }),
                before ? productId : undefined,
              );
              changes.handle = changes.slug;
              changes.seo = {
                ...before?.seo,
                ...changes.seo,
                handle: changes.slug,
              };
            }
            if (changes.preorder)
              changes.preorder = { ...before?.preorder, ...changes.preorder };
            if (before)
              for (const field of [
                "seo",
                "shipping",
                "digitalDelivery",
                "returns",
              ])
                if (changes[field] && before[field])
                  changes[field] = { ...before[field], ...changes[field] };
            if (
              "variants" in changes &&
              before?.barcode &&
              !("barcode" in changes)
            ) {
              changes.barcode = before.barcode;
              changes.barcodeFormat = before.barcodeFormat;
              changes.barcodeSource = before.barcodeSource;
            }
            if ("variants" in changes || "barcode" in changes)
              assignMissingProductBarcodes(changes);
            assignProductLookupCodes(changes);
            const candidate = { ...before, ...changes };
            await assertProductBarcodesAreUnique(
              Product,
              candidate,
              before ? { excludeProductId: productId } : undefined,
            );
          }
        } catch (error) {
          if (error instanceof MobileApiError || error instanceof ApiError)
            throw new DefiniteOperationFailure({
              status:
                error instanceof MobileApiError
                  ? error.status
                  : error.statusCode,
              code:
                error instanceof ApiError && error.statusCode === 409
                  ? "CONFLICT"
                  : "VALIDATION_ERROR",
              message: error.message,
              reason:
                error instanceof MobileApiError
                  ? error.options.reason
                  : error instanceof ApiError && error.statusCode === 409
                    ? "BARCODE_ALREADY_USED"
                    : "PRODUCT_FIELD_NOT_ALLOWED",
            });
          throw error;
        }
        // Collections/indexes are created centrally by deployment, never by a transaction.
        await BizProductOwnerLock.updateOne(
          { _id: config.ownerId },
          { $setOnInsert: { revision: 0 } },
          { upsert: true },
        );
        const receipt = await runTransaction(
          "business product editor",
          async (session) => {
            const previous = await BizProductWrite.findOne({
              operationId: operation.id,
            })
              .session(session)
              .lean<EditorDocument | null>();
            if (previous) return previous;
            let after: EditorDocument | undefined;
            if (intent.kind === "create") {
              await BizProductOwnerLock.updateOne(
                { _id: config.ownerId },
                { $inc: { revision: 1 } },
                { session },
              );
              if (
                config.limit?.limit != null &&
                (await Product.countDocuments({
                  vendorId: config.ownerId,
                }).session(session)) >= config.limit.limit
              )
                throw new DefiniteOperationFailure({
                  status: 400,
                  code: "VALIDATION_ERROR",
                  reason: "PRODUCT_LIMIT_REACHED",
                  message: "The product limit for this plan has been reached.",
                });
            }
            const filter = {
              _id: new mongoose.Types.ObjectId(productId),
              ...productScopeFilter(context.scope),
              ...(before
                ? {
                    updatedAt: before.updatedAt,
                    // Inventory/reservation CAS protects even two writes with the same millisecond timestamp.
                    ...Object.fromEntries(
                      [
                        "stock",
                        "locationInventory",
                        "variants",
                        "preorder",
                        "stockAdjustmentReceipts",
                      ].map((field) => [
                        field,
                        before[field] === undefined
                          ? { $exists: false }
                          : { $eq: before[field] },
                      ]),
                    ),
                  }
                : {}),
            };
            if (deleting) {
              const deleted = await Product.collection.deleteOne(filter, {
                session,
              });
              if (!deleted.deletedCount)
                throw new DefiniteOperationFailure({
                  status: 412,
                  code: "CONFLICT",
                  reason: "PRODUCT_CHANGED",
                  message: "The product changed. Reload it before deleting.",
                });
              await releaseProductBarcodeRegistry(productId, session);
            } else {
              const data = {
                ...before,
                ...changes,
                _id: productId,
                vendorId: config.ownerId,
                ...(before
                  ? {}
                  : {
                      productSource:
                        context.grant.workspace === "vendor"
                          ? "vendor"
                          : "admin",
                      status: changes.status || "draft",
                    }),
              };
              extractClearedProductFields(data);
              const product = new Product(data);
              try {
                await product.validate();
              } catch (error) {
                // Standing oversell can leave negative canonical counters. These are preserved,
                // not editor writes; validate every other field using the desktop schema.
                if (
                  error instanceof mongoose.Error.ValidationError &&
                  before &&
                  Object.keys(error.errors).every(
                    (path) =>
                      path === "stock" || /^variants\.\d+\.stock$/.test(path),
                  )
                ) {
                  // Existing counters were authorized and preserved by normalizeEditorChanges.
                } else if (error instanceof mongoose.Error.ValidationError)
                  throw new DefiniteOperationFailure({
                    status: 400,
                    code: "VALIDATION_ERROR",
                    reason: "PRODUCT_FIELD_NOT_ALLOWED",
                    message: error.message,
                  });
                else throw error;
              }
              after = product.toObject();
              // Normalization (HTML, option captions, defaults) must still fit the frozen answer.
              // Refuse inside the transaction instead of committing a product we cannot return.
              try {
                toEditorValues(after!, context.scope);
              } catch {
                throw new DefiniteOperationFailure({
                  status: 400,
                  code: "VALIDATION_ERROR",
                  reason: "PRODUCT_FIELD_NOT_ALLOWED",
                  message:
                    "The normalized product fields exceed the supported editor limits.",
                });
              }
              after!.createdAt = before?.createdAt || new Date();
              after!.updatedAt = new Date(
                Math.max(
                  Date.now(),
                  Number(before?.updatedAt?.getTime()) + 1 || 0,
                ),
              );
              if (before && releaseTermsChanged(before, changes)) {
                after!.preorderTermsRevision =
                  Number(before.preorderTermsRevision || 0) + 1;
                after!.preorderDateSync = {
                  ...before.preorderDateSync,
                  state: "pending",
                  requestedAt: new Date(),
                };
              }
              await syncProductBarcodeRegistry(productId, after!, session);
              if (before) {
                const written = await Product.collection.replaceOne(
                  filter,
                  after!,
                  { session },
                );
                if (!written.matchedCount)
                  throw new DefiniteOperationFailure({
                    status: 412,
                    code: "CONFLICT",
                    reason: "PRODUCT_CHANGED",
                    message: "The product changed. Reload it before saving.",
                  });
              } else
                await Product.collection.insertOne(after! as never, {
                  session,
                });
              if (
                !(await Product.exists({
                  _id: productId,
                  ...productScopeFilter(context.scope),
                }).session(session))
              )
                throw new DefiniteOperationFailure({
                  status: 400,
                  code: "VALIDATION_ERROR",
                  reason: "PRODUCT_FIELD_NOT_ALLOWED",
                  message:
                    "Keep the product in an authorized location before saving.",
                });
            }
            const [saved] = await BizProductWrite.create(
              [
                {
                  operationId: operation.id,
                  productId,
                  ownerVendorId: config.ownerId,
                  kind: deleting
                    ? "delete"
                    : intent.kind === "create"
                      ? "create"
                      : "save",
                  before,
                  after,
                  ...(intent.kind === "create"
                    ? {
                        createDraftKey: `${context.actorId}:${binding.workspaceId}:${intent.input.draftId}`,
                      }
                    : {}),
                },
              ],
              { session },
            );
            return saved.toObject();
          },
        ).catch((error: unknown) => {
          if (error instanceof ApiError)
            throw new DefiniteOperationFailure({
              status: error.statusCode,
              code: error.statusCode === 409 ? "CONFLICT" : "VALIDATION_ERROR",
              reason: "BARCODE_ALREADY_USED",
              message: error.message,
            });
          // A duplicate domain index certifies the transaction aborted; never repeat a draft create.
          if ((error as { code?: number })?.code === 11000)
            throw new DefiniteOperationFailure({
              status: 409,
              code: "CONFLICT",
              reason: "PRODUCT_HAS_DEPENDENCIES",
              message: "This draft or product identity has already been used.",
            });
          throw error;
        });
        await finalizeProductWrite(receipt, context);
        return { data: { id: productId, deleted: deleting }, resources: refs };
      },
    });
    return {
      operation: result.operation,
      ...(result.data.deleted
        ? { deleted: true }
        : {
            product: await readProductEditor(
              result.data.id,
              context.scope,
              context.grant,
            ),
          }),
    };
  } catch (error) {
    if (error instanceof MobileApiError && error.status === 412)
      throw new MobileApiError(412, "PRECONDITION_FAILED", error.message, {
        reason: "PRODUCT_CHANGED",
        details: {
          product: await readProductEditor(
            productId,
            context.scope,
            context.grant,
          ),
        },
      });
    throw error;
  }
}

export function deletedReceiptScope(scope: BizScope): Record<string, unknown> {
  // Apply the proven product filter to the tombstone's stored product, including staff locations.
  const filter = productScopeFilter(scope);
  const prefix = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(prefix)
      : value &&
          typeof value === "object" &&
          !(value instanceof mongoose.Types.ObjectId) &&
          !(value instanceof Date)
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key.startsWith("$") ? key : `before.${key}`,
              key.startsWith("$") ? prefix(item) : item,
            ]),
          )
        : value;
  return prefix(filter) as Record<string, unknown>;
}
