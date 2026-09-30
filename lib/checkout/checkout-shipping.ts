import { Vendor } from "@/models";
import {
  calculateShipping,
  calculateShippingByVendor,
  estimateCustomsDuty,
  CANONICAL_CART_WEIGHT_UNIT,
  type ShippingSettings,
  type ShippingRateOption,
  type ShippingCalculationResult,
  type CustomsEstimate,
} from "@/lib/shipping/shipping";
import { quantizeToCurrency } from "@/lib/intl/money";

/**
 * Shared shipping resolution used by every checkout path (online checkout,
 * Stripe PaymentIntent, Stripe Checkout Session finalize, and the
 * shipping-rates endpoint). Centralising it here is what keeps those paths in
 * parity — there is exactly one place that decides cost, selected method,
 * per-vendor allocation, and duties.
 */

export type ResolvedShippingMethod = {
  name?: string;
  optionId?: string;
  minDays?: number;
  maxDays?: number;
};

type VendorRateGroup = {
  vendorId: string;
  vendorName?: string;
  options: ShippingRateOption[];
  selectedOptionId?: string;
  cost: number;
  method: ResolvedShippingMethod;
};

export type ResolvedCheckoutShipping = {
  available: boolean;
  mode: "single" | "vendor";
  shippingCost: number;
  selectedShippingMethod?: ResolvedShippingMethod;
  // vendorId -> selected cost + method, used to allocate shipping per sub-order
  vendorShippingCosts: Map<string, { cost: number; method: ResolvedShippingMethod }>;
  // selectable options for the single-shipment case (UI)
  singleOptions: ShippingRateOption[];
  // selectable options grouped per vendor (UI)
  vendorGroups: VendorRateGroup[];
  customs: CustomsEstimate;
};

type VendorAggregate = Map<
  string,
  {
    subtotal: number;
    shippableSubtotal?: number;
    weight: number;
    shippableItemCount?: number;
  }
>;

function methodFromResult(
  result: ShippingCalculationResult,
): ResolvedShippingMethod {
  return {
    name: result.options.find((o) => o.id === result.selectedOptionId)?.name,
    optionId: result.selectedOptionId,
    minDays: result.deliveryDays?.min,
    maxDays: result.deliveryDays?.max,
  };
}

/**
 * Every money figure in the resolution rounded to what the currency can hold.
 *
 * Weight rates (`price + perUnit × weight`) and percentage duty came out with
 * extra decimals — 3.33325 of shipping, 925.875 yen of duty — which were
 * stored as is. The order's rows then no longer added up to its total, and a
 * mobile-money gateway refused a whole-yen checkout the shopper could not fix.
 */
function quantizeResolution(
  resolution: ResolvedCheckoutShipping,
  currency: string,
): ResolvedCheckoutShipping {
  const q = (amount: number) => quantizeToCurrency(Number(amount || 0), currency);
  const quantizeOption = (option: ShippingRateOption): ShippingRateOption => ({
    ...option,
    cost: q(option.cost),
  });

  const vendorShippingCosts = new Map(
    Array.from(resolution.vendorShippingCosts.entries()).map(
      ([vendorId, entry]) => [vendorId, { ...entry, cost: q(entry.cost) }],
    ),
  );
  const rawVendorSum = Array.from(resolution.vendorShippingCosts.values()).reduce(
    (sum, entry) => sum + Number(entry.cost || 0),
    0,
  );
  // The order's charge is the sum of the parcels' charges whenever it was
  // built from them, so the two can never drift a unit apart after rounding.
  const shippingCost =
    vendorShippingCosts.size > 0 &&
    Math.abs(rawVendorSum - Number(resolution.shippingCost || 0)) < 1e-9
      ? q(
          Array.from(vendorShippingCosts.values()).reduce(
            (sum, entry) => sum + entry.cost,
            0,
          ),
        )
      : q(resolution.shippingCost);

  return {
    ...resolution,
    shippingCost,
    vendorShippingCosts,
    singleOptions: resolution.singleOptions.map(quantizeOption),
    vendorGroups: resolution.vendorGroups.map((group) => ({
      ...group,
      cost: q(group.cost),
      options: group.options.map(quantizeOption),
    })),
    customs: {
      ...resolution.customs,
      dutyAmount: q(resolution.customs.dutyAmount),
    },
  };
}

