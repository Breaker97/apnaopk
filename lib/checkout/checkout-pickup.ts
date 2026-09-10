import { Cart, Vendor } from "@/models";
import { resolveItemShipping, type ProductShippingData, type VariantShippingData } from "@/lib/catalog/product-shipping";
import { CANONICAL_CART_WEIGHT_UNIT } from "@/lib/shipping/shipping";
import {
  pickupLocationsForVendor,
  type PickupLocationSettings,
} from "@/lib/checkout/pickup-locations";
import {
  branchCanFulfill,
  type BranchInventoryRow,
  type BranchStockLine,
} from "@/lib/inventory/pickup-branch-stock";

type PickupCartOwnership = {
  userId?: string;
  sessionId?: string;
};

export function pickupCheckoutCharges(_deliveryCharges: {
  shippingCost: number;
  dutyAmount: number;
}) {
  return { shippingCost: 0, dutyAmount: 0 };
}

export type PickupFulfillmentSnapshot = {
  method: "pickup";
  pickup: {
    vendorId: string;
    /**
     * Historical only. Orders placed under the removed slot-booking system
     * carry a reservation id and a window; nothing writes them now.
     */
    reservationId?: string;
    pickupLocationId: string;
    pickupLocationName: string;
    pickupArea?: string;
    pickupAddress: string;
    instructions?: string;
    /** Only meaningful alongside a booked window. */
    timeZone?: string;
    startAt?: Date;
    endAt?: Date;
    status: "scheduled" | "ready" | "collected";
  };
};

export function pickupFulfillmentSnapshot(input: {
  vendorId: string;
  reservationId?: string;
  pickupLocationId: string;
  pickupLocationName: string;
  pickupArea?: string;
  pickupAddress: string;
  instructions?: string;
  timeZone?: string;
  startAt?: Date;
  endAt?: Date;
}): PickupFulfillmentSnapshot {
  return {
    method: "pickup",
    pickup: {
      ...input,
      status: "scheduled",
    },
  };
}

export function serializePickupFulfillmentMetadata(
  fulfillment: PickupFulfillmentSnapshot | undefined,
): string {
  return fulfillment ? JSON.stringify(fulfillment) : "";
}

export function parsePickupFulfillmentMetadata(
  value: string | undefined,
): PickupFulfillmentSnapshot | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as PickupFulfillmentSnapshot;
    const pickup = parsed?.pickup;
    if (
      parsed?.method !== "pickup" ||
      !pickup?.vendorId ||
      !pickup?.pickupLocationId ||
      !pickup?.pickupAddress ||
      !["scheduled", "ready", "collected"].includes(pickup.status)
    ) {
      return undefined;
    }

    // A booked pickup carries a hold and a window; an open-hours one carries
    // neither. What is not allowed is half of a booking — a window without the
    // reservation that paid for it, or a start with no end.
    const booked = Boolean(pickup.reservationId);
    if (!booked) {
      return {
        method: "pickup",
        pickup: { ...pickup, startAt: undefined, endAt: undefined },
      };
    }

    const startAt = new Date(pickup.startAt as unknown as string);
    const endAt = new Date(pickup.endAt as unknown as string);
    if (
      !pickup.timeZone ||
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      endAt <= startAt
    ) {
      return undefined;
    }

    return {
      method: "pickup",
      pickup: {
        ...pickup,
        startAt,
        endAt,
      },
    };
  } catch {
    return undefined;
  }
}

type PickupCartLine = {
  vendorId: string;
  requiresShipping: boolean;
};

type PopulatedCartItem = {
  productId?: {
    _id?: { toString(): string };
    vendorId?: string | { _id?: { toString(): string } };
    shipping?: ProductShippingData;
    inventory?: {
      tracked?: boolean;
      continueSellingWhenOutOfStock?: boolean;
    } | null;
    locationInventory?: BranchInventoryRow[] | null;
    variants?: Array<
      VariantShippingData & {
        _id: { toString(): string };
        locationInventory?: BranchInventoryRow[] | null;
      }
    >;
  } | null;
  variantId?: string;
  quantity?: number;
};

