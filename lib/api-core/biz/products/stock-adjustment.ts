import { createHash } from "node:crypto";
import {
  PRODUCT_REASONS,
  ProductStock,
  StockAdjustmentRequest,
} from "@/contracts/mobile/biz/v1/products";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { bizAppAuditContext } from "@/lib/api-core/biz/audit-context";
import { productScopeFilter, staffLocationIds } from "@/lib/api-core/biz/scope";
import { MobileApiError } from "@/lib/api-core/errors";
import {
  bizOperationBinding,
  runDurableBizOperation,
  type BizOperationExecution,
} from "@/lib/api-core/biz/durable-operation";
import { mongoBizOperationStore } from "@/lib/api-next/biz-operation-store";
import { OPERATION_REASONS } from "@/contracts/mobile/biz/v1/operations";
import { Product } from "@/models";
import { defineBizRoute } from "@/lib/api-core/registry";
import {
  allowedLocationIds,
  productStockScope,
} from "@/lib/inventory/inventory-location-scope";
import { applyStockEdit, finishStockEdits } from "@/lib/inventory/stock-adjust";
import { STOCK_ADJUSTMENT_KEY_REUSED } from "@/lib/inventory/inventory";
import {
  readStockBeforeEdit,
  type AppliedStockEdit,
} from "@/lib/inventory/stock-edit-audit";
import { productTracksStock } from "@/lib/products/stock-policy";
import { ensureDefaultVendorId } from "@/lib/vendors/multi-vendor";
import { findScopedProduct, productNotFound } from "./load";
import { readProductStock } from "./stock";

/** `applyStockChangeAtomic`'s answer when three guarded writes in a row lost to a sale or a transfer. */
const STOCK_KEPT_MOVING = "Stock changed concurrently; please retry";

const refuse = (
  status: number,
  code: "VALIDATION_ERROR" | "AUTHORIZATION_ERROR" | "CONFLICT",
  reason: string,
  message: string,
) => new MobileApiError(status, code, message, { reason });

/**
 * POST /products/{id}/stock-adjustments: count units in or out at one
 * location (lib/inventory/stock-adjust.ts, the inventory screens' edit). The
 * location must be the product owner's, and one of the staff member's own
 * when they are assigned to some: the rule the product editor applies, so an
 * administrator may count a seller's shelves here. The reason and note go
 * into the Activity Log's row. A retry with the same `Idempotency-Key` gets
 * the first answer and never counts twice.
 */
