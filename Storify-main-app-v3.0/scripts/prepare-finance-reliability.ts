import mongoose from "mongoose";
import { FinanceOperation, FinanceVendorState } from "@/models/finance-operation.model";
import { FinanceRecoveryCheckpoint, FinanceRecoveryFailure } from "@/models/finance-recovery.model";
import { CollectionReceipt } from "@/models/collection-receipt.model";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { Payout } from "@/models/payout.model";
import { getTransactionSupport } from "@/lib/db-transaction";

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, ...(process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {}) });
  Object.assign(globalThis.mongooseCache, { conn: mongoose, promise: Promise.resolve(mongoose) });
  const capability = await getTransactionSupport();
  const models = [FinanceOperation, FinanceVendorState, FinanceRecoveryCheckpoint, FinanceRecoveryFailure, CollectionReceipt, LedgerEntry, Payout];
  const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
  if (apply) {
    if (!capability.supported) throw new Error(capability.reason);
    for (const model of models) {
      await model.createCollection();
      // Add declared indexes; never remove existing indexes or alter money rows.
      await model.createIndexes();
    }
  }
  process.stdout.write(JSON.stringify({ applied: apply, capability, indexes: models.map((model) => ({ collection: model.collection.name, indexes: model.schema.indexes() })) }, null, 2) + "\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
