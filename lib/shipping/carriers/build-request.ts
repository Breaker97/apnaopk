import "server-only";

import { Product, Vendor } from "@/models";
import { getSettings, type ISettings } from "@/models/settings.model";
import { resolveShipFrom } from "@/lib/shipping/shipments";
import {
  packSubOrder,
  type PackResult,
  type PackableItem,
} from "@/lib/shipping/packing";
import type { IOrder, IVendor, OrderItem, SubOrder } from "@/types";
import { isSubOrderPaid } from "@/lib/orders/order-payment-status";
import {
  resolveItemDimensions,
  type ProductDimensions,
  type ProductShippingData,
  type ProductWeightUnit,
  type VariantShippingData,
} from "@/lib/catalog/product-shipping";
import {
  assertShipFromReady,
  assertShipToReady,
  toCarrierAddress,
} from "./address";
import type { CarrierParcel, CarrierShipmentRequest } from "./types";

/**
 * The single place Storify's domain becomes a carrier request.
 *
 * Adapters never see an Order, and routes never see a provider payload; this
 * module is the only thing that knows both. It is also the only async part of
 * packing — `lib/shipping/packing.ts` stays pure precisely because the product
 * lookup happens here.
 */

/**
 * The provider-facing id for one booking of one sub-order.
 *
 * Exported for tests: the first booking must keep the historic
 * `<order>-<subOrder>` shape, or every parcel already in flight would look like
 * a new consignment to Shiprocket's duplicate check on its next retry.
 */
export function carrierReference(
  orderNumber: string,
  subOrderId: unknown,
  bookingSequence?: number,
): string {
  const base = `${orderNumber}-${String(subOrderId ?? "0")}`;
  const sequence = Number(bookingSequence) || 0;
  return sequence > 0 ? `${base}-r${sequence}` : base;
}

/**
 * What this parcel's contents are worth, for customs and for cash on delivery.
 *
 * The sub-order's own subtotal, falling back to the order total only when there
 * is no sub-order figure at all. Exported and separate because `||` collapsed
 * those two cases and the result is money: a sub-order legitimately worth zero
 * — every line fully discounted, which `buildSubOrders` computes net of line
 * discounts — read as "unset" and inherited the *whole order's* value. On a
 * split COD order that had Shiprocket collect the entire order total from the
 * customer for one vendor's parcel, with every other vendor's parcel still
 * collecting its own share on top.
 */