/**
 * A pickup order can have exactly one physical-item fulfillment vendor.
 *
 * The two failure modes are told apart deliberately. No physical lines at all
 * is a download-only cart — there is nothing to collect, which is not the same
 * as a cart spanning several stores, and reporting it as the latter had
 * checkout telling shoppers their single-item ebook order "has items from
 * multiple stores".
 */
export function pickupVendorIdForCartItems(
  items: PickupCartLine[],
): { vendorId: string } | { reason: "digital_only" | "multi_vendor" } {
  const vendors = new Set(
    items.filter((item) => item.requiresShipping).map((item) => item.vendorId),
  );

  if (vendors.size === 0) return { reason: "digital_only" };
  if (vendors.size > 1) return { reason: "multi_vendor" };

  return { vendorId: Array.from(vendors)[0]! };
}

/** Identifies whose cart this is, for the eligibility lookup. */
function pickupOwnerKey(owner: PickupCartOwnership): string | null {
  if (owner.userId) return `user:${owner.userId}`;
  if (owner.sessionId) return `session:${owner.sessionId}`;
  return null;
}

type PickupEligibility =
  | {
      eligible: false;
      reason:
        | "cart_empty"
        | "digital_only"
        | "multi_vendor"
        | "not_configured";
    }
  | {
      eligible: true;
      cartId: string;
      ownerKey: string;
      vendorId: string;
      vendorName: string;
      locations: PickupLocationSettings[];
      /**
       * The cart, in the shape `lib/pickup-branch-stock.ts` reads.
       *
       * Carried on the eligibility rather than recomputed by each caller
       * because both of them — the anonymous availability endpoint that offers
       * the branches, and the resolver that re-validates the chosen one before
       * payment — have to reach the same verdict. Two readings of the same cart
       * is how an offer and its guard drift apart.
       */
      stockLines: BranchStockLine[];
    };

/** Returns the only vendor location fields a pre-order checkout may receive. */
export function pickupAvailabilityVendorDetails(input: {
  vendorId: string;
  vendorName: string;
  pickupArea?: string;
  timeZone?: string;
}) {
  const pickupArea = input.pickupArea?.trim();
  const timeZone = input.timeZone?.trim();

  return {
    id: input.vendorId,
    name: input.vendorName,
    ...(pickupArea ? { pickupArea } : {}),
    ...(timeZone ? { timeZone } : {}),
  };
}

/**
 * Public branch data only. The exact address and the pickup instructions stay
 * server-side until an order exists — the availability endpoint is anonymous,
 * so anything it returns is readable by anyone who can put an item in a cart.
 */
export function pickupAvailabilityLocationDetails(
  input: PickupLocationSettings,
) {
  const pickupArea = input.pickupArea?.trim();
  const timeZone = input.timeZone?.trim();

  return {
    id: input.id,
    name: input.name,
    ...(pickupArea ? { pickupArea } : {}),
    ...(timeZone ? { timeZone } : {}),
  };
}

