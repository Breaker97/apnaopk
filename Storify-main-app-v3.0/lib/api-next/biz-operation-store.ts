import { connectDB } from "@/lib/db";
import { BizOperation } from "@/models/biz-operation.model";
import type { BizOperationStore, StoredBizOperation } from "@/lib/api-core/biz/durable-operation";

type Row = Omit<StoredBizOperation, "id"> & { _id: unknown };
function view(row: Row): StoredBizOperation { return { ...row, id: String(row._id) }; }
function duplicate(error: unknown): boolean { return (error as { code?: number } | null)?.code === 11000; }
async function update(id: string, token: string, fields: Record<string, unknown>): Promise<StoredBizOperation> {
  const row = await BizOperation.findOneAndUpdate({ _id: id, token, state: { $in: ["pending", "unknown"] } }, { $set: fields }, { returnDocument: "after" }).lean<Row | null>();
  if (!row) throw new Error("Operation lease no longer belongs to this request");
  return view(row);
}
export const mongoBizOperationStore: BizOperationStore = {
  async open(binding, token, leaseUntil) {
    await connectDB();
    try {
      const row = await BizOperation.create({ ...binding, state: "pending", token, leaseUntil, resources: [] });
      return { operation: view(row.toObject() as unknown as Row), owned: true };
    } catch (error) {
      if (!duplicate(error)) throw error;
      const row = await BizOperation.findOne({ actorId: binding.actorId, key: binding.key }).lean<Row | null>();
      if (!row) throw error;
      return { operation: view(row), owned: false };
    }
  },
  async read(actorId, key) { await connectDB(); const row = await BizOperation.findOne({ actorId, key }).lean<Row | null>(); return row ? view(row) : null; },
  async take(operation, token, leaseUntil) {
    const row = await BizOperation.findOneAndUpdate({ _id: operation.id, token: operation.token, leaseUntil: { $eq: operation.leaseUntil, $lte: new Date() }, state: { $in: ["pending", "unknown"] } }, { $set: { token, leaseUntil, state: "pending" } }, { returnDocument: "after" }).lean<Row | null>();
    return row ? view(row) : null;
  },
  async checkpoint(id, token, value, resources) { await update(id, token, { checkpoint: value, ...(resources ? { resources } : {}) }); },
  finish: (id, token, result, resources) => update(id, token, { state: "succeeded", result, resources, leaseUntil: new Date(0) }),
  unknown: (id, token) => update(id, token, { state: "unknown", leaseUntil: new Date(0) }),
  fail: (id, token, failure) => update(id, token, { state: "failed", failure, leaseUntil: new Date(0) }),
};
