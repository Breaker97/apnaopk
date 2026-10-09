import { randomUUID } from "node:crypto";
import type { StoredBizOperation } from "@/lib/api-core/biz/durable-operation";
import { mongoBizOperationStore } from "@/lib/api-next/biz-operation-store";
import { getTransactionSupport } from "@/lib/db-transaction";
import { Order } from "@/models/order.model";
import { Product } from "@/models/product.model";

/** Resolve only a certified abort; polling never creates an order or repeats stock/payment effects. */
export async function reconcileAbortedManualOrder(operation: StoredBizOperation): Promise<StoredBizOperation> {
  if (operation.routeId !== "orders.creation.create" || !["pending", "unknown"].includes(operation.state) ||
    operation.checkpoint?.primaryStarted !== true || operation.checkpoint.primaryAborted !== true ||
    operation.resources.length || operation.leaseUntil.getTime() > Date.now()) return operation;

  const taken = await mongoBizOperationStore.take(operation, randomUUID(), new Date(Date.now() + 10 * 60_000));
  if (!taken) return await mongoBizOperationStore.read(operation.actorId, operation.key) ?? operation;
  try {
    const order = await Order.exists({ bizOperationId: taken.id });
    const stock = await Product.exists({ "stockAdjustmentReceipts.key": { $regex: `^biz:${taken.id}:stock:` } });
    if (order || stock) return await mongoBizOperationStore.unknown(taken.id, taken.token);
    const support = await getTransactionSupport();
    const reason = support.topology === "standalone" ? "TRANSACTIONS_UNAVAILABLE" : "OPERATION_FAILED";
    return await mongoBizOperationStore.fail(taken.id, taken.token, {
      status: 409, code: "CONFLICT", reason, message: "The order transaction was aborted. No order was created.",
    });
  } catch (error) {
    await mongoBizOperationStore.unknown(taken.id, taken.token).catch(() => undefined);
    throw error;
  }
}
