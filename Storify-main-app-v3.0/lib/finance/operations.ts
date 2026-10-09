import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { quantizeToCurrency } from "@/lib/intl/money";
import { ApiError } from "@/lib/api/errors";
import { FinanceOperation, FinanceVendorState } from "@/models/finance-operation.model";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { FiscalPeriod } from "@/models/fiscal-period.model";
import { applyPeriodClose, postLedgerEntries, type LedgerPosting } from "./ledger";
import { financeQuery, financeSession, financeTransaction } from "./transaction";
import { TransactionContendedError, TransactionOutcomeUnknownError, TransactionsUnavailableError } from "@/lib/db-transaction";

export function financialFingerprint(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      if ("toHexString" in v) return String(v);
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)]));
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

export function mutationKey(request: Request, fallback?: string): string {
  const key = request.headers.get("idempotency-key") || fallback || randomUUID();
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(key)) throw new ApiError("Invalid request key", 400, "INVALID_REQUEST_KEY");
  return key;
}

export function expectedVersion(request: Request, stored: number, supplied?: number): number {
  const header = request.headers.get("if-match")?.replaceAll('"', "");
  const version = header == null ? supplied ?? stored : Number(header);
  if (!Number.isSafeInteger(version) || version < 0) throw new ApiError("Invalid version", 400, "INVALID_VERSION");
  return version;
}

export const staleFinance = () => new ApiError("This record changed. Reload and try again.", 409, "STALE_FINANCE_VERSION");

/** Resolve a committed retry before consulting the current mutable source. */
export async function replayFinanceRequest<T>(input: { action: string; actorId: string; requestKey: string; fingerprint: (result: T) => unknown }) {
  const operation = await FinanceOperation.findOne({ key: `${input.actorId}:${input.action}:${input.requestKey}` }).lean();
  if (!operation) return null;
  if (operation.fingerprint !== financialFingerprint(input.fingerprint(operation.result as T))) throw new ApiError("Request key was used for a different change", 409, "REQUEST_KEY_CONFLICT");
  const complete = await finishFinanceOperation(operation._id);
  return { data: operation.result as T, operationId: String(operation._id), bookkeepingState: complete ? "complete" as const : "pending" as const };
}

/** A transaction write conflict serializes all consumers of shared vendor credits. */
export async function touchVendorFinance(vendorId: unknown, currency: string) {
  await financeQuery(FinanceVendorState.updateOne(
    { _id: `${String(vendorId)}:${currency.toUpperCase()}` },
    { $inc: { version: 1 } }, { upsert: true },
  ));
}

export async function prepareFinancePostings(postings: LedgerPosting[]): Promise<LedgerPosting[]> {
  const period = await financeQuery(FiscalPeriod.findOne().sort({ to: -1 }).select("to")).lean();
  return postings.map((entry) => applyPeriodClose({ ...entry, amount: quantizeToCurrency(entry.amount, entry.currency), currency: entry.currency.toUpperCase() }, period?.to ?? null));
}

