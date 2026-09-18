import {
  COD_COLLECTED_BY,
  ORDER_STATUS,
  type CodCollectedBy,
} from "@/config/app.config";
import { resolveCodCollector } from "@/lib/payments/cod-collection";
import {
  resolveShippingRevenueTo,
  SHIPPING_REVENUE_TO,
  type ShippingRevenueTo,
} from "@/lib/shipping/shipping-revenue";
import { resolveDefaultVendorId } from "@/lib/vendors/multi-vendor";
import { Vendor } from "@/models";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";

type OrderVendorContext = {
  isMultiVendorEnabled: boolean;
  defaultVendorId: string | null;
  fallbackVendorId: string | null;
};

type OrderSubOrderItem = {
  productId: unknown;
  variantId?: unknown;
  vendorId: string;
  name?: string;
  sku?: string;
  quantity: number;
  price: number;
  /** Unit cost at the sale; absent when the seller tracks none. */
  cost?: number;
  image?: string;
  purchaseType?: string;
  preorderReleaseDate?: unknown;
  preorderMessage?: string;
  preorderStatus?: string;
  preorderPaymentMode?: string;
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
  preorderSupplierEta?: unknown;
  preorderBatchName?: string;
  customs?: {
    countryOfOrigin?: string;
    hsCode?: string;
    description?: string;
    weight?: number;
    weightUnit?: "g" | "kg" | "lb" | "oz";
  };
  lineDiscount?: {
    type: "percent" | "amount";
    value: number;
    amount?: number;
  };
  lineNote?: string;
};

type OrderSubOrderInput = {
  /** This consignment's slice of a scoped coupon — see `couponDiscountByVendor`. */
  couponDiscount?: number;
  /** What a free-shipping coupon took off this consignment's delivery. */
  shippingDiscount?: number;
  vendorId: string;
  items: OrderSubOrderItem[];
  subtotal: number;
  commission: number;
  vendorEarnings: number;
  status: string;
  /** Who takes the cash if this sale is COD; frozen here at creation. */
  codCollectedBy: CodCollectedBy;
  shippingRevenueTo: ShippingRevenueTo;
};

type VendorIdRecord = {
  _id?: unknown;
  toString?: unknown;
};

function stringifyVendorIdRecord(record: VendorIdRecord): string | null {
  if (typeof record.toString !== "function") return null;

  const text = record.toString();
  return text && text !== "[object Object]" ? text : null;
}

function normalizeVendorIdValue(
  value: unknown,
  seen: WeakSet<object>,
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);

  if (typeof value === "object") {
    const record = value as VendorIdRecord;
    if (seen.has(value)) {
      return stringifyVendorIdRecord(record);
    }

    seen.add(value);

    if (record._id) {
      const vendorId = normalizeVendorIdValue(record._id, seen);
      if (vendorId) return vendorId;
    }

    return stringifyVendorIdRecord(record);
  }

  return null;
}

function normalizeVendorId(value: unknown): string | null {
  return normalizeVendorIdValue(value, new WeakSet());
}

export async function resolveOrderVendorContext(params: {
  isMultiVendorEnabled: boolean;
  defaultVendorOwnerUserId?: string;
}): Promise<OrderVendorContext> {
  if (params.isMultiVendorEnabled) {
    return {
      isMultiVendorEnabled: true,
      defaultVendorId: null,
      fallbackVendorId: null,
    };
  }

  const defaultVendorId = await resolveDefaultVendorId(
    params.defaultVendorOwnerUserId,
  );

  return {
    isMultiVendorEnabled: false,
    defaultVendorId,
    fallbackVendorId: defaultVendorId,
  };
}

export async function resolveOrderVendorContextForItems<T>(params: {
  isMultiVendorEnabled: boolean;
  items: T[];
  getVendorId: (item: T) => unknown;
  defaultVendorOwnerUserId?: string;
}): Promise<OrderVendorContext> {
  const needsDefaultVendor =
    !params.isMultiVendorEnabled ||
    params.items.some((item) => !normalizeVendorId(params.getVendorId(item)));

  if (!needsDefaultVendor) {
    return {
      isMultiVendorEnabled: true,
      defaultVendorId: null,
      fallbackVendorId: null,
    };
  }

  const defaultVendorId = await resolveDefaultVendorId(
    params.defaultVendorOwnerUserId,
  );

  return {
    isMultiVendorEnabled: params.isMultiVendorEnabled,
    defaultVendorId: params.isMultiVendorEnabled ? null : defaultVendorId,
    fallbackVendorId: defaultVendorId,
  };
}

