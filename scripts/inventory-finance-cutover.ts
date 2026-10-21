import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { applyInventoryCutover, auditInventoryCutover, type CutoverIssue, type CutoverPlan } from "@/lib/inventory/finance-cutover";

/**
 * Inventory cutover (spec §11, Package F). Read-only unless `--apply`:
 *
 *   pnpm inventory:cutover                          audit: what an apply would do, and its fingerprint
 *   pnpm inventory:cutover --plan=<file.json>       also save the full plan for review
 *   pnpm inventory:cutover --json                   print the full plan (or the apply result) as JSON
 *   pnpm inventory:cutover --apply --expect=<fp>    apply exactly the audited plan
 *
 * `--currency=XXX` overrides the store currency. Run `scripts/prepare-inventory-finance.ts --apply`
 * first; the cutover needs a replica set and refuses on any blocker.
 */
const args = process.argv.slice(2);
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = args.includes("--apply") && !args.includes("--dry-run");
const json = args.includes("--json");
const expected = option("expect");
const planPath = option("plan");
const currency = option("currency")?.toUpperCase();

const amount = (value: number, code: string) => `${value.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
const units = (value: number) => value.toLocaleString("en");

function issues(title: string, list: CutoverIssue[]) {
  if (!list.length) return [];
  const byCode = new Map<string, CutoverIssue[]>();
  for (const issue of list) byCode.set(issue.code, [...(byCode.get(issue.code) ?? []), issue]);
  const lines = [`${title} (${list.length})`];
  for (const [code, group] of byCode) {
    lines.push(`  ${code} ×${group.length}`);
    for (const issue of group.slice(0, 5)) lines.push(`    - ${issue.message}`);
    if (group.length > 5) lines.push(`    … ${group.length - 5} more (--json lists them all)`);
  }
  return lines;
}

function summary(plan: CutoverPlan) {
  const { totals: t, currency: code } = plan;
  const missingProducts = plan.products.filter((p) => p.rows.some((r) => r.cost === null && r.available + r.reserved > 0)).length;
  return [
    `Database      ${mongoose.connection.name} on ${mongoose.connection.host}:${mongoose.connection.port}`,
    `Currency      ${code}`,
    `Fingerprint   ${plan.fingerprint}`,
    "",
    `Products      ${units(t.products)} (${units(t.positions)} stock positions)`,
    `Units         ${units(t.units)} owned, ${units(t.reservedUnits)} of them held by unpaid orders`,
    `Stock value   ${amount(t.bookValue, code)}`,
    ...(t.missingCostUnits ? [`No cost       ${units(t.missingCostUnits)} units on ${units(missingProducts)} products open at no value until a cost is set`] : []),
    `Ledger        ${amount(t.ledgerBefore, code)} now → ${amount(t.ledgerAfter, code)} after`,
    ...plan.residuals.filter((r) => Math.abs(r.amount) >= 0.005).map((r) => `Correction    ${r.amount > 0 ? "+" : ""}${amount(r.amount, code)} offsets ${r.entryKeys.length} earlier inventory entries`),
    `Order lines   ${units(t.stampedLines)} unpaid lines move to synced stock, ${units(t.adoptedLines)} sold lines keep their booked cost`,
    "",
    ...issues("Blockers", plan.blockers),
    ...issues("Warnings", plan.warnings),
  ];
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  if (apply && !expected) throw new Error("--apply needs --expect=<fingerprint> from an audit you reviewed. Run without --apply first.");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, ...(process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {}) });
  Object.assign(globalThis.mongooseCache, { conn: mongoose, promise: Promise.resolve(mongoose) });

  if (!apply) {
    const plan = await auditInventoryCutover({ currency });
    if (planPath) await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
    if (json) { process.stdout.write(JSON.stringify(plan, null, 2) + "\n"); return; }
    const next = plan.blockers.length
      ? "Blocked: resolve the blockers above, then audit again. Nothing was written."
      : `Nothing was written. To apply this plan: pnpm inventory:cutover --apply --expect=${plan.fingerprint}`;
    process.stdout.write(["Inventory cutover — audit", ...summary(plan), next].join("\n") + "\n");
    return;
  }

  try {
    const result = await applyInventoryCutover({ currency, expectFingerprint: expected, onProgress: (message) => process.stderr.write(`  ${message}\n`) });
    if (json) { process.stdout.write(JSON.stringify(result, null, 2) + "\n"); return; }
    const code = result.plan.currency;
    process.stdout.write([
      "Inventory cutover — applied",
      `Products      ${units(result.migrated.length)} moved, ${units(result.skipped.length)} skipped`,
      `Stock value   ${amount(result.migrated.reduce((sum, p) => sum + p.value, 0), code)}`,
      `Corrections   ${units(result.residualOperations.length)} posted`,
      `Postings      ${units(result.operations.complete)} of ${units(result.operations.total)} complete${result.operations.pending ? ` — ${units(result.operations.pending)} pending: retry them from Inventory and ledger` : ""}`,
      ...result.skipped.map((s) => `  skipped ${s.productId}: ${s.reason}`),
    ].join("\n") + "\n");
  } catch (error) {
    const plan = (error as { plan?: CutoverPlan }).plan;
    if (plan && !json) process.stderr.write(["Inventory cutover — not applied", ...summary(plan)].join("\n") + "\n");
    throw error;
  }
}
// A refusal (blocked, or a changed store) carries its plan and needs only its message.
main().catch((error) => { console.error((error as { plan?: unknown }).plan ? (error as Error).message : error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