export function declaredValueForSubOrder(
  subOrderSubtotal: unknown,
  orderTotal: unknown,
): number {
  // Type-checked rather than coerced. `Number(null)` and `Number("")` are both
  // 0, so a `Number(...)` guard would turn an absent subtotal into a real zero
  // — the same conflation of "missing" and "worth nothing" this exists to
  // avoid, arrived at from the other side.
  if (typeof subOrderSubtotal === "number") {
    if (Number.isFinite(subOrderSubtotal)) return subOrderSubtotal;
  } else if (
    typeof subOrderSubtotal === "string" &&
    subOrderSubtotal.trim() !== ""
  ) {
    const parsed = Number(subOrderSubtotal);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number(orderTotal) || 0;
}

/**
 * Dimensions are read live rather than from the order snapshot.
 *
 * Weight is snapshotted onto `OrderItem.customs` because it affects money.
 * Dimensions only choose a box, so a stale value is harmless, and adding a
 * field to the hot order-creation path for a fulfillment-time convenience
 * would be a bad trade.
 */
async function loadDimensions(
  items: OrderItem[],
): Promise<Map<string, ProductDimensions>> {
  const productIds = Array.from(
    new Set(
      items
        .map((item) => (item.productId ? String(item.productId) : ""))
        .filter(Boolean),
    ),
  );
  if (productIds.length === 0) return new Map();

  const products = await Product.find({ _id: { $in: productIds } })
    .select(
      "shipping variants._id variants.length variants.width variants.height variants.dimensionUnit",
    )
    .lean<
      Array<{
        _id: unknown;
        shipping?: ProductShippingData;
        variants?: Array<VariantShippingData & { _id?: unknown }>;
      }>
    >();

  const byId = new Map<string, ProductDimensions>();
  for (const product of products) {
    const productShipping = product.shipping;
    byId.set(String(product._id), resolveItemDimensions({ productShipping }));
    for (const variant of product.variants || []) {
      if (!variant?._id) continue;
      byId.set(
        `${String(product._id)}:${String(variant._id)}`,
        resolveItemDimensions({ productShipping, variantShipping: variant }),
      );
    }
  }
  return byId;
}

function toPackableItems(
  items: OrderItem[],
  dimensions: Map<string, ProductDimensions>,
): PackableItem[] {
  return (
    items
      // The customs snapshot is absent for digital lines by construction, which
      // is exactly what "not shippable" means here.
      .filter((item) => item.customs?.weight !== undefined)
      .map((item) => {
        const productId = item.productId ? String(item.productId) : "";
        const variantKey = item.variantId
          ? `${productId}:${String(item.variantId)}`
          : productId;
        const box =
          dimensions.get(variantKey) || dimensions.get(productId) || {};
        return {
          quantity: item.quantity,
          unitWeight: Number(item.customs?.weight) || 0,
          weightUnit: (item.customs?.weightUnit || "kg") as ProductWeightUnit,
          length: box.length,
          width: box.width,
          height: box.height,
          dimensionUnit: box.dimensionUnit || "cm",
        };
      })
  );
}

function customsItems(items: OrderItem[], currency: string) {
  return items
    .filter((item) => item.customs?.weight !== undefined)
    .map((item) => ({
      description:
        item.customs?.description?.trim() || item.name || "Merchandise",
      quantity: item.quantity,
      netWeight: Number(item.customs?.weight) || 0,
      weightUnit: (item.customs?.weightUnit || "kg") as ProductWeightUnit,
      valueAmount: Number(item.price) || 0,
      valueCurrency: currency,
      originCountry: item.customs?.countryOfOrigin,
      hsCode: item.customs?.hsCode,
    }));
}

interface BuiltShipmentRequest {
  request: CarrierShipmentRequest;
  packing: PackResult;
  /** True when origin and destination countries differ. */
  international: boolean;
}

/**
 * Build the carrier request for one sub-order.
 *
 * `parcelOverride` lets the Send-to-courier dialog send edited dimensions
 * without re-deriving them — a merchant who knows the box beats the packer's
 * guess, and the guess is only ever a starting point.
 */
export async function buildCarrierShipmentRequest(params: {
  order: Pick<
    IOrder,
    | "_id"
    | "orderNumber"
    | "shippingAddress"
    | "currency"
    | "paymentMethod"
    | "paymentStatus"
    | "total"
  >;
  /**
   * Carriers want a contact address on the consignee. An order stores only a
   * `customerId`, so the caller — which has already loaded the customer to
   * authorize the request — supplies it.
   */
  customerEmail?: string;
  subOrder: Pick<
    SubOrder,
    "_id" | "vendorId" | "items" | "subtotal" | "shippingCost" | "paymentStatus"
  >;
  settings?: ISettings;
  packageId?: string;
  parcelOverride?: CarrierParcel;
  /**
   * Which booking of this parcel this is; 0 for the first. Only a re-ship after
   * a void passes anything else — see `reference` below.
   */
  bookingSequence?: number;
}): Promise<BuiltShipmentRequest> {
  const settings = params.settings ?? (await getSettings());
  const items = params.subOrder.items || [];

  const vendor = params.subOrder.vendorId
    ? await Vendor.findById(params.subOrder.vendorId)
        .select("storeName address shipping")
        .lean<IVendor | null>()
    : null;

  const shipFromResolution = resolveShipFrom({ vendor, settings });
  const shipFrom = assertShipFromReady(
    toCarrierAddress(shipFromResolution.address, {
      fallbackName: settings.general?.storeName,
      email: settings.general?.storeEmail,
    }),
    // Which of the four candidate records won, so a rejection names the screen
    // that actually owns the address rather than guessing at Settings.
    { source: shipFromResolution.source },
  );

  const shipTo = assertShipToReady(
    toCarrierAddress(params.order.shippingAddress, {
      fallbackName: "Customer",
      email: params.customerEmail,
    }),
  );

  const weightUnit = settings.shipping?.weightUnit === "lb" ? "lb" : "kg";
  const allPackages = settings.shipping?.packages || [];
  // A merchant who picked a box in the dialog gets that box, not the packer's.
  const packages = params.packageId
    ? allPackages.filter((preset) => preset.id === params.packageId)
    : allPackages;

  const packing = packSubOrder({
    items: toPackableItems(items, await loadDimensions(items)),
    packages: packages.length > 0 ? packages : allPackages,
    weightUnit,
  });

  const parcels = params.parcelOverride
    ? [params.parcelOverride]
    : packing.parcels;

  const currency = String(
    params.order.currency || settings.general?.defaultCurrency || "USD",
  ).toUpperCase();

  const international = shipFrom.country !== shipTo.country;

  const declaredValue = declaredValueForSubOrder(
    params.subOrder.subtotal,
    params.order.total,
  );
  const shippingAmount = Number(params.subOrder.shippingCost) || 0;

  // COD is Shiprocket's first-class concept and absent from Shippo's; the
  // adapter that does not use it simply ignores it.
  //
  // Asked of THIS consignment. The order-level flag made one vendor collecting
  // their cash disarm the collection on everybody else's parcel: the courier
  // took the sibling's goods out as prepaid and handed them over for nothing.
  const isCod =
    String(params.order.paymentMethod || "").toLowerCase() === "cod" &&
    !isSubOrderPaid(params.order, params.subOrder);

  const request: CarrierShipmentRequest = {
    // Stable per sub-order: Shiprocket receives it as its own order id and
    // rejects a duplicate, which is what makes a retry recoverable.
    //
    // Stable *within* one booking, that is. A voided parcel is deliberately
    // re-shipped under a new reference: the old one now belongs to a cancelled
    // Shiprocket consignment, and reusing it would have the duplicate-recovery
    // path resume that cancelled order instead of creating a live one.
    reference: carrierReference(
      params.order.orderNumber,
      params.subOrder._id,
      params.bookingSequence,
    ),
    orderNumber: params.order.orderNumber,
    shipFrom,
    shipTo,
    parcels,
    customsItems: international ? customsItems(items, currency) : undefined,
    cod: isCod
      ? { amount: declaredValue + shippingAmount, currency }
      : undefined,
    declaredValue: { amount: declaredValue, currency },
    shippingAmount,
    items: items.map((item) => ({
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: Number(item.price) || 0,
    })),
  };

  return { request, packing, international };
}