export async function resolveCheckoutShipping(
  params: Parameters<typeof resolveCheckoutShippingUnrounded>[0] & {
    /** The currency the order is charged in; 2 decimals when absent. */
    currency?: string;
  },
): Promise<ResolvedCheckoutShipping> {
  const { currency, ...rest } = params;
  return quantizeResolution(
    await resolveCheckoutShippingUnrounded(rest),
    currency || "USD",
  );
}

async function resolveCheckoutShippingUnrounded(params: {
  subtotal: number;
  totalWeight: number;
  vendorAgg: VendorAggregate;
  destination: { country?: string; state?: string };
  platformShipping?: ShippingSettings;
  orders?: { freeShippingThreshold?: number; defaultShippingCost?: number };
  isMultiVendorEnabled: boolean;
  selectedShippingOptionId?: string;
  vendorShippingSelections?: Record<string, string>;
}): Promise<ResolvedCheckoutShipping> {
  const {
    totalWeight,
    vendorAgg,
    destination,
    platformShipping,
    orders,
  } = params;

  const shippableSubtotal = Array.from(vendorAgg.values()).reduce(
    (sum, aggregate) =>
      sum +
      (aggregate.shippableItemCount === 0
        ? 0
        : (aggregate.shippableSubtotal ?? aggregate.subtotal)),
    0,
  );
  const customs = estimateCustomsDuty({
    subtotal: shippableSubtotal,
    destination,
    originCountry: platformShipping?.origin?.country,
    customs: platformShipping?.customs,
  });

  // Per-vendor shipping applies whenever the admin enabled it on a multi-vendor
  // store — including a cart holding a single vendor's items.
  const shippableVendorIds = Array.from(vendorAgg.entries())
    .filter(([, aggregate]) => aggregate.shippableItemCount !== 0)
    .map(([vendorId]) => vendorId);
  const hasShippableItems = shippableVendorIds.length > 0;

  if (!hasShippableItems) {
    return {
      available: true,
      mode: "single",
      shippingCost: 0,
      vendorShippingCosts: new Map(),
      singleOptions: [],
      vendorGroups: [],
      customs: { ...customs, dutyAmount: 0, collectedAtCheckout: false },
    };
  }

  // Not gated on "more than one vendor": that made the same vendor's items cost
  // one price alone and another price alongside a second vendor's, and let a
  // vendor's own profile be ignored entirely on single-vendor carts.
  const vendorShippingEnabled =
    params.isMultiVendorEnabled &&
    Boolean(platformShipping?.vendorShipping?.enabled);

  if (vendorShippingEnabled) {
    const vendorIds = shippableVendorIds;
    const vendorDocs = await Vendor.find({ _id: { $in: vendorIds } })
      .select("shipping storeName")
      .lean<
        Array<{
          _id: { toString: () => string };
          storeName?: string;
          shipping?: ShippingSettings;
        }>
      >();
    const vendorProfiles = new Map<string, ShippingSettings | undefined>(
      vendorDocs.map((v) => [v._id.toString(), v.shipping]),
    );
    const vendorNames = new Map<string, string | undefined>(
      vendorDocs.map((v) => [v._id.toString(), v.storeName]),
    );

    const multi = calculateShippingByVendor({
      groups: vendorIds.map((vendorId) => {
        const agg = vendorAgg.get(vendorId)!;
        return {
          vendorId,
          subtotal: agg.shippableSubtotal ?? agg.subtotal,
          totalWeight: agg.weight,
          totalWeightUnit: CANONICAL_CART_WEIGHT_UNIT,
          shipping: vendorProfiles.get(vendorId),
          selectedOptionId: params.vendorShippingSelections?.[vendorId],
        };
      }),
      destination,
      platformShipping,
      orders,
    });

    const vendorShippingCosts = new Map<
      string,
      { cost: number; method: ResolvedShippingMethod }
    >();
    const vendorGroups: VendorRateGroup[] = multi.perVendor.map((v) => {
      const method = methodFromResult(v.result);
      vendorShippingCosts.set(v.vendorId, { cost: v.result.shippingCost, method });
      return {
        vendorId: v.vendorId,
        vendorName: vendorNames.get(v.vendorId),
        options: v.result.options,
        selectedOptionId: v.result.selectedOptionId,
        cost: v.result.shippingCost,
        method,
      };
    });

    return {
      available: multi.available,
      mode: "vendor",
      shippingCost: multi.totalShippingCost,
      // With one vendor there is one shipment, so the order-level method is
      // unambiguous and worth recording; across several vendors it isn't, and
      // the per-vendor methods on the sub-orders carry that detail instead.
      selectedShippingMethod:
        vendorGroups.length === 1 ? vendorGroups[0]!.method : undefined,
      vendorShippingCosts,
      singleOptions: [],
      vendorGroups,
      customs,
    };
  }

  const result = calculateShipping({
    subtotal: shippableSubtotal,
    totalWeight,
    totalWeightUnit: CANONICAL_CART_WEIGHT_UNIT,
    destination,
    shipping: platformShipping,
    orders,
    selectedOptionId: params.selectedShippingOptionId,
  });

  return {
    available: result.available,
    mode: "single",
    shippingCost: result.shippingCost,
    selectedShippingMethod: methodFromResult(result),
    vendorShippingCosts: new Map(),
    singleOptions: result.options,
    vendorGroups: [],
    customs,
  };
}

