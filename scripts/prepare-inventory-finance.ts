import mongoose from "mongoose";
import { InventoryMovement } from "@/models/inventory-movement.model";
import { InventoryPosition } from "@/models/inventory-position.model";
import { InventorySaleAllocation, InventoryFundingAllocation } from "@/models/inventory-allocation.model";
import { InventoryReservation } from "@/models/inventory-reservation.model";
import { InventoryTransit } from "@/models/inventory-transit.model";
import { InventoryCostSource } from "@/models/inventory-cost-source.model";
import { FinanceOperation } from "@/models/finance-operation.model";
import { getTransactionSupport } from "@/lib/db-transaction";

/** Structural preparation only: never writes stock, costs, generations or ledger balances. */
async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, ...(process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {}) });
  Object.assign(globalThis.mongooseCache, { conn: mongoose, promise: Promise.resolve(mongoose) });
  const capability = await getTransactionSupport();
  const models = [InventoryMovement, InventoryPosition, InventorySaleAllocation, InventoryFundingAllocation, InventoryReservation, InventoryTransit, InventoryCostSource, FinanceOperation];
  const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
  const collection = InventorySaleAllocation.collection;
  const indexes = await collection.listIndexes().toArray().catch((error) => { if (error.code === 26) return []; throw error; });
  const oldKey = { orderId: 1, subOrderId: 1, lineId: 1, positionKey: 1 };
  const obsolete = indexes.filter((index) => index.unique && JSON.stringify(index.key) === JSON.stringify(oldKey));
  if (apply) {
    if (!capability.supported) throw new Error(capability.reason);
    for (const model of models) { await model.createCollection(); await model.createIndexes(); }
    // The replacement unique index includes the reinstatement cycle. Create it
    // first; only then remove the exact obsolete Package A index, if present.
    for (const index of obsolete) await collection.dropIndex(index.name!);
  }
  process.stdout.write(JSON.stringify({ applied: apply, capability, obsoleteSaleIndexes: obsolete.map((index) => index.name), indexes: models.map((model) => ({ collection: model.collection.name, indexes: model.schema.indexes() })) }, null, 2) + "\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