export const stockAdjustmentRoute = defineBizRoute({
  id: "products.stock-adjustments.create",
  method: "POST",
  path: "/products/{id}/stock-adjustments",
  auth: "user",
  ...BIZ_ACCESS.ADJUST_STOCK,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:inventory:update", preset: "moderate" },
  demo: "default",
  idempotency: "required",
  durable: true,
  input: StockAdjustmentRequest,
  output: ProductStock,
  reasons: { values: [...PRODUCT_REASONS, ...OPERATION_REASONS] },
  handler: async ({
    input,
    params,
    scope,
    workspace,
    session,
    client,
    requestId,
    locale,
  }) => {
    const product = await findScopedProduct(params.id, scope);
    if (!productTracksStock(product)) {
      throw refuse(
        409,
        "CONFLICT",
        "UNTRACKED",
        "Stock is not counted for this product.",
      );
    }
    const variants = product.variants ?? [];
    if (variants.length > 0 && !input.variantId) {
      throw refuse(
        400,
        "VALIDATION_ERROR",
        "VARIANT_REQUIRED",
        "Say which variant the units are of.",
      );
    }
    if (
      input.variantId &&
      !variants.some((variant) => String(variant._id) === input.variantId)
    ) {
      throw refuse(
        400,
        "VALIDATION_ERROR",
        "UNKNOWN_VARIANT",
        "Not a variant of this product.",
      );
    }

    // Judged by the product's OWNER, never the editor (productStockScope). A
    // product with no seller is the store's own; its profile is made here when
    // missing, and when it may not be made that is said, not passed off as a
    // location the caller may not use.
    let owner = product.vendorId ? String(product.vendorId) : null;
    if (!owner) {
      const house = await ensureDefaultVendorId({
        preferredOwnerId: session.user.id,
      });
      if (!house.vendorId) {
        throw new MobileApiError(
          503,
          "SERVICE_UNAVAILABLE",
          "The store's own profile is not set up, so its locations cannot be resolved. An admin can see why under Settings → General.",
        );
      }
      owner = house.vendorId;
    }
    const locationIds = await allowedLocationIds(
      productStockScope(owner, staffLocationIds(scope)),
    );

    if (input.locationId && !locationIds.has(input.locationId))
      throw refuse(
        403,
        "AUTHORIZATION_ERROR",
        "LOCATION_NOT_ALLOWED",
        "Not a location you can count stock at.",
      );
    const binding = bizOperationBinding({
      actorId: session.user.id,
      workspace,
      key: client.idempotencyKey,
      routeId: "products.stock-adjustments.create",
      target: params.id,
      payload: input,
    });
    const refs = [{ kind: "product" as const, id: params.id }];
    const hash = createHash("sha256")
      .update(JSON.stringify({ params, input }))
      .digest("hex");
    const finish = async (operation: BizOperationExecution) => {
      if (!operation.checkpoint?.applied || operation.checkpoint.auditComplete)
        return;
      await finishStockEdits(
        bizAppAuditContext({
          session,
          client,
          requestId,
          locale,
          method: "POST",
          path: `/products/${params.id}/stock-adjustments`,
          vendorId:
            workspace.workspace === "vendor" ? workspace.vendor.id : undefined,
        }),
        [operation.checkpoint.applied as AppliedStockEdit],
      );
      await operation.remember(
        { ...operation.checkpoint, auditComplete: true },
        refs,
      );
    };
    await runDurableBizOperation({
      binding,
      store: mongoBizOperationStore,
      authorize: async () => {
        await findScopedProduct(params.id, scope);
      },
      reconcile: async (operation) => {
        const receipt = await Product.findOne(
          { _id: params.id, ...productScopeFilter(scope) },
          {
            stockAdjustmentReceipts: {
              $elemMatch: { key: `${operation.effectKey}:stock:adjustment` },
            },
          },
        ).lean<{ stockAdjustmentReceipts?: Array<{ hash: string }> } | null>();
        const applied = receipt?.stockAdjustmentReceipts?.[0];
        if (!applied) return { state: "not_applied" };
        if (applied.hash !== hash) return { state: "unknown" };
        await finish(operation);
        return { state: "succeeded", data: { id: params.id }, resources: refs };
      },
      execute: async (operation) => {
        const before = await readStockBeforeEdit(
          {
            productId: params.id,
            variantId: input.variantId,
            locationId: input.locationId,
          },
          productScopeFilter(scope),
        );
        await operation.remember(
          {
            applied: {
              productId: params.id,
              variantId: input.variantId,
              locationId: input.locationId,
              before,
              quantity: input.delta,
              adjustment: true,
              reason: input.reason,
              note: input.note,
            },
            auditComplete: false,
          },
          refs,
        );
        const receipt = {
          key: `${operation.effectKey}:stock:adjustment`,
          hash,
          durable: true,
        };
        const outcome = await applyStockEdit(
          {
            productId: String(product._id),
            variantId: input.variantId,
            locationId: input.locationId,
            quantity: input.delta,
            adjustment: true,
            reason: input.reason,
            note: input.note,
            receipt,
          },
          { locationIds, productFilter: productScopeFilter(scope) },
        );
        if (!outcome.success) {
          if (outcome.error === STOCK_ADJUSTMENT_KEY_REUSED) {
            throw new MobileApiError(
              422,
              "IDEMPOTENCY_KEY_REUSED",
              "This Idempotency-Key was already used for a different request. Send a new key.",
            );
          }
          if (outcome.refusal !== "NOT_APPLIED") {
            throw refuse(
              403,
              "AUTHORIZATION_ERROR",
              "LOCATION_NOT_ALLOWED",
              "Not a location you can count stock at.",
            );
          }
          if (outcome.error === "Product not found") throw productNotFound();
          if (outcome.error === "Variant not found") {
            throw refuse(
              400,
              "VALIDATION_ERROR",
              "UNKNOWN_VARIANT",
              "Not a variant of this product.",
            );
          }
          if (outcome.error === STOCK_KEPT_MOVING) {
            throw new MobileApiError(
              409,
              "CONFLICT",
              "The stock kept changing. Try again in a moment.",
            );
          }
          throw new Error(`Stock adjustment failed: ${outcome.error}`);
        }

        await operation.remember(
          { applied: outcome.applied, auditComplete: false },
          refs,
        );
        await finish(operation);

        return { data: { id: params.id }, resources: refs };
      },
    });
    return readProductStock(params.id, scope);
  },
});
