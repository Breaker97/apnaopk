import { Types } from "mongoose";
import {
  buildStaffOrderScopeFilter,
  buildStaffProductScopeFilter,
  hasStaffScope,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import type { BizWorkspaceGrant } from "./actor";
import { buildVendorStaffReturnFilter } from "@/lib/returns/return-staff-scope";

/**
 * What a business-app request may reach, from its workspace grant. Every
 * query a biz handler writes goes through one of the filters below (TDD
 * §2.7: no query without its scope), built from the website's own scope
 * functions so the app and the dashboards see the same records:
 *
 * - `store`: an administrator; everything.
 * - `staff`: the store's staff (scoped to sellers, locations or regions, or
 *   not at all) or a seller's staff (their seller's whole orders only).
 * - `vendor`: a seller; their own records, and of an order their own
 *   consignment.
 */
export type BizScope =
  | { kind: "store" }
  | { kind: "staff"; staff: StaffAccessScope; vendorOwned: boolean }
  | { kind: "vendor"; vendorId: string };

export function scopeOf(grant: BizWorkspaceGrant): BizScope {
  if (grant.kind === "admin") return { kind: "store" };
  if (grant.kind === "staff") {
    return { kind: "staff", staff: grant.staffScope, vendorOwned: grant.workspace === "vendor" };
  }
  return { kind: "vendor", vendorId: grant.vendor.id };
}

/** The vendor id as the documents store it: aggregation `$match` does not cast. */
function vendorObjectId(vendorId: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(vendorId) ? new Types.ObjectId(vendorId) : null;
}

const NOTHING = { _id: { $exists: false } };

/**
 * The orders in scope. A seller's are those with a consignment of theirs;
 * narrowing each one to that consignment is the handler's job, as the vendor
 * order list does (`toVendorOrderView`).
 */
export function orderScopeFilter(scope: BizScope): Record<string, unknown> {
  if (scope.kind === "store") return {};
  if (scope.kind === "staff") return buildStaffOrderScopeFilter(scope.staff);
  const vendorId = vendorObjectId(scope.vendorId);
  return vendorId ? { "subOrders.vendorId": vendorId } : NOTHING;
}

/** The products in scope. */
export function productScopeFilter(scope: BizScope): Record<string, unknown> {
  if (scope.kind === "store") return {};
  if (scope.kind === "staff") return buildStaffProductScopeFilter(scope.staff);
  const vendorId = vendorObjectId(scope.vendorId);
  return vendorId ? { vendorId } : NOTHING;
}

/** Limited to part of the store (GET /me's `scoped`). */
export function isScoped(scope: BizScope): boolean {
  if (scope.kind === "store") return false;
  if (scope.kind === "vendor") return true;
  return scope.vendorOwned || hasStaffScope(scope.staff);
}

/**
 * The staff member's own location limits, for the inventory location scope
 * (`productStockScope(ownerVendorId, staffLocationIds(scope))` in
 * lib/inventory/inventory-location-scope.ts). Empty for everyone else.
 */
export function staffLocationIds(scope: BizScope): string[] {
  return scope.kind === "staff" ? scope.staff.locationIds : [];
}

/** Return ownership AND its order scope must both be checked; never use this alone. */
export function returnOwnershipFilter(scope: BizScope): Record<string, unknown> {
  if (scope.kind === "store" || (scope.kind === "staff" && !scope.vendorOwned)) return {};
  if (scope.kind === "staff") return buildVendorStaffReturnFilter(scope.staff);
  const vendorId = vendorObjectId(scope.vendorId);
  return vendorId ? { $or: [
    { ownerType: "vendor", ownerVendorId: vendorId },
    // Legacy returns are visible only when every item belongs to this seller.
    { ownerType: { $exists: false }, vendorIds: [vendorId] },
  ] } : NOTHING;
}

/** Limited operators select only customers of currently visible orders. */
export function customerOrderScopeFilter(scope: BizScope): Record<string, unknown> {
  return orderScopeFilter(scope);
}

/** A constrained customer selector must never fall back to the global user directory. */
export function customerDirectoryIsGlobal(scope: BizScope): boolean {
  return scope.kind === "store" || (scope.kind === "staff" && !isScoped(scope));
}
