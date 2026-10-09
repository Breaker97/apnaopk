/** Resumable additive replay. Existing ledger keys are never erased or rewritten. */
import "./lib/finance-cli.cjs";
import mongoose from "mongoose";
const args = process.argv.slice(2);
const value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
async function main() {
  if (args.includes("--rebuild")) throw new Error("Ledger rebuild deletes history and is no longer supported. Generate a finance repair plan instead.");
  if (value("method")) throw new Error("Method-scoped historical repairs require a reviewed finance repair plan. Use a date range for additive replay.");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  const since = new Date(value("from") || "1970-01-01");
  const until = value("to") ? new Date(`${value("to")}T23:59:59.999Z`) : new Date();
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || until < since) throw new Error("Invalid backfill dates");
  await mongoose.connect(process.env.MONGODB_URI, { ...(process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {}) });
  const { financeReliabilityReport } = await import("../lib/finance/reliability-report.ts");
  Object.assign(globalThis.mongooseCache, { conn: mongoose, promise: Promise.resolve(mongoose) });
  if (args.includes("--dry-run")) { console.log(JSON.stringify(await financeReliabilityReport(), null, 2)); return; }
  const { reconcileRecentLedger } = await import("../lib/finance/ledger-reconcile.ts");
  const { recoverFinanceOperations } = await import("../lib/finance/operations.ts");
  let result;
  let passes = 0;
  do {
    result = await reconcileRecentLedger({ since, until, group: "backfill", limit: 200, budgetMs: 30_000 });
    console.log(JSON.stringify({ pass: ++passes, ...result, operations: await recoverFinanceOperations(200, 10_000) }));
    if (result.failures) break;
  } while (!result.complete && passes < 2500);
  if (!result.complete) { console.error("Backfill remains incomplete; rerun with the same dates to resume. Inspect reported failures."); process.exitCode = 2; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
