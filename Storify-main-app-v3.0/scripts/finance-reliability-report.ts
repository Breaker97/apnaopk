import { readFile, writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { financeReliabilityReport, applyFinanceRepairPlan } from "@/lib/finance/reliability-report";

async function main() {
  const args = process.argv.slice(2);
  const planPath = args.find((arg) => arg.startsWith("--plan="))?.slice(7);
  const apply = args.includes("--apply") && !args.includes("--dry-run");
  if (apply && !planPath) throw new Error("--apply requires --plan=<saved-report.json>");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, ...(process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {}) });
  Object.assign(globalThis.mongooseCache, { conn: mongoose, promise: Promise.resolve(mongoose) });
  const result = apply ? await applyFinanceRepairPlan(JSON.parse(await readFile(planPath!, "utf8"))) : await financeReliabilityReport();
  const json = JSON.stringify(result, null, 2);
  if (planPath && !apply) await writeFile(planPath, json + "\n", { flag: "wx" });
  process.stdout.write(json + "\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