// ============================================================
// Stripe metadata (de)serialization — keeps the PaymentIntent /
// Checkout Session metadata compact and the finalize step in parity.
// ============================================================

type ShippingMetadata = {
  shipping: string; // total shipping cost
  shippingMethod: string; // JSON ResolvedShippingMethod | ""
  customsDuty: string; // duty amount
  customs: string; // JSON customs estimate | ""
  vendorShipping: string; // JSON { [vendorId]: { c, n, oid, mn, mx } } | ""
};

export function buildShippingMetadata(
  resolution: ResolvedCheckoutShipping,
): ShippingMetadata {
  const vendorShipping: Record<
    string,
    { c: number; n?: string; oid?: string; mn?: number; mx?: number }
  > = {};
  for (const [vendorId, entry] of resolution.vendorShippingCosts.entries()) {
    vendorShipping[vendorId] = {
      c: entry.cost,
      n: entry.method.name,
      oid: entry.method.optionId,
      mn: entry.method.minDays,
      mx: entry.method.maxDays,
    };
  }

  return {
    shipping: String(resolution.shippingCost),
    shippingMethod: resolution.selectedShippingMethod
      ? JSON.stringify(resolution.selectedShippingMethod)
      : "",
    customsDuty: String(resolution.customs.dutyAmount || 0),
    customs: JSON.stringify(resolution.customs),
    vendorShipping:
      Object.keys(vendorShipping).length > 0
        ? JSON.stringify(vendorShipping)
        : "",
  };
}

type ParsedShippingMetadata = {
  shippingMethod?: ResolvedShippingMethod;
  customs?: {
    dutyAmount: number;
    dutyMode?: "DDP" | "DDU";
    international?: boolean;
    collectedAtCheckout?: boolean;
  };
  // vendorId -> { cost, method }
  vendorShippingCosts: Map<string, { cost: number; method: ResolvedShippingMethod }>;
};

