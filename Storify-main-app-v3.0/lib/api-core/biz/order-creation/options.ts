import { Types } from "mongoose";
import type { ISettings } from "@/models/settings.model";
import { Settings } from "@/models/settings.model";
import { InventoryLocation } from "@/models/inventory-location.model";
import { Vendor } from "@/models/vendor.model";
import type { ManualOrderFormOptions } from "@/contracts/mobile/biz/v1/order-creation";
import { grantCan } from "@/lib/api-core/biz/access";
import { customerDirectoryIsGlobal, staffLocationIds } from "@/lib/api-core/biz/scope";
import { connectDB } from "@/lib/db";
import { MobileApiError } from "@/lib/api-core/errors";
import { getAllowedCountryOptions, countryCodeForValue } from "@/lib/intl/country-availability";
import { locationOwnerFilter, productStockScope } from "@/lib/inventory/inventory-location-scope";
import { getOrderItemVendorId } from "@/lib/orders/order-vendors";
import { assertCanCreate, type CreationContext, type CreationSession } from "./policy";

type CreationVendor = {
  _id: Types.ObjectId; storeName?: string; commission?: number; isDefault?: boolean;
  status?: string; storeActive?: boolean;
  updatedAt?: Date;
  address?: { country?: string; city?: string; state?: string; pincode?: string; phone?: string };
  shipping?: { codCollectedBy?: string };
};
type CreationLocation = {
  _id: Types.ObjectId; vendorId?: Types.ObjectId; name: string; isDefault?: boolean;
  address?: string; pickupArea?: string; instructions?: string; pickupEnabled?: boolean;
  fulfillsOnlineOrders?: boolean; updatedAt?: Date;
};

/** Use the same attribution as desktop creation, including a single-vendor store. */
export function creationProductOwner(product: { vendorId?: unknown }, settings: ISettings, vendors: CreationVendor[]) {
  const house = vendors.find((vendor) => vendor.isDefault);
  const isMultiVendorEnabled = settings.multiVendorMode?.enabled === true;
  if ((!isMultiVendorEnabled || !product.vendorId) && !house) return undefined;
  const vendorId = getOrderItemVendorId(product.vendorId, {
    isMultiVendorEnabled, defaultVendorId: house ? String(house._id) : null,
    fallbackVendorId: house ? String(house._id) : null,
  });
  return vendors.find((vendor) => String(vendor._id) === vendorId);
}

/** Reads live policy, never a settings cache; quotes and execution share this reader. */
export async function loadCreationOptions(context: CreationContext, session: CreationSession = null) {
  assertCanCreate(context);
  await connectDB();
  const settings = await Settings.findOne().session(session).lean<ISettings | null>();
  if (!settings) throw new MobileApiError(503, "SERVICE_UNAVAILABLE", "Store settings are unavailable.");
  const multiVendor = settings.multiVendorMode?.enabled === true;
  if (context.workspace.workspace === "vendor" && !multiVendor) {
    throw new MobileApiError(403, "WORKSPACE_NOT_AVAILABLE", "The vendor workspace is no longer available.");
  }
  const ownerFilter = context.workspace.workspace === "vendor"
    ? { _id: context.workspace.vendor.id }
    : context.scope.kind === "staff" && context.scope.staff.vendorIds.length
      ? { _id: { $in: context.scope.staff.vendorIds } }
      : multiVendor ? {} : { isDefault: true };
  const vendors = await Vendor.find(ownerFilter)
    .select("_id storeName commission isDefault status storeActive updatedAt address.country address.city address.state address.pincode address.phone shipping.codCollectedBy")
    .session(session).lean<CreationVendor[]>();
  const openVendors = vendors.filter((vendor) => vendor.isDefault || (vendor.status === "approved" && vendor.storeActive !== false));
  if (context.workspace.workspace === "vendor" && !openVendors.length) {
    throw new MobileApiError(403, "VENDOR_NOT_ACTIVE", "The shop is not open for new orders.");
  }
  const owners = openVendors.map((vendor) => String(vendor._id));
  const assigned = staffLocationIds(context.scope);
  const locationFilters = owners.map((owner) => locationOwnerFilter(productStockScope(owner, assigned), { isActive: { $ne: false } }));
  const locations = locationFilters.length ? await InventoryLocation.find({ $or: locationFilters })
    .select("_id vendorId name isDefault address pickupArea instructions pickupEnabled fulfillsOnlineOrders updatedAt")
    .sort({ isDefault: -1, name: 1 }).session(session).lean<CreationLocation[]>() : [];
  const currency = settings.general?.defaultCurrency || "USD";
  const canRecordPayment = grantCan(context.workspace, "RECORD_ORDER_PAYMENTS");
  const custody = context.workspace.workspace === "platform" ? "platform" as const : "vendor" as const;
  const options: ManualOrderFormOptions = {
    currency,
    countries: getAllowedCountryOptions(settings.general?.countryAvailability).map((country) => ({ code: country.value, name: country.label })),
    locations: locations.map((location) => ({ id: String(location._id), name: location.name, isDefault: location.isDefault === true })),
    delivery: [
      { id: "shipping", kind: "shipping", label: "Delivery", addressRequired: true },
      ...locations.filter((location) => location.pickupEnabled && location.address && location.vendorId &&
        countryCodeForValue(openVendors.find((vendor) => String(vendor._id) === String(location.vendorId))?.address?.country))
        .map((location) => ({ id: `pickup:${location._id}`, kind: "pickup" as const, label: location.name,
          locationId: String(location._id), addressRequired: false })),
    ],
    payments: [
      { id: "manual_pending", label: "Payment pending", custody, canRecordPayment: false },
      { id: "manual", label: "Manual payment", custody, canRecordPayment },
      { id: "cash", label: "Cash collected", custody, canRecordPayment },
      { id: "bank_transfer", label: "Bank transfer", custody, canRecordPayment },
    ],
    customerModes: [
      ...(grantCan(context.workspace, "VIEW_ORDER_CUSTOMERS") ? ["existing" as const] : []), "guest",
      ...(grantCan(context.workspace, "CREATE_ORDER_CONTACTS") && customerDirectoryIsGlobal(context.scope) ? ["create_contact" as const] : []),
    ],
    adjustableFields: ["shippingCost", "discount", "taxRate"],
    limits: { lines: 250, quantity: 999, quoteLifetimeSeconds: 300 },
  };
  return { options, settings, vendors: openVendors, locations };
}
