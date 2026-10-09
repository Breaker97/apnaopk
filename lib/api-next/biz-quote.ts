import { createHash, randomBytes } from "node:crypto";
import { connectDB } from "@/lib/db";
import { BizQuote, type StoredBizQuote } from "@/models/biz-quote.model";
import { MobileApiError } from "@/lib/api-core/errors";
import type { BizOperationBinding } from "@/lib/api-core/biz/durable-operation";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
type QuoteBinding = Pick<BizOperationBinding, "actorId" | "workspaceId" | "target" | "payloadHash">;
/** Persist a private, authoritative price/policy snapshot; the client receives only the token and priced DTO. */
export async function createBizQuote(input: {
  binding: QuoteBinding; purpose: StoredBizQuote["purpose"]; snapshot: Record<string, unknown>; expiresAt: Date;
}): Promise<{ token: string; expiresAt: string }> {
  await connectDB();
  if (input.expiresAt.getTime() <= Date.now()) throw new Error("Quote expiry must be in the future");
  const token = randomBytes(32).toString("base64url");
  await BizQuote.create({ tokenHash: hashToken(token), actorId: input.binding.actorId,
    workspaceId: input.binding.workspaceId, target: input.binding.target, requestHash: input.binding.payloadHash,
    purpose: input.purpose, snapshot: input.snapshot, expiresAt: input.expiresAt });
  return { token, expiresAt: input.expiresAt.toISOString() };
}
/** Atomically binds a fresh quote to one durable attempt; that attempt may reconcile after expiry. */
export async function claimBizQuote(input: {
  token: string; binding: QuoteBinding; purpose: StoredBizQuote["purpose"]; operationId: string;
  session?: import("mongoose").ClientSession;
}): Promise<StoredBizQuote> {
  await connectDB();
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token) || !input.operationId) throw new MobileApiError(409, "CONFLICT", "Preview this operation again.", { reason: "QUOTE_EXPIRED" });
  const row = await BizQuote.findOneAndUpdate({
    tokenHash: hashToken(input.token), actorId: input.binding.actorId, workspaceId: input.binding.workspaceId,
    target: input.binding.target, requestHash: input.binding.payloadHash, purpose: input.purpose,
    $or: [{ operationId: input.operationId }, { operationId: { $exists: false }, expiresAt: { $gt: new Date() } }],
  }, { $set: { operationId: input.operationId } }, { returnDocument: "after", ...(input.session ? { session: input.session } : {}) }).lean<StoredBizQuote | null>();
  if (!row) throw new MobileApiError(409, "CONFLICT", "The quote expired, changed, or belongs to another attempt. Preview again.", { reason: "QUOTE_CHANGED" });
  return row;
}
