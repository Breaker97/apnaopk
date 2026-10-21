import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientSession, Model, Query, SaveOptions } from "mongoose";
import type { IProduct } from "@/types";
import { inventoryWriteContext } from "./finance-context";
import { processSingleton } from "@/lib/process-singleton";

// Once per process: the model is shared through mongoose's registry, but
// route handlers and pages each evaluate this module, and two copies each
// wrapped its writes — every stock change was captured twice.
const enclosing = processSingleton("inventory:product-hooks:enclosing", () => new AsyncLocalStorage<boolean>());
const installed = processSingleton("inventory:product-hooks:installed", () => new WeakSet<object>());
const relevant = /(?:stock|cost|locationInventory|variants|inventory|shipping|vendorId)/;

/**
 * Observe the actual persisted SKU/location delta, including model roll-ups.
 * This boundary also covers import, mobile, POS and scripts using Product.
 * Reads and metadata-only query updates retain the ordinary model path.
 */
export function installProductFinanceHooks(model: Model<IProduct>) {
  if (installed.has(model)) return;
  installed.add(model);
  const execute = async <T>(filter: Record<string, unknown>, write: (session?: ClientSession) => Promise<T>, existingSession?: ClientSession, create?: InstanceType<typeof model>): Promise<T> => {
    if (enclosing.getStore() || inventoryWriteContext()?.skipCapture) return write(existingSession);
    const { financeQuery, financeSession, financeTransaction, inFinanceSession } = await import("@/lib/finance/transaction");
    const { captureFinancialProduct, physicalFinancialProduct } = await import("./finance-catalog");
    const { getDefaultVendorIds } = await import("@/lib/finance/post-events");
    const read = () => { const query = financeQuery(model.find(filter)); if (existingSession) query.session(existingSession); return query.lean(); };
    const initial = create ? [] : await read();
    const own = create && (await getDefaultVendorIds()).has(String(create.vendorId));
    if (!own && !initial.some((p) => p.inventoryFinanceGeneration)) return write(existingSession ?? financeSession());
    const work = () => enclosing.run(true, async () => {
      const before = create ? [] : await read();
      const expectedProductVersion = inventoryWriteContext()?.valuationProductVersion;
      if (expectedProductVersion && before.some((p) => p.updatedAt?.toISOString() !== expectedProductVersion)) {
        const { ApiError } = await import("@/lib/api/errors");
        throw new ApiError("Product changed; refresh its valuation preview.", 409, "STALE_PRODUCT_VERSION");
      }
      if (create && own) {
        const { Settings } = await import("@/models/settings.model");
        const settings = await financeQuery(Settings.findOne()).select("general.defaultCurrency").lean();
        create.set("inventoryFinanceGeneration", physicalFinancialProduct(create.toObject()) ? 1 : 2);
        create.set("inventoryFinanceCurrency", String(settings?.general?.defaultCurrency ?? "USD").toUpperCase());
      }
      if (create) create.isNew = true;
      const result = await write(financeSession());
      const after = await financeQuery(model.find({ _id: { $in: create ? [create._id] : before.map((p) => p._id) } })).lean();
      const byId = new Map(before.map((p) => [String(p._id), p]));
      for (const product of after) if (byId.get(String(product._id))?.inventoryFinanceGeneration === 2 && physicalFinancialProduct(product)) {
        const { ApiError } = await import("@/lib/api/errors");
        throw new ApiError("An untracked product cannot acquire physical stock without an explicit inventory baseline. Create a tracked product instead.", 409, "INVENTORY_BASELINE_REQUIRED");
      }
      const operations: string[] = [];
      for (const product of after) operations.push(...await captureFinancialProduct(byId.get(String(product._id)) ?? null, product));
      for (const product of before) if (!after.some((p) => String(p._id) === String(product._id))) operations.push(...await captureFinancialProduct(product, null));
      return { result, operations };
    });
    if (existingSession) return (await inFinanceSession(existingSession, work)).result;
    const nested = Boolean(financeSession());
    const completed = await financeTransaction("Inventory product write", work);
    if (!nested) {
      const { finishFinanceOperation } = await import("@/lib/finance/operations");
      for (const operation of completed.operations) await finishFinanceOperation(operation);
    }
    return completed.result;
  };
  const prototype = (model as unknown as { Query: { prototype: Query<unknown, IProduct> & { op: string } } }).Query.prototype;
  const exec = prototype.exec;
  prototype.exec = async function (...args: Parameters<typeof exec>) {
    if (this.getOptions().upsert && relevant.test(JSON.stringify(this.getUpdate()))) {
      const { ApiError } = await import("@/lib/api/errors");
      throw new ApiError("Create inventory products with Product.create/save so opening evidence is recorded.", 400, "INVENTORY_UPSERT_NOT_ALLOWED");
    }
    if (!["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"].includes(this.op) || (!this.op.includes("Delete") && !this.op.startsWith("delete") && !relevant.test(JSON.stringify(this.getUpdate())))) return exec.apply(this, args);
    return execute(this.getFilter(), async (session) => { if (session) this.session(session); return exec.apply(this, args); }, this.getOptions().session ?? undefined);
  };
  const save = model.prototype.save;
  model.prototype.save = async function (...args: Parameters<typeof save>) {
    const doc = this as InstanceType<typeof model>;
    const options = (args[0] ?? {}) as SaveOptions;
    const inherited = doc.$session();
    if (inherited?.hasEnded) doc.$session(null);
    const session = options.session ?? (inherited?.hasEnded ? undefined : inherited ?? undefined);
    return execute({ _id: doc._id }, (active) => save.call(doc, { ...options, ...(active ? { session: active } : {}) }), session, doc.isNew ? doc : undefined);
  };
  // Model.create uses the Document.$save alias rather than Document.save.
  model.prototype.$save = model.prototype.save;
  const bulkWrite = model.bulkWrite;
  model.bulkWrite = function (this: typeof model, ...args: Parameters<typeof bulkWrite>) {
    if (args[0].some((op) => relevant.test(JSON.stringify(op)) || "insertOne" in op || "deleteOne" in op || "deleteMany" in op || "replaceOne" in op)) return Promise.reject(new Error("Use Product.create/save/updateOne for inventory mutations; bulk writes bypass movement evidence.")) as ReturnType<typeof bulkWrite>;
    return bulkWrite.apply(this, args);
  } as typeof bulkWrite;
  model.insertMany = (() => Promise.reject(new Error("Use Product.create for inventory imports so each row records opening stock evidence."))) as typeof model.insertMany;
}
