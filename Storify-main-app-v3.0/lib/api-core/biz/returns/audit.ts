import { createHash } from "node:crypto";
import { Types, type ClientSession } from "mongoose";
import { AuditLog } from "@/models/audit-log.model";
import type { ReturnContext } from "./context";

/** A permanent event identity participates in the business transaction. */
export async function recordReturnOrderEvent(input: { operationId: string; leg: string; actorId: string; context: ReturnContext; orderId: unknown; orderNumber: string; action: "STATUS_CHANGE" | "REFUND"; summary: string; metadata?: Record<string, unknown>; session: ClientSession }) {
  const id = new Types.ObjectId(createHash("sha256").update(`biz:${input.operationId}:audit:${input.leg}`).digest("hex").slice(0, 24));
  if (await AuditLog.exists({ _id: id }).session(input.session)) return;
  await AuditLog.create([{ _id: id, action: input.action, resource: "order", resourceId: String(input.orderId), resourceName: `Order #${input.orderNumber}`, ...(Types.ObjectId.isValid(input.actorId) ? { userId: new Types.ObjectId(input.actorId) } : {}), userRole: input.context.workspace.kind, ...(input.context.workspace.workspace === "vendor" ? { actorVendorId: new Types.ObjectId(input.context.workspace.vendor.id) } : {}), changes: { summary: input.summary }, metadata: { source: "biz-return", bizOperationId: input.operationId, bizOperationLeg: input.leg, ...input.metadata }, success: true, createdAt: new Date() }], { session: input.session, ordered: true });
}
