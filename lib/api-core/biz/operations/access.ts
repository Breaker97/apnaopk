import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { UploadTarget } from "@/contracts/mobile/biz/v1/uploads";
import { assertCapability } from "@/lib/api-core/biz/access";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import type { StoredBizOperation } from "@/lib/api-core/biz/durable-operation";
import { authorizeManualOrderResources } from "@/lib/api-core/biz/order-creation/create";
import { authorizeOrderContactResources } from "@/lib/api-core/biz/order-creation/contacts";
import { deletedReceiptScope } from "@/lib/api-core/biz/products/editor-write";
import { authorizeReturnOperation } from "@/lib/api-core/biz/returns/operation-access";
import { productScopeFilter, type BizScope } from "@/lib/api-core/biz/scope";
import { authorizeBizUploadTarget } from "@/lib/api-core/biz/upload-context";
import { MobileApiError } from "@/lib/api-core/errors";
import { Product } from "@/models/product.model";
import { BizProductWrite } from "@/models/biz-product-write.model";
import { BizUploadRecord } from "@/models/biz-upload.model";

export const operationNotFound = () => new MobileApiError(404, "NOT_FOUND", "Operation not found.");
type OperationAccessContext = { actorId: string; workspace: BizWorkspaceGrant; scope: BizScope; locale: string };

async function authorizeProductOperation(operation: StoredBizOperation, context: OperationAccessContext) {
  const id = operation.routeId === "products.create"
    ? createHash("sha256").update(`${operation.actorId}:${operation.key}`).digest("hex").slice(0, 24) : operation.target;
  if (!Types.ObjectId.isValid(id)) throw operationNotFound();
  const receipt = await BizProductWrite.findOne({ operationId: operation.id, productId: id }).select("kind").lean();
  if (operation.routeId === "products.create") assertCapability(context.workspace, "CREATE_PRODUCTS");
  else if (operation.routeId === "products.editor.save") assertCapability(context.workspace, "EDIT_PRODUCTS");
  else {
    const action = operation.checkpoint?.action;
    if (action === "delete" || receipt?.kind === "delete") assertCapability(context.workspace, "DELETE_PRODUCTS");
    else {
      assertCapability(context.workspace, "EDIT_PRODUCTS");
      // Old unconfirmed attempts carry no immutable proof of which action was tapped.
      if (typeof action !== "string" && !receipt) assertCapability(context.workspace, "DELETE_PRODUCTS");
    }
  }
  if (operation.resources.some((resource) => resource.kind !== "product" || resource.id !== id)) throw operationNotFound();
  const product = await Product.exists({ _id: id, ...productScopeFilter(context.scope) });
  if (product) return;
  const deleted = await BizProductWrite.exists({ productId: id, kind: "delete", ...deletedReceiptScope(context.scope) });
  if (deleted) return;
  // A create attempt may precede its product. A product outside scope is never treated as absent.
  if (operation.routeId === "products.create" && !operation.resources.length && !receipt && !await Product.exists({ _id: id })) return;
  throw operationNotFound();
}

async function authorizeUploadOperation(operation: StoredBizOperation, context: OperationAccessContext) {
  const split = operation.target.indexOf(":");
  const target = UploadTarget.safeParse({ kind: operation.target.slice(0, split), id: operation.target.slice(split + 1) });
  if (!target.success) throw operationNotFound();
  const row = await BizUploadRecord.findOne({ operationId: operation.id, actorId: context.actorId,
    workspaceId: operation.workspaceId }).lean();
  const request = row ? { purpose: row.purpose, target: row.target }
    : { purpose: target.data.kind === "product" || target.data.kind === "product_draft" ? "product_media" as const : "return_evidence" as const, target: target.data };
  if (request.target.kind !== target.data.kind || request.target.id !== target.data.id) throw operationNotFound();
  const owner = await authorizeBizUploadTarget({ request, actorId: context.actorId, grant: context.workspace });
  if (row && row.ownerVendorId !== owner.ownerVendorId) throw operationNotFound();
  for (const resource of operation.resources) {
    if (resource.kind !== "upload" || !Types.ObjectId.isValid(resource.id) || !row || String(row._id) !== resource.id) throw operationNotFound();
  }
}

/** All targets and refs are reauthorized, without interpreting or returning result snapshots. */
export async function authorizeBizOperation(operation: StoredBizOperation, context: OperationAccessContext): Promise<void> {
  if (operation.actorId !== context.actorId || operation.workspace !== context.workspace.workspace ||
    operation.workspaceId !== (context.workspace.workspace === "vendor" ? context.workspace.vendor.id : "platform")) throw operationNotFound();
  switch (operation.routeId) {
    case "orders.creation.create": return authorizeManualOrderResources(context, operation.resources);
    case "orders.creation.contacts.create": return authorizeOrderContactResources(context, operation.resources);
    case "products.create": case "products.editor.save": case "products.editor.action": return authorizeProductOperation(operation, context);
    case "uploads.create": return authorizeUploadOperation(operation, context);
    case "returns.create": case "returns.action": case "refunds.execute": return authorizeReturnOperation(operation, context);
    default: throw operationNotFound();
  }
}
