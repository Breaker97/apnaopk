import type { ClientSession } from "mongoose";
import type { ManualOrderAddressRequest } from "@/contracts/mobile/biz/v1/order-creation";
import { assertCapability } from "@/lib/api-core/biz/access";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import type { BizScope } from "@/lib/api-core/biz/scope";
import { MobileApiError } from "@/lib/api-core/errors";

export type CreationContext = {
  workspace: BizWorkspaceGrant;
  scope: BizScope;
  actorId: string;
  locale: string;
};
export type CreationSession = ClientSession | null;

export function creationRefusal(reason: string, message: string, status = 409): never {
  throw new MobileApiError(status, status === 403 ? "AUTHORIZATION_ERROR" : "CONFLICT", message, { reason });
}

export function assertCanCreate(context: CreationContext) {
  assertCapability(context.workspace, "CREATE_ORDERS");
  // Vendor staff have no manual creation surface, including crafted grants.
  if (context.workspace.workspace === "vendor" && context.workspace.kind === "staff") {
    throw new MobileApiError(403, "AUTHORIZATION_ERROR", "Vendor staff cannot create orders.");
  }
  if (context.workspace.workspace === "vendor" && context.workspace.vendor.mode !== "approved") {
    throw new MobileApiError(403, "VENDOR_NOT_ACTIVE", "The shop is not open for new orders.");
  }
}

/** The order schema uses fullName and requires a region even where none exists. */
export function storedOrderAddress(address: ManualOrderAddressRequest) {
  const { name, ...rest } = address;
  return { ...rest, fullName: name, state: address.state || "N/A", country: address.country.toUpperCase() };
}
