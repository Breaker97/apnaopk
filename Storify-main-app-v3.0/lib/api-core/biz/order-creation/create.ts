import { ManualOrderCreateRequest, ManualOrderCreateResult, MANUAL_ORDER_REASONS } from "@/contracts/mobile/biz/v1/order-creation";
import { BIZ_ACCESS, assertCapability } from "@/lib/api-core/biz/access";
import { bizOperationBinding, runDurableBizOperation, type OperationResourceRef } from "@/lib/api-core/biz/durable-operation";
import { orderScopeFilter } from "@/lib/api-core/biz/scope";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute } from "@/lib/api-core/registry";
import { mongoBizOperationStore } from "@/lib/api-next/biz-operation-store";
import { Order } from "@/models/order.model";
import { Product } from "@/models/product.model";
import { loadOrderDetail } from "@/lib/api-core/biz/orders/detail";
import { commitBizManualOrder, findManualOrderReceipt, recoverManualOrderEffects, manualDraftReceipt } from "@/lib/orders/create-biz-manual-order";
import { assertCanCreate, creationRefusal, type CreationContext } from "./policy";
import { loadCreationOptions } from "./options";
import { loadCreationProducts } from "./products";
import { resolveCreationCustomer } from "./customers";

/** Also used by operation polling; every stored order receipt is reauthorized. */
export async function authorizeManualOrderResources(context: CreationContext, resources: readonly OperationResourceRef[]) {
  assertCanCreate(context);
  for (const resource of resources) {
    if (resource.kind !== "order" || !await Order.exists({ $and: [{ _id: resource.id }, orderScopeFilter(context.scope)] })) {
      throw new MobileApiError(404, "NOT_FOUND", "Order not found in this workspace.");
    }
  }
}

export const manualOrderCreateRoute = defineBizRoute({
  id: "orders.creation.create", method: "POST", path: "/orders/creation", auth: "user",
  ...BIZ_ACCESS.CREATE_ORDERS, cache: { kind: "private" }, status: 201,
  rateLimit: { bucket: "biz:orders:create", preset: "moderate" }, demo: "default",
  idempotency: "required", durable: true, input: ManualOrderCreateRequest, output: ManualOrderCreateResult,
  reasons: { values: MANUAL_ORDER_REASONS },
  handler: async ({ input, workspace, scope, session, locale, client, requestId }) => {
    const context: CreationContext = { workspace, scope, actorId: session.user.id, locale };
    const binding = bizOperationBinding({ actorId: context.actorId, workspace, key: client.idempotencyKey,
      routeId: "orders.creation.create", target: input.draft.draftId, payload: input });
    const result = await runDurableBizOperation<string>({ binding, store: mongoBizOperationStore,
      authorize: async (resources) => {
        await authorizeManualOrderResources(context, resources);
        if (input.recordPayment) assertCapability(workspace, "RECORD_ORDER_PAYMENTS");
        // Once the primary effect exists, its historical order is the target.
        // Product deletion or customer suspension must not strand reconciliation.
        const receipt = await Order.findOne({ idempotencyKey: manualDraftReceipt(context, input.draft.draftId) }).select("_id").lean();
        if (receipt) {
          await authorizeManualOrderResources(context, [{ kind: "order", id: String(receipt._id) }]);
          return;
        }
        const policy = await loadCreationOptions(context);
        const products = await loadCreationProducts(context, [...new Set(input.draft.items.map((item) => item.productId))]);
        if (products.length !== new Set(input.draft.items.map((item) => item.productId)).size) creationRefusal("PRODUCT_NOT_ORDERABLE", "A selected product is no longer in this workspace.", 403);
        await resolveCreationCustomer(context, input.draft.customer);
        if (input.recordPayment) {
          if (!policy.options.payments.find((payment) => payment.id === input.draft.paymentMethod)?.canRecordPayment) creationRefusal("PAYMENT_RECORDING_NOT_ALLOWED", "This method cannot record payment.", 403);
        }
      },
      execute: async (operation) => {
        const order = await commitBizManualOrder(context, input, operation, {
          userId: session.user.id, userEmail: session.user.email, userRole: session.user.role,
          ...(workspace.workspace === "vendor" ? { vendorId: workspace.vendor.id } : {}),
          origin: { requestId, method: "POST", path: "/orders/creation" },
        });
        const resources = [{ kind: "order" as const, id: String(order._id) }];
        await authorizeManualOrderResources(context, resources);
        await recoverManualOrderEffects(order, operation);
        return { data: String(order._id), resources };
      },
      reconcile: async (operation) => {
        const order = await findManualOrderReceipt(operation.id);
        if (!order) {
          if (operation.checkpoint?.primaryStarted && !operation.checkpoint.primaryAborted) return { state: "unknown" as const };
          // No order alone is insufficient: never repeat an orphaned stock effect.
          const partial = await Product.exists({ "stockAdjustmentReceipts.key": { $regex: `^${operation.effectKey}:stock:` } });
          return { state: partial ? "unknown" as const : "not_applied" as const };
        }
        const resources = [{ kind: "order" as const, id: String(order._id) }];
        await authorizeManualOrderResources(context, resources);
        await recoverManualOrderEffects(order, operation);
        return { state: "succeeded" as const, data: String(order._id), resources };
      },
    });
    const order = await loadOrderDetail(result.data, { workspace, scope });
    if (!order) throw new MobileApiError(404, "NOT_FOUND", "Order not found in this workspace.");
    return { operation: result.operation, order };
  },
});
