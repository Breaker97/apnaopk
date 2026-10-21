import { AsyncLocalStorage } from "node:async_hooks";
import type { Model, Query, SaveOptions, ClientSession } from "mongoose";
import type { IReturnRequest } from "@/models/return-request.model";
import { physicalReturnRows, type PhysicalReturn } from "./finance-return-states";
import { processSingleton } from "@/lib/process-singleton";
// Once per process, as the product hooks: see `processSingleton`.
const enclosing = processSingleton("inventory:return-hooks:enclosing", () => new AsyncLocalStorage<boolean>());
const installed = processSingleton("inventory:return-hooks:installed", () => new WeakSet<object>());
export function installReturnFinanceHooks(model: Model<IReturnRequest>) {
  if (installed.has(model)) return; installed.add(model);
  const execute = async <T>(filter: Record<string, unknown>, write: (session?: ClientSession) => Promise<T>, external?: ClientSession, create?: InstanceType<typeof model>): Promise<T> => {
    if (enclosing.getStore()) return write(external);
    const { Order } = await import("@/models/order.model");
    const { financeQuery, financeSession, financeTransaction, inFinanceSession } = await import("@/lib/finance/transaction");
    const initialQuery = model.find(filter);
    if (external) initialQuery.session(external);
    const initial = create ? [create.toObject()] : await financeQuery(initialQuery).lean();
    const orders = await financeQuery(Order.find({ _id: { $in: initial.map((row) => row.orderId) }, "items.inventoryFinanceGeneration": 1 })).lean();
    if (!orders.length) return write(external ?? financeSession());
    const work = () => enclosing.run(true, async () => {
      const before = create ? [] : await financeQuery(model.find(filter)).lean();
      if (create) create.isNew = true;
      const result = await write(financeSession());
      const after = await financeQuery(model.find({ _id: { $in: initial.map((row) => row._id) } })).lean();
      const { Product } = await import("@/models/product.model");
      const { InventoryPosition } = await import("@/models/inventory-position.model");
      const { InventoryLocation } = await import("@/models/inventory-location.model");
      const { runInventoryMutation } = await import("./finance-service");
      const { inventoryPositionKey } = await import("./finance-position");
      const { soldBranchLocationId } = await import("@/lib/orders/order-inventory");
      const { inventoryWriteContext } = await import("./finance-context");
      const ctx = inventoryWriteContext();
      for (const request of after) {
        const previous = before.find((r) => String(r._id) === String(request._id));
        const oldRows = physicalReturnRows(previous ? previous as unknown as PhysicalReturn : null);
        const newRows = physicalReturnRows(request as unknown as PhysicalReturn);
        const order = orders.find((o) => String(o._id) === String(request.orderId));
        if (!order) continue;
        for (const index of new Set([...oldRows, ...newRows].map((r) => r.index))) {
          const old = oldRows.find((r) => r.index === index), next = newRows.find((r) => r.index === index), row = next ?? old!;
          const delta = (next?.quantity ?? 0) - (old?.quantity ?? 0);
          if (!delta) continue;
          const line = order.items?.[row.orderItemIndex ?? -1];
          if (line?.inventoryFinanceGeneration !== 1) continue;
          const product = await financeQuery(Product.findById(row.productId)).lean();
          if (!product?.inventoryFinanceCurrency) continue;
          const locationId = request.returnTo?.locationId ? String(request.returnTo.locationId) : soldBranchLocationId(order, String(product.vendorId)) ?? null;
          if (locationId && !await financeQuery(InventoryLocation.exists({ _id: locationId, vendorId: product.vendorId }))) throw new Error("Return location must belong to the stock owner.");
          const scope = { ownerId: String(product.vendorId), productId: row.productId, variantId: row.variantId, locationId, currency: product.inventoryFinanceCurrency };
          const position = await financeQuery(InventoryPosition.findOne({ key: inventoryPositionKey(scope) }));
          await runInventoryMutation({ scope, expectedVersion: position?.version ?? 0, allowInitialize: !position, actorId: ctx?.actorId ?? "system", requestKey: `return-state:${request._id}:${index}:${position?.version ?? 0}`, fingerprint: { delta, orderId: String(order._id), lineId: line.inventoryLineId }, reason: delta > 0 ? "return_received" : "damaged", occurredAt: new Date(), generatedDate: true, channel: ctx?.channel ?? "system", productName: product.name, sku: product.sku, note: ctx?.note ?? "Returned units awaiting acceptance or disposal; original sale cost is unchanged.", source: { kind: "return_state", id: String(request._id), lineId: line.inventoryLineId }, physicalQuantityDelta: 0, physicalUnavailableDelta: delta, financialState: delta > 0 || request.inventoryRestored || (next?.quantity ?? 0) < (old?.quantity ?? 0) && request.unsellableDispositions?.some((d) => d.itemIndex === index && d.action === "restocked") ? "returned_unvalued" : "written_off", plan: () => ({ change: { quantityDelta: 0, valueDelta: 0 }, postings: [] }) });
        }
      }
      return result;
    });
    return external ? inFinanceSession(external, work) : financeTransaction("Return physical state", work);
  };
  const prototype = (model as unknown as { Query: { prototype: Query<unknown, IReturnRequest> & { op: string } } }).Query.prototype;
  const exec = prototype.exec;
  prototype.exec = async function (...args: Parameters<typeof exec>) {
    if (!["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"].includes(this.op) || !/items|inventoryRestored|unsellableDispositions|status/.test(JSON.stringify(this.getUpdate()))) return exec.apply(this, args);
    return execute(this.getFilter(), async (session) => { if (session) this.session(session); return exec.apply(this, args); }, this.getOptions().session ?? undefined);
  };
  const save = model.prototype.save;
  model.prototype.save = async function (...args: Parameters<typeof save>) {
    const doc = this as InstanceType<typeof model>, options = (args[0] ?? {}) as SaveOptions;
    const inherited = doc.$session();
    if (inherited?.hasEnded) doc.$session(null);
    return execute({ _id: doc._id }, (session) => save.call(doc, { ...options, ...(session ? { session } : {}) }), options.session ?? (inherited?.hasEnded ? undefined : inherited ?? undefined), doc.isNew ? doc : undefined);
  };
  model.prototype.$save = model.prototype.save;
}