export async function finishFinanceOperation(id: unknown): Promise<boolean> {
  const owner = randomUUID();
  const now = new Date();
  const op = await FinanceOperation.findOneAndUpdate({
    _id: id, state: "pending", $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }],
  }, { $set: { leaseOwner: owner, leaseUntil: new Date(now.getTime() + 60_000) }, $inc: { attempts: 1 } }, { returnDocument: "after" }).lean();
  if (!op) return (await FinanceOperation.findById(id).select("state").lean())?.state === "complete";
  try {
    const postings = op.postings as LedgerPosting[];
    const verify = async () => {
      const existing = await LedgerEntry.find({ key: { $in: postings.map((p) => p.key) } }).lean();
      for (const row of existing) {
        const wanted = postings.find((p) => p.key === row.key)!;
        if (row.book !== wanted.book || row.debit !== wanted.debit || row.credit !== wanted.credit || row.amount !== wanted.amount || row.currency !== wanted.currency.toUpperCase() || String(row.vendorId ?? "") !== String(wanted.vendorId ?? "") || new Date(row.date).getTime() !== new Date(wanted.date).getTime() || row.source.kind !== wanted.source.kind || String(row.source.id ?? "") !== String(wanted.source.id ?? "")) {
          throw new ApiError(`Conflicting ledger key: ${row.key}`, 409, "LEDGER_CONTENT_CONFLICT");
        }
      }
      return existing.length;
    };
    await verify();
    await postLedgerEntries(postings, { strict: true, resolvedDates: true });
    const count = await verify();
    if (count !== new Set(postings.map((p) => p.key)).size) throw new Error("Some posting legs remain missing");
    await FinanceOperation.updateOne({ _id: id, leaseOwner: owner }, { $set: { state: "complete" }, $unset: { leaseOwner: "", leaseUntil: "", error: "" } });
    return true;
  } catch (error) {
    await FinanceOperation.updateOne({ _id: id, leaseOwner: owner }, {
      $set: { state: (error as ApiError).code === "LEDGER_CONTENT_CONFLICT" ? "conflict" : "pending", error: String(error).slice(0, 2000), nextAttemptAt: new Date(Date.now() + Math.min(3600_000, 1000 * 2 ** Math.min(op.attempts, 12))) },
      $unset: { leaseOwner: "", leaseUntil: "" },
    });
    return false;
  }
}

export async function runFinanceOperation<T>(input: {
  action: string; actorId: string; requestKey: string; fingerprint: unknown;
  work: () => Promise<{ result: T; postings: LedgerPosting[]; sourceId?: unknown; vendorId?: unknown }>;
}): Promise<{ data: T; operationId: string; bookkeepingState: "complete" | "pending" }> {
  const key = `${input.actorId}:${input.action}:${input.requestKey}`;
  const fingerprint = financialFingerprint(input.fingerprint);
  const check = (op: { fingerprint: string }) => {
    if (op.fingerprint !== fingerprint) throw new ApiError("Request key was used for a different change", 409, "REQUEST_KEY_CONFLICT");
  };
  let op = await financeQuery(FinanceOperation.findOne({ key })).lean();
  if (op) check(op);
  else {
    try {
      op = await financeTransaction(input.action, async () => {
        const previous = await financeQuery(FinanceOperation.findOne({ key })).lean();
        if (previous) { check(previous); return previous; }
        const { result, postings, sourceId, vendorId } = await input.work();
        const [created] = await FinanceOperation.create([{
          key, fingerprint, action: input.action, actorId: input.actorId, sourceId: sourceId ? String(sourceId) : undefined,
          vendorId, occurredAt: new Date(), postings: await prepareFinancePostings(postings), result,
        }], { session: financeSession() });
        return created.toObject();
      });
    } catch (error) {
      if (error instanceof TransactionOutcomeUnknownError || (error as { code?: number }).code === 11000) {
        op = await FinanceOperation.findOne({ key }).lean();
        if (!op) throw new ApiError("The result is not confirmed. Retry with the same request key.", 503, "FINANCE_OUTCOME_UNKNOWN");
        check(op);
      } else if (error instanceof TransactionsUnavailableError) {
        throw new ApiError("Finance writes require a MongoDB replica set with transactions.", 503, "TRANSACTIONS_UNAVAILABLE");
      } else if (error instanceof TransactionContendedError) throw staleFinance();
      else throw error;
    }
  }
  if (financeSession()) return { data: op!.result as T, operationId: String(op!._id), bookkeepingState: "pending" };
  const complete = await finishFinanceOperation(op!._id);
  return { data: op!.result as T, operationId: String(op!._id), bookkeepingState: complete ? "complete" : "pending" };
}

export async function recoverFinanceOperations(limit = 100, budgetMs = 10_000) {
  const started = Date.now();
  const rows = await FinanceOperation.find({ state: "pending", nextAttemptAt: { $lte: new Date() } }).sort({ nextAttemptAt: 1, _id: 1 }).limit(limit).select("_id").lean();
  let completed = 0;
  for (const row of rows) { if (Date.now() - started >= budgetMs) break; if (await finishFinanceOperation(row._id)) completed++; }
  return { completed, pending: await FinanceOperation.countDocuments({ state: "pending" }), conflicts: await FinanceOperation.countDocuments({ state: "conflict" }) };
}
