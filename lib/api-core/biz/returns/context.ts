import { createHash } from "node:crypto";
import { Types, type ClientSession } from "mongoose";
import { Order, ReturnRequest } from "@/models";
import type { IReturnRequest } from "@/models/return-request.model";
import type { IOrder } from "@/types";
import { getSettings, type ISettings } from "@/models/settings.model";
import { connectDB } from "@/lib/db";
import { MobileApiError } from "@/lib/api-core/errors";
import { assertCapability, grantCan } from "@/lib/api-core/biz/access";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { orderScopeFilter, type BizScope } from "@/lib/api-core/biz/scope";
import { vendorReturnsFilter } from "@/lib/returns/return-stats";
import { buildVendorStaffReturnFilter } from "@/lib/returns/return-staff-scope";
import { listReturnLocations } from "@/lib/returns/return-destination";
import { runTransaction } from "@/lib/db-transaction";
import { ValidationError } from "@/lib/api/errors";
import { DefiniteOperationFailure } from "@/lib/api-core/biz/durable-operation";

export type ReturnRecord = IReturnRequest & { __v?: number };
export type ReturnOrder = IOrder & { __v?: number };
export interface ReturnContext { workspace: BizWorkspaceGrant; scope: BizScope }
export const returnNotFound = () => new MobileApiError(404, "NOT_FOUND", "Return not found.");
export function refuse(reason: string, message: string, status = 409): never { throw new MobileApiError(status, status === 403 ? "AUTHORIZATION_ERROR" : "CONFLICT", message, { reason }); }
export function recordVersion(record: { _id: unknown; updatedAt?: Date; __v?: number }): string {
  return `"${createHash("sha256").update(JSON.stringify([String(record._id), record.updatedAt?.toISOString() ?? null, record.__v ?? 0])).digest("hex").slice(0, 32)}"`;
}
export function assertVersion(record: Parameters<typeof recordVersion>[0], version: string, reason = "RETURN_STATE_CHANGED"): void {
  if (recordVersion(record) !== version) refuse(reason, "This record changed. Refresh it and review the operation again.");
}
export function returnOwnerFilter(scope: BizScope): Record<string, unknown> {
  if (scope.kind === "vendor") return Types.ObjectId.isValid(scope.vendorId) ? vendorReturnsFilter(new Types.ObjectId(scope.vendorId)) : { _id: null };
  if (scope.kind === "staff" && scope.vendorOwned) return buildVendorStaffReturnFilter(scope.staff);
  return {};
}
export async function scopedReturnOrder(id: string, context: ReturnContext, session?: ClientSession): Promise<ReturnOrder> {
  await connectDB();
  if (!Types.ObjectId.isValid(id)) throw returnNotFound();
  const order = await Order.findOne({ _id: id, ...orderScopeFilter(context.scope) }, undefined, session ? { session } : undefined).lean<ReturnOrder | null>();
  if (!order) throw returnNotFound();
  return order;
}
export async function scopedReturn(id: string, context: ReturnContext, session?: ClientSession): Promise<{ returned: ReturnRecord; order: ReturnOrder }> {
  await connectDB();
  if (!Types.ObjectId.isValid(id)) throw returnNotFound();
  const returned = await ReturnRequest.findOne({ _id: id, ...returnOwnerFilter(context.scope) }, undefined, session ? { session } : undefined).lean<ReturnRecord | null>();
  if (!returned) throw returnNotFound();
  return { returned, order: await scopedReturnOrder(String(returned.orderId), context, session) };
}
export function onlyVendorId(context: ReturnContext): string | undefined {
  return context.workspace.workspace === "vendor" ? context.workspace.vendor.id : undefined;
}
export function assertReturnHandling(context: ReturnContext) { assertCapability(context.workspace, "HANDLE_RETURNS"); }
export function assertReturnOverride(context: ReturnContext, override: unknown) {
  if (override) assertCapability(context.workspace, "OVERRIDE_RETURN_ELIGIBILITY");
}
export function canSettleVendorReturn(returned: ReturnRecord, context: ReturnContext): boolean {
  return context.workspace.workspace === "vendor" && returned.refundPayer === "vendor" && returned.ownerType === "vendor" && String(returned.ownerVendorId) === context.workspace.vendor.id && grantCan(context.workspace, "RECORD_REFUND_SETTLEMENT");
}
export async function authorizedReturnLocations(returned: Parameters<typeof listReturnLocations>[0], context: ReturnContext) {
  const locations = await listReturnLocations(returned);
  const assigned = context.scope.kind === "staff" ? context.scope.staff.locationIds : [];
  return locations.filter((location) => assigned.length === 0 || assigned.includes(location._id));
}
export async function returnSettings(): Promise<ISettings> { return getSettings(); }
/** Validation escaping an aborted transaction is a proven pre-effect refusal. */
export async function runReturnTransaction<T>(label: string, task: (session: ClientSession) => Promise<T>): Promise<T> {
  try { return await runTransaction(label, task); }
  catch (error) {
    if (error instanceof ValidationError || (error instanceof MobileApiError && error.code === "CONFLICT")) {
      const reason = error instanceof MobileApiError ? error.options.reason : "RETURN_NOT_ELIGIBLE";
      throw new DefiniteOperationFailure({ status: error instanceof ValidationError ? error.statusCode : error.status, code: error instanceof ValidationError ? "VALIDATION_ERROR" : "CONFLICT", message: error.message, reason: reason === "QUOTE_EXPIRED" ? "REFUND_PREVIEW_EXPIRED" : reason === "QUOTE_CHANGED" ? "REFUND_PREVIEW_CHANGED" : reason });
    }
    throw error;
  }
}