function safeParse<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function parseShippingMetadata(
  metadata: Record<string, string | undefined>,
): ParsedShippingMetadata {
  const shippingMethod = safeParse<ResolvedShippingMethod>(
    metadata.shippingMethod,
  );
  const customs = safeParse<ParsedShippingMetadata["customs"]>(metadata.customs);

  const rawVendor = safeParse<
    Record<string, { c: number; n?: string; oid?: string; mn?: number; mx?: number }>
  >(metadata.vendorShipping);

  const vendorShippingCosts = new Map<
    string,
    { cost: number; method: ResolvedShippingMethod }
  >();
  if (rawVendor) {
    for (const [vendorId, v] of Object.entries(rawVendor)) {
      vendorShippingCosts.set(vendorId, {
        cost: Number(v.c) || 0,
        method: { name: v.n, optionId: v.oid, minDays: v.mn, maxDays: v.mx },
      });
    }
  }

  return { shippingMethod, customs, vendorShippingCosts };
}

/**
 * Allocate shipping to sub-orders from a parsed per-vendor map (multi-vendor),
 * or spread the single order-level cost across them (single shipment). Mutates
 * the sub-order objects in place. Shared by every order-creation path so
 * allocation never diverges.
 */
export function allocateSubOrderShipping(
  subOrders: Array<{
    vendorId: { toString: () => string };
    subtotal?: number;
    shippingCost?: number;
    shippingDiscount?: number;
    shippingMethod?: unknown;
  }>,
  params: {
    vendorShippingCosts: Map<string, { cost: number; method: ResolvedShippingMethod }>;
    orderShippingCost: number;
    orderShippingMethod?: ResolvedShippingMethod;
    /**
     * A free-shipping coupon's discount by vendor, from the coupon's own
     * `shippingShares`. Stamped per consignment so nothing downstream has to
     * guess whose delivery was free: the ledger and the payout both used to
     * spread it over every parcel, so one seller's coupon cost the others
     * their delivery charge.
     */
    shippingDiscountByVendor?: Record<string, number>;
    /** Rounds each share to this currency; cents when absent. */
    currency?: string;
  },
) {
  const round = (amount: number) =>
    params.currency
      ? quantizeToCurrency(amount, params.currency)
      : Math.round(amount * 100) / 100;
  const stampDiscount = (sub: { vendorId: { toString: () => string }; shippingCost?: number; shippingDiscount?: number }) => {
    const shares = params.shippingDiscountByVendor;
    if (!shares) return;
    const share = Math.max(0, Number(shares[sub.vendorId.toString()] || 0));
    sub.shippingDiscount =
      Math.round(Math.min(share, Math.max(0, Number(sub.shippingCost) || 0)) * 100) / 100;
  };

  if (params.vendorShippingCosts.size > 0) {
    for (const sub of subOrders) {
      const entry = params.vendorShippingCosts.get(sub.vendorId.toString());
      if (entry) {
        sub.shippingCost = entry.cost;
        sub.shippingMethod = entry.method;
      }
      stampDiscount(sub);
    }
    return;
  }

  if (subOrders.length === 0) return;

  // No per-vendor breakdown: the cart was rated as ONE shipment. With a single
  // sub-order that cost is simply its own; with several (multi-vendor mode on
  // but per-vendor rating off) it must still be spread, otherwise every
  // sub-order reads 0 while the order carries a real charge and vendor
  // payout/commission views under-report shipping.
  const total = Math.max(0, params.orderShippingCost);
  const weights = subOrders.map((sub) => Math.max(0, Number(sub.subtotal) || 0));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  let allocated = 0;
  subOrders.forEach((sub, index) => {
    const isLast = index === subOrders.length - 1;
    // The last share absorbs the rounding remainder so the parts always sum
    // back to the order-level cost exactly.
    const share = isLast
      ? round(total - allocated)
      : round(
          weightSum > 0
            ? (total * weights[index]!) / weightSum
            : total / subOrders.length,
        );
    allocated = round(allocated + share);
    sub.shippingCost = share;
    sub.shippingMethod = params.orderShippingMethod;
    stampDiscount(sub);
  });
}