/** Rebuilds pickup entitlement from the current cart and vendor profile. */
export async function resolvePickupEligibility(
  owner: PickupCartOwnership,
): Promise<PickupEligibility> {
  const ownerKey = pickupOwnerKey(owner);
  const cartQuery = owner.userId
    ? { userId: owner.userId }
    : owner.sessionId
      ? { sessionId: owner.sessionId }
      : null;
  if (!ownerKey || !cartQuery) return { eligible: false, reason: "cart_empty" };

  const cart = await Cart.findOne(cartQuery)
    .populate({
      path: "items.productId",
      // `locationInventory` and `inventory` ride along for the per-branch stock
      // check. They cost two more fields on a query this path already runs —
      // the alternative was a second read of the same products purely to answer
      // "does the Gulshan counter actually have this".
      select: "vendorId shipping inventory locationInventory variants",
    })
    .lean<{
      _id: { toString(): string };
      items?: PopulatedCartItem[];
    } | null>();
  if (!cart?.items?.length) return { eligible: false, reason: "cart_empty" };

  const physicalLines: PickupCartLine[] = [];
  const stockLines: BranchStockLine[] = [];
  for (const item of cart.items) {
    const product = item.productId;
    if (!product?.vendorId) continue;
    const variant = item.variantId
      ? product.variants?.find(
          (candidate) => candidate._id.toString() === String(item.variantId),
        )
      : undefined;
    const shipping = resolveItemShipping({
      productShipping: product.shipping,
      variantShipping: variant,
      quantity: item.quantity || 0,
      targetWeightUnit: CANONICAL_CART_WEIGHT_UNIT,
    });
    const vendorId = String(
      (product.vendorId as { _id?: { toString(): string } })._id?.toString() ||
        product.vendorId,
    );
    physicalLines.push({ vendorId, requiresShipping: shipping.requiresShipping });

    stockLines.push({
      productId: String(product._id?.toString() || ""),
      quantity: item.quantity || 0,
      policy: {
        shipping: product.shipping,
        inventory: product.inventory,
      },
      // A chosen variant keeps its own per-branch counts, so reading the
      // product's would answer about the wrong thing entirely.
      locationInventory: variant
        ? variant.locationInventory
        : product.locationInventory,
    });
  }

  const fulfillmentVendor = pickupVendorIdForCartItems(physicalLines);
  if ("reason" in fulfillmentVendor) {
    return { eligible: false, reason: fulfillmentVendor.reason };
  }
  const vendorId = fulfillmentVendor.vendorId;

  const [vendor, locations] = await Promise.all([
    Vendor.findById(vendorId)
      .select("storeName")
      .lean<{ storeName?: string } | null>(),
    pickupLocationsForVendor({ vendorId }),
  ]);
  if (!vendor || locations.length === 0) {
    return { eligible: false, reason: "not_configured" };
  }

  return {
    eligible: true,
    cartId: cart._id.toString(),
    ownerKey,
    vendorId,
    vendorName: vendor.storeName || "Vendor",
    locations,
    stockLines,
  };
}

/**
 * Which of a vendor's branches can hand over this whole basket.
 *
 * Branches that cannot are returned all the same, marked unavailable. Dropping
 * them would tell the shopper "collection is not possible" when the truth is
 * "not from the branch you were looking at" — and the branch they wanted is
 * exactly the thing they need named.
 */
export function pickupLocationAvailability(
  eligibility: Extract<PickupEligibility, { eligible: true }>,
): Array<PickupLocationSettings & { available: boolean }> {
  return eligibility.locations.map((location) => ({
    ...location,
    available: branchCanFulfill(eligibility.stockLines, location.id),
  }));
}

/**
 * Rebuilds the pickup a shopper is paying for, from the server's own view.
 *
 * Nothing the client sent is trusted beyond *which* branch and *which* hold —
 * the address, the branch name and the times are all re-read here, so a
 * tampered payload cannot put a different address on the order.
 *
 * Open-hours branches take the first path and never touch a reservation: there
 * is no time to hold and no capacity to consume.
 */
export async function resolvePickupCheckoutFulfillment(input: {
  owner: PickupCartOwnership;
  pickupLocationId?: string;
}): Promise<PickupFulfillmentSnapshot> {
  const eligibility = await resolvePickupEligibility(input.owner);
  if (!eligibility.eligible) throw new Error("Pickup is unavailable for this cart");

  const requestedLocationId = input.pickupLocationId?.trim();
  if (!requestedLocationId) throw new Error("Pickup location is required");

  const location = eligibility.locations.find(
    (candidate) => candidate.id === requestedLocationId,
  );
  if (!location) throw new Error("Pickup location is unavailable");

  // Re-checked here, not merely offered by the availability endpoint. That
  // endpoint is anonymous and its answer travels through the browser, so a
  // stale tab — or a crafted payload — could name a branch that has since sold
  // out. This runs on both payment routes BEFORE the charge, so the shopper is
  // turned back rather than billed for a collection nobody can hand over.
  if (!branchCanFulfill(eligibility.stockLines, location.id)) {
    throw new Error(
      `${location.name} does not have everything in your order right now`,
    );
  }

  return pickupFulfillmentSnapshot({
    vendorId: eligibility.vendorId,
    pickupLocationId: location.id,
    pickupLocationName: location.name,
    pickupArea: location.pickupArea?.trim() || undefined,
    pickupAddress: location.pickupAddress!.trim(),
    instructions: location.instructions?.trim() || undefined,
  });
}