export function getOrderItemVendorId(
  itemVendorId: unknown,
  context: OrderVendorContext,
): string {
  const vendorId = context.isMultiVendorEnabled
    ? normalizeVendorId(itemVendorId) || context.fallbackVendorId
    : context.defaultVendorId;
  if (!vendorId) {
    throw new Error("Order item is missing a vendor");
  }
  return vendorId;
}

/**
 * Compute the monetary amount of a per-line discount for a given item.
 * Returns 0 if the item has no line discount.
 */
export function computeLineDiscountAmount(
  price: number,
  quantity: number,
  lineDiscount:
    | { type: "percent" | "amount"; value: number; amount?: number }
    | undefined
    | null,
): number {
  if (!lineDiscount) return 0;
  const lineSubtotal = price * quantity;
  const value = Math.max(0, Number(lineDiscount.value) || 0);
  if (lineDiscount.type === "percent") {
    return Math.round((lineSubtotal * Math.min(value, 100)) / 100 * 100) / 100;
  }
  return Math.min(value, lineSubtotal);
}

export function groupItemsByOrderVendor<T>(
  items: T[],
  context: OrderVendorContext,
  getVendorId: (item: T) => unknown,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const vendorId = getOrderItemVendorId(getVendorId(item), context);
    if (!groups.has(vendorId)) groups.set(vendorId, []);
    groups.get(vendorId)!.push(item);
  }

  return groups;
}

