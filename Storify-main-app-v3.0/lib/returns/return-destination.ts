import "server-only";

import { Types } from "mongoose";
import { Order, Vendor } from "@/models";
import { InventoryLocation } from "@/models/inventory-location.model";
import { ValidationError } from "@/lib/api/errors";
import { findDefaultVendorIdReadOnly } from "@/lib/vendors/multi-vendor";
import {
  locationOwnerFilter,
  vendorLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import { resolveShipFrom } from "@/lib/shipping/shipments";
import { RETURN_STATUS } from "@/lib/returns/returns";
import {
  RETURN_METHOD_CHANGEABLE_STATUSES,
  customReturnInstructions,
  isReturnLabelUrl,
  isReturnMethod,
  returnMethodOf,
  type ReturnDestination,
} from "@/lib/returns/return-shipping";

/**
 * Where an approved return's parcel is sent, and what approving one writes.
 *
 * A return belongs to whoever sold the goods (see `planReturnRequest`): the
 * store's own lines come back to the store, a seller's to that seller. So the
 * parcel goes to one of the OWNER's locations: the one ticked "Receive returns
 * here", else the one the parcel was dispatched from, else the default. An
 * owner with no locations at all is sent the address its parcels ship from.
 */

type ReturnOwnerLike = {
  _id?: unknown;
  orderId?: unknown;
  ownerType?: string | null;
  ownerVendorId?: unknown;
  vendorIds?: unknown[] | null;
};

/** One place a parcel may be sent, as the approve dialog lists it. */
interface ReturnLocationOption {
  _id: string;
  name: string;
  address: string;
  isDefault: boolean;
  acceptsReturns: boolean;
}

/** An id, whether it arrived bare or as a populated document. */
function idOf(value: unknown): string {
  if (!value) return "";
  if (typeof value === "object" && "_id" in (value as Record<string, unknown>)) {
    return String((value as { _id: unknown })._id || "");
  }
  return String(value);
}

/** The vendor record whose locations a return goes back to. */
async function returnOwnerVendorId(
  returnRequest: ReturnOwnerLike,
): Promise<string | null> {
  if (returnRequest.ownerType === "vendor") {
    const owner = idOf(returnRequest.ownerVendorId);
    if (owner) return owner;
  }
  return findDefaultVendorIdReadOnly();
}

/** The owner's active locations, default first — through the location scope. */
export async function listReturnLocations(
  returnRequest: ReturnOwnerLike,
): Promise<ReturnLocationOption[]> {
  const ownerId = await returnOwnerVendorId(returnRequest);
  if (!ownerId) return [];
  const rows = await InventoryLocation.find(
    locationOwnerFilter(vendorLocationScope(ownerId), { isActive: true }),
  )
    .select("name address isDefault acceptsReturns")
    .sort({ isDefault: -1, name: 1 })
    .lean<
      Array<{
        _id: unknown;
        name?: string;
        address?: string;
        isDefault?: boolean;
        acceptsReturns?: boolean;
      }>
    >();
  return rows.map((row) => ({
    _id: String(row._id),
    name: String(row.name || ""),
    address: String(row.address || ""),
    isDefault: Boolean(row.isDefault),
    acceptsReturns: Boolean(row.acceptsReturns),
  }));
}

/**
 * The location a parcel goes to when nobody picks one. The ones ticked to
 * receive returns win; with none ticked, the place it was dispatched from,
 * then the default.
 */
export function chooseReturnLocation(
  locations: ReadonlyArray<ReturnLocationOption>,
  dispatchedFromId?: string | null,
): ReturnLocationOption | null {
  const accepting = locations.filter((location) => location.acceptsReturns);
  const pool = accepting.length > 0 ? accepting : locations;
  return (
    pool.find((location) => location._id === dispatchedFromId) ??
    pool.find((location) => location.isDefault) ??
    pool[0] ??
    null
  );
}

/** The branch this return's consignment left from, when the order recorded one. */
async function dispatchedFromLocationId(
  returnRequest: ReturnOwnerLike,
): Promise<string | null> {
  const orderId = idOf(returnRequest.orderId);
  if (!Types.ObjectId.isValid(orderId)) return null;
  const order = await Order.findById(orderId)
    .select("subOrders.vendorId subOrders.fulfillment")
    .lean<{
      subOrders?: Array<{
        vendorId?: unknown;
        fulfillment?: {
          method?: string;
          fulfillmentLocationId?: unknown;
          pickup?: { pickupLocationId?: unknown };
        };
      }>;
    } | null>();
  const subOrders = order?.subOrders || [];
  const sellerId = idOf(returnRequest.vendorIds?.[0] ?? returnRequest.ownerVendorId);
  const sub =
    subOrders.find((candidate) => String(candidate.vendorId || "") === sellerId) ??
    (subOrders.length === 1 ? subOrders[0] : undefined);
  const fulfillment = sub?.fulfillment;
  const id =
    fulfillment?.method === "pickup"
      ? fulfillment.pickup?.pickupLocationId
      : fulfillment?.fulfillmentLocationId;
  return id ? String(id) : null;
}

/** The location this return's parcel goes to when nobody picks one. */
export async function defaultReturnLocation(
  returnRequest: ReturnOwnerLike,
  locations: ReadonlyArray<ReturnLocationOption>,
): Promise<ReturnLocationOption | null> {
  if (locations.length === 0) return null;
  return chooseReturnLocation(
    locations,
    await dispatchedFromLocationId(returnRequest),
  );
}

/**
 * The address the owner's parcels ship from, on one line — for an owner with
 * no location, or a location with no address written on it.
 */
export async function fallbackReturnDestination(
  returnRequest: ReturnOwnerLike,
  settings: Parameters<typeof resolveShipFrom>[0]["settings"],
): Promise<ReturnDestination | null> {
  const ownerId = await returnOwnerVendorId(returnRequest);
  const vendor = ownerId
    ? await Vendor.findById(ownerId)
        .select("storeName shipping.origin address")
        .lean<Parameters<typeof resolveShipFrom>[0]["vendor"] | null>()
    : null;
  const { address } = resolveShipFrom({ vendor, settings });
  const line = [
    address.street,
    address.apartment,
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(" "),
    address.country,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
  if (!line) return null;
  return { name: address.fullName || undefined, address: line };
}

/**
 * Where this return's parcel goes: the location asked for, which must be one
 * of the owner's, or the default choice.
 */
export async function resolveReturnDestination(
  returnRequest: ReturnOwnerLike,
  settings: Parameters<typeof resolveShipFrom>[0]["settings"],
  requestedLocationId?: string | null,
): Promise<ReturnDestination | null> {
  const locations = await listReturnLocations(returnRequest);
  let chosen: ReturnLocationOption | null = null;
  if (requestedLocationId) {
    chosen =
      locations.find((location) => location._id === String(requestedLocationId)) ??
      null;
    if (!chosen) {
      throw new ValidationError(
        "Choose one of the places this return can be sent back to",
      );
    }
  } else if (locations.length > 0) {
    chosen = chooseReturnLocation(
      locations,
      await dispatchedFromLocationId(returnRequest),
    );
  }

  if (!chosen) return fallbackReturnDestination(returnRequest, settings);

  const address =
    chosen.address.trim() ||
    (await fallbackReturnDestination(returnRequest, settings))?.address ||
    "";
  return {
    locationId: new Types.ObjectId(chosen._id),
    name: chosen.name,
    address,
  };
}

/** A return as the approval reads it. */
type ReturnBeforeUpdate = ReturnOwnerLike & {
  status?: string | null;
  returnMethod?: string | null;
  returnTo?: ReturnDestination | null;
  shipment?: { labelUrl?: string | null; labelFileKey?: string | null } | null;
};

/** What a request may say about how the parcel comes back. */
interface ReturnShippingInput {
  status?: string;
  returnMethod?: string;
  returnToLocationId?: string;
  labelUrl?: string;
}

/**
 * The fields that approving a return, or changing how its parcel comes back,
 * writes. Empty when the request does neither.
 *
 * Approving without saying how is the shopper posting it, which is what every
 * approval meant before the question was asked.
 */
export async function returnShippingUpdates(params: {
  before: ReturnBeforeUpdate;
  body: ReturnShippingInput;
  settings: Parameters<typeof resolveShipFrom>[0]["settings"] &
    Parameters<typeof customReturnInstructions>[0];
}): Promise<Record<string, unknown>> {
  const { before, body, settings } = params;
  const approving =
    body.status === RETURN_STATUS.APPROVED &&
    String(before.status || "") === RETURN_STATUS.REQUESTED;
  const touching =
    body.returnMethod !== undefined ||
    body.returnToLocationId !== undefined ||
    body.labelUrl !== undefined;
  if (!approving && !touching) return {};

  if (
    !approving &&
    !(RETURN_METHOD_CHANGEABLE_STATUSES as readonly string[]).includes(
      String(before.status || ""),
    )
  ) {
    throw new ValidationError(
      String(before.status || "") === RETURN_STATUS.REQUESTED
        ? "Approve this return to say how it comes back."
        : "This return's parcel is already on its way or back, so how it comes back can no longer be changed.",
    );
  }
  if (body.returnMethod !== undefined && !isReturnMethod(body.returnMethod)) {
    throw new ValidationError("Choose how the parcel comes back");
  }

  const previousMethod = before.returnMethod ? returnMethodOf(before.returnMethod) : null;
  const method = returnMethodOf(body.returnMethod ?? before.returnMethod);
  const updates: Record<string, unknown> = { returnMethod: method };

  const labelUrl =
    body.labelUrl === undefined ? undefined : String(body.labelUrl).trim();
  if (labelUrl) {
    if (!isReturnLabelUrl(labelUrl)) {
      throw new ValidationError("Give the label as a web link, starting with https://");
    }
    updates["shipment.labelUrl"] = labelUrl;
    updates["shipment.labelAddedAt"] = new Date();
  } else if (labelUrl === "") {
    updates["shipment.labelUrl"] = "";
  }

  if (method === "label") {
    const hasLink =
      labelUrl === undefined ? Boolean(before.shipment?.labelUrl) : Boolean(labelUrl);
    if (!hasLink && !before.shipment?.labelFileKey) {
      throw new ValidationError("Upload the return label, or give its link, first.");
    }
  }

  if (method === "no_shipping") {
    // Nothing is posted, so there is nowhere to send it and nothing to say.
    updates.returnTo = null;
    updates.returnInstructions = null;
    return updates;
  }

  const fromNothing = previousMethod === "no_shipping";
  if (
    approving ||
    fromNothing ||
    body.returnToLocationId !== undefined ||
    !before.returnTo
  ) {
    updates.returnTo = await resolveReturnDestination(
      before,
      settings,
      body.returnToLocationId || null,
    );
  }
  if (approving || fromNothing) {
    // The store's wording as it stands now, kept with the return so editing
    // the settings later does not rewrite what this shopper was told.
    updates.returnInstructions = customReturnInstructions(settings) ?? null;
  }
  return updates;
}
