import { Types } from "mongoose";
import type { BizUploadRequest } from "@/contracts/mobile/biz/v1/uploads";
import { connectDB } from "@/lib/db";
import { Order, Product, ReturnRequest } from "@/models";
import { ensureDefaultVendorId } from "@/lib/vendors/multi-vendor";
import { adminProductCreateVendorId, storeProfileUnavailable } from "@/lib/inventory/inventory-location-scope";
import { vendorMediaScope } from "@/lib/storage/key";
import { MobileApiError } from "@/lib/api-core/errors";
import { assertCapability } from "./access";
import type { BizWorkspaceGrant } from "./actor";
import { orderScopeFilter, productScopeFilter, returnOwnershipFilter, scopeOf } from "./scope";

interface BizUploadContext {
  workspaceId: string;
  ownerVendorId?: string;
  ownerScope?: string;
}
const missing = () => new MobileApiError(404, "NOT_FOUND", "Upload target not found.");
/** Owner and permission come only from the refreshed workspace grant and scoped target. */
export async function authorizeBizUploadTarget(input: {
  request: BizUploadRequest; actorId: string; grant: BizWorkspaceGrant; access?: "read" | "write";
}): Promise<BizUploadContext> {
  const { target, purpose } = input.request;
  const productPurpose = purpose === "product_media" || purpose === "digital_asset" || purpose === "digital_preview";
  if (productPurpose !== (target.kind === "product" || target.kind === "product_draft")) {
    throw new MobileApiError(400, "VALIDATION_ERROR", "This file purpose does not match the target.", { reason: "UPLOAD_TARGET_CHANGED" });
  }
  const grant = input.grant;
  const scope = scopeOf(grant);
  assertCapability(grant, productPurpose ? target.kind === "product_draft" ? "CREATE_PRODUCTS" : input.access === "read" ? "VIEW_PRODUCTS" : "EDIT_PRODUCTS" : input.access === "read" ? "VIEW_RETURNS" : "HANDLE_RETURNS");
  await connectDB();
  let ownerVendorId: string | undefined;
  if (target.kind === "product_draft") {
    ownerVendorId = grant.workspace === "vendor" ? grant.vendor.id
      : grant.kind === "staff" ? adminProductCreateVendorId(grant.staffScope) ?? undefined : undefined;
    if (!ownerVendorId) {
      const house = await ensureDefaultVendorId({ preferredOwnerId: input.actorId });
      if (!house.vendorId) throw storeProfileUnavailable(house.problem);
      ownerVendorId = house.vendorId;
    }
  } else {
    if (!Types.ObjectId.isValid(target.id)) throw missing();
    if (target.kind === "product") {
      const product = await Product.findOne({ _id: target.id, ...productScopeFilter(scope) }).select("vendorId").lean<{ vendorId?: unknown } | null>();
      if (!product) throw missing();
      ownerVendorId = product.vendorId ? String(product.vendorId) : undefined;
    } else {
      const returned = target.kind === "return"
        ? await ReturnRequest.findOne({ _id: target.id, ...returnOwnershipFilter(scope) }).select("orderId ownerVendorId").lean<{ orderId: unknown; ownerVendorId?: unknown } | null>() : null;
      if (target.kind === "return" && !returned) throw missing();
      const order = await Order.exists({ _id: returned?.orderId ?? target.id, ...orderScopeFilter(scope) });
      if (!order) throw missing();
      ownerVendorId = grant.workspace === "vendor" ? grant.vendor.id : returned?.ownerVendorId ? String(returned.ownerVendorId) : undefined;
    }
  }
  return { workspaceId: grant.workspace === "vendor" ? grant.vendor.id : "platform", ownerVendorId,
    ownerScope: ownerVendorId ? vendorMediaScope(ownerVendorId) : undefined };
}