export async function buildVendorSubOrders<T>(
  vendorGroups: Map<string, T[]>,
  options: {
    getProductId: (item: T) => unknown;
    getVariantId?: (item: T) => unknown;
    getName: (item: T) => string | undefined;
    getSku?: (item: T) => string | undefined;
    getQuantity: (item: T) => number;
    getPrice: (item: T) => number;
    /**
     * Unit cost, snapshotted onto the sub-order line as well as the order line.
     * A marketplace reports margin PER VENDOR, and the per-vendor figure is
     * assembled from `subOrders.items` — leaving it only on the order line would
     * make every vendor's own gross profit unanswerable.
     */
    getCost?: (item: T) => number | undefined;
    getImage?: (item: T) => string | undefined;
    getPurchaseType?: (item: T) => string | undefined;
    getPreorderReleaseDate?: (item: T) => unknown;
    getPreorderMessage?: (item: T) => string | undefined;
    getPreorderStatus?: (item: T) => string | undefined;
    getPreorderPaymentMode?: (item: T) => string | undefined;
    getPreorderDepositAmount?: (item: T) => number | undefined;
    getPreorderOutstandingAmount?: (item: T) => number | undefined;
    getPreorderSupplierEta?: (item: T) => unknown;
    getPreorderBatchName?: (item: T) => string | undefined;
    getCustoms?: (item: T) => OrderSubOrderItem["customs"];
    getLineDiscount?: (
      item: T,
    ) =>
      | { type: "percent" | "amount"; value: number; amount?: number }
      | undefined
      | null;
    getLineNote?: (item: T) => string | undefined;
    fallbackCommissionPercent?: number;
    status?: string;
    /**
     * Store-wide COD collection default (`settings.shipping.codCollectedBy`).
     * Omitted by a caller that has no settings in hand, which resolves to
     * `vendor` — the behaviour every order had before this existed.
     */
    codCollectedByDefault?: string;
    /**
     * A scoped coupon's goods discount, by vendor, from
     * `validateAndCalculateCoupon`'s `vendorShares`. Given, every consignment
     * records its own slice (zero when the coupon did not reach it); omitted,
     * none does, and the order's single discount is shared by sales as before.
     */
    couponDiscountByVendor?: Record<string, number>;
  },
): Promise<OrderSubOrderInput[]> {
  const fallbackCommissionPercent = Number.isFinite(
    options.fallbackCommissionPercent,
  )
    ? Number(options.fallbackCommissionPercent)
    : DEFAULT_VENDOR_COMMISSION_RATE;
  const subOrders: OrderSubOrderInput[] = [];

  // Batch-load every vendor's commission rate up front instead of querying per
  // vendor group inside the loop (previously an N+1 on the checkout path).
  const vendorIds = [...vendorGroups.keys()];
  const vendorDocs = vendorIds.length
    ? await Vendor.find({ _id: { $in: vendorIds } })
        .select("commission isDefault shipping.codCollectedBy")
        .lean()
    : [];
  const commissionByVendorId = new Map<string, number>();
  // Who takes the cash if this sale is COD. Resolved here, at the one place
  // every order-creation path funnels through, and frozen onto the consignment
  // — see `lib/cod-collection.ts` for why it must not be looked up later.
  const codCollectorByVendorId = new Map<string, CodCollectedBy>();
  // The store's own consignments: every delivery charge on them is already
  // the store's, whoever carries the parcel.
  const storeVendorIds = new Set<string>();
  for (const vendor of vendorDocs) {
    if ((vendor as { isDefault?: boolean }).isDefault) {
      storeVendorIds.add(String(vendor._id));
    }
    if (typeof vendor.commission === "number") {
      commissionByVendorId.set(String(vendor._id), vendor.commission);
    }
    codCollectorByVendorId.set(
      String(vendor._id),
      resolveCodCollector({
        storeDefault: options.codCollectedByDefault,
        vendorPreference: (
          vendor as { shipping?: { codCollectedBy?: string } }
        ).shipping?.codCollectedBy,
      }),
    );
  }

  for (const [vendorId, vendorItems] of vendorGroups) {
    // Subtotal for the sub-order is computed AFTER any per-line discount so
    // vendor earnings reflect the actual revenue collected.
    const subtotal = vendorItems.reduce((sum, item) => {
      const price = options.getPrice(item);
      const quantity = options.getQuantity(item);
      const lineDiscount = options.getLineDiscount?.(item) ?? null;
      const lineDiscountAmount = computeLineDiscountAmount(
        price,
        quantity,
        lineDiscount,
      );
      return sum + (price * quantity - lineDiscountAmount);
    }, 0);
    const commissionPercent = commissionByVendorId.has(vendorId)
      ? commissionByVendorId.get(vendorId)!
      : fallbackCommissionPercent;
    const commission =
      Math.round(subtotal * (commissionPercent / 100) * 100) / 100;
    const vendorEarnings = Math.round((subtotal - commission) * 100) / 100;

    const codCollectedBy =
      codCollectorByVendorId.get(vendorId) ?? COD_COLLECTED_BY.VENDOR;
    subOrders.push({
      vendorId,
      codCollectedBy,
      // Who delivers is who earns the delivery charge — frozen with the rest,
      // for the same reason: a later settings change must not move money on
      // orders already placed.
      shippingRevenueTo: storeVendorIds.has(vendorId)
        ? SHIPPING_REVENUE_TO.PLATFORM
        : resolveShippingRevenueTo(codCollectedBy),
      items: vendorItems.map((item) => {
        const lineDiscount = options.getLineDiscount?.(item) ?? null;
        const lineDiscountAmount = lineDiscount
          ? computeLineDiscountAmount(
              options.getPrice(item),
              options.getQuantity(item),
              lineDiscount,
            )
          : 0;
        return {
          productId: options.getProductId(item),
          variantId: options.getVariantId?.(item),
          vendorId,
          name: options.getName(item),
          sku: options.getSku?.(item) || "",
          quantity: options.getQuantity(item),
          price: options.getPrice(item),
          cost: options.getCost?.(item),
          image: options.getImage?.(item),
          purchaseType: options.getPurchaseType?.(item),
          preorderReleaseDate: options.getPreorderReleaseDate?.(item),
          preorderMessage: options.getPreorderMessage?.(item),
          preorderStatus: options.getPreorderStatus?.(item),
          preorderPaymentMode: options.getPreorderPaymentMode?.(item),
          preorderDepositAmount: options.getPreorderDepositAmount?.(item),
          preorderOutstandingAmount:
            options.getPreorderOutstandingAmount?.(item),
          preorderSupplierEta: options.getPreorderSupplierEta?.(item),
          preorderBatchName: options.getPreorderBatchName?.(item),
          customs: options.getCustoms?.(item),
          lineDiscount: lineDiscount
            ? {
                type: lineDiscount.type,
                value: lineDiscount.value,
                amount: lineDiscountAmount,
              }
            : undefined,
          lineNote: options.getLineNote?.(item),
        };
      }),
      subtotal,
      commission,
      vendorEarnings,
      ...(options.couponDiscountByVendor
        ? {
            couponDiscount: Math.min(
              subtotal,
              Math.max(0, Number(options.couponDiscountByVendor[vendorId] || 0)),
            ),
          }
        : {}),
      status: options.status || ORDER_STATUS.PENDING,
    });
  }

  return subOrders;
}
