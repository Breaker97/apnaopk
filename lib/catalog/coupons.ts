import { Types } from "mongoose";
import { Coupon, Order, Product } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { CouponStatus, CouponType } from "@/models/coupon.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import {
  isFreeShippingCouponType,
} from "@/lib/catalog/discounts";
import { roundMoney } from "@/lib/intl/money";

/**
 * How long a checkout that has not been paid yet keeps its use of a limited
 * coupon. Long enough for a gateway redirect, a 3-D Secure challenge or a
 * mobile-money prompt; short enough that an abandoned checkout — which nothing
 * cancels — hands the use back on its own.
 */
export const COUPON_HOLD_WINDOW_MS = 30 * 60 * 1000;

interface CouponCartItem {
  productId: string;
  price: number;
  quantity: number;
  categoryId?: string;
  vendorId?: string;
}

interface ValidatedCouponResult {
  couponId: string;
  code: string;
  type: CouponType;
  value: number;
  discount: number;
  discountTarget: "subtotal" | "shipping";
  maxDiscount?: number;
  description?: string;
  /**
   * The goods discount split by the vendor whose items earned it, for a coupon
   * limited to some of the cart — one vendor's own coupon, or a product or
   * category list. Absent for a coupon on the whole cart, whose discount every
   * line shares in proportion, which is what the order already assumes.
   *
   * Recorded because the order keeps one `discount`, and everything that
   * divides it among vendors — the ledger, the payout, a return — divided it by
   * each vendor's sales. Vendor A's 20-off coupon then came 10 off A and 10 off
   * vendor B, who never offered it. See `couponDiscount` on the sub-order.
   */
  vendorShares?: Record<string, number>;
  /**
   * A free-shipping coupon's discount split by the vendor whose delivery it
   * paid for. One seller's own free-shipping coupon used to wipe out every
   * seller's delivery charge on a split order — the coupon was priced off the
   * whole order's shipping, and the loss was then spread over everyone who
   * carried a parcel. See `shippingDiscount` on the sub-order.
   */
  shippingShares?: Record<string, number>;
  /** The seller whose delivery a seller's own free-shipping coupon pays for. */
  shippingVendorId?: string;
  /**
   * Who pays for the discount — the store, or the sellers whose items it
   * discounts — for delivery as much as for goods. A vendor's own coupon is
   * always theirs; a store coupon says which (absent: the store). See
   * `fundedBy` on the Coupon model.
   */
  fundedBy: "platform" | "vendor";
}

type ValidateCouponParams = {
  code: string;
  subtotal: number;
  shippingCost?: number;
  /**
   * What each vendor's delivery costs, when the cart was rated per vendor.
   * Without it a coupon scoped to one seller cannot tell their delivery from
   * anyone else's, and falls back to the whole order's shipping.
   */
  shippingByVendor?: Record<string, number>;
  cartItems: CouponCartItem[];
  /** The shopper's account — for a guest, the account their email belongs to. */
  userId?: string;
  /** The email the order is placed under, so a guest has a limit too. */
  email?: string;
};

function normalizeObjectId(value?: string) {
  if (!value) return null;
  if (!Types.ObjectId.isValid(value)) return null;
  return String(new Types.ObjectId(value));
}

async function enrichMissingProductRefs(items: CouponCartItem[]) {
  const missingRefProductIds = items
    .filter((item) => !item.categoryId || !item.vendorId)
    .map((item) => normalizeObjectId(item.productId))
    .filter(Boolean) as string[];

  if (missingRefProductIds.length === 0) return items;

  const products = await Product.find(
    { _id: { $in: missingRefProductIds } },
    { category: 1, vendorId: 1 },
  ).lean();

  const refsByProductId = new Map(
    products.map((product) => [
      String(product._id),
      {
        categoryId: String(product.category || ""),
        vendorId: String(
          (product as { vendorId?: unknown }).vendorId || "",
        ),
      },
    ]),
  );

  return items.map((item) => {
    if (item.categoryId && item.vendorId) return item;
    const refs = refsByProductId.get(item.productId);
    return {
      ...item,
      categoryId: item.categoryId || refs?.categoryId || undefined,
      vendorId: item.vendorId || refs?.vendorId || undefined,
    };
  });
}

function isLegacyFreeShippingCoupon(coupon: {
  code?: string;
  label?: string;
  description?: string;
  type?: string;
  value?: number;
}) {
  if (isFreeShippingCouponType(coupon.type)) return true;
  if (coupon.type !== CouponType.PERCENTAGE || Number(coupon.value || 0) < 100) {
    return false;
  }

  const code = String(coupon.code || "").trim().toUpperCase();
  const text = `${coupon.label || ""} ${coupon.description || ""}`.toLowerCase();
  return (
    code === "FREESHIP" ||
    code === "FREE_SHIPPING" ||
    code === "FREE-SHIPPING" ||
    text.includes("free shipping")
  );
}

function resolveCouponType(coupon: {
  code?: string;
  label?: string;
  description?: string;
  type?: string;
  value?: number;
}) {
  return isLegacyFreeShippingCoupon(coupon)
    ? CouponType.FREE_SHIPPING
    : coupon.type;
}

export async function validateAndCalculateCoupon(
  params: ValidateCouponParams,
): Promise<ValidatedCouponResult> {
  const code = params.code.trim().toUpperCase();
  if (!code) {
    throw new ValidationError({ code: ["Coupon code is required"] });
  }

  const coupon = await Coupon.findOne({ code });
  if (!coupon) {
    throw new ValidationError({ code: ["Invalid coupon code"] });
  }

  if (coupon.status !== CouponStatus.ACTIVE) {
    throw new ValidationError({ code: ["This coupon is no longer active"] });
  }

  const now = new Date();
  if (coupon.startDate > now) {
    throw new ValidationError({ code: ["This coupon is not yet valid"] });
  }
  if (coupon.endDate < now) {
    throw new ValidationError({ code: ["This coupon has expired"] });
  }

  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    throw new ValidationError({
      code: ["This coupon has reached its usage limit"],
    });
  }

  const guestEmail = params.email?.trim().toLowerCase();
  const shopper = [
    ...(params.userId ? [{ customerId: params.userId }] : []),
    ...(guestEmail ? [{ guestEmail }] : []),
  ];
  if (coupon.perUserLimit && shopper.length > 0) {
    // Orders that took a use of the coupon and still stand. A use is taken
    // when the order commits — at creation for cash on delivery and pay-later,
    // at capture for a gateway — so an unpaid gateway attempt never locks the
    // shopper out of retrying. Counting only PAID orders let a COD shopper,
    // whose order stays pending until the courier collects, use a
    // once-per-customer coupon on every order; and a guest, with no account
    // id, was never counted at all.
    const userUsageCount = await Order.countDocuments({
      $or: shopper,
      "coupon.code": coupon.code,
      "coupon.usageIncremented": true,
      status: { $ne: ORDER_STATUS.CANCELLED },
      paymentStatus: { $ne: PAYMENT_STATUS.REFUNDED },
    });
    if (userUsageCount >= coupon.perUserLimit) {
      throw new ValidationError({
        code: ["You have already used this coupon"],
      });
    }
  }

  if (coupon.minOrderAmount && params.subtotal < coupon.minOrderAmount) {
    throw new ValidationError({
      code: [`Minimum order amount is $${coupon.minOrderAmount}`],
    });
  }

  const cartItems = await enrichMissingProductRefs(params.cartItems);

  let applicableAmount = params.subtotal;
  // What each vendor's eligible lines are worth, filled only for a scoped coupon.
  const applicableByVendor = new Map<string, number>();
  const couponVendorId = normalizeObjectId(
    String((coupon as { vendorId?: unknown }).vendorId || ""),
  );
  const hasProductOrCategoryScope = Boolean(
    coupon.applicableProducts?.length || coupon.applicableCategories?.length,
  );
  if (
    couponVendorId ||
    hasProductOrCategoryScope ||
    coupon.excludedProducts?.length
  ) {
    applicableAmount = cartItems.reduce((sum, item) => {
      const itemProductId = normalizeObjectId(item.productId);
      const itemCategoryId = normalizeObjectId(item.categoryId);
      const itemVendorId = normalizeObjectId(item.vendorId);
      if (couponVendorId && itemVendorId !== couponVendorId) {
        return sum;
      }

      const isProductApplicable = coupon.applicableProducts?.some(
        (id) => String(id) === itemProductId,
      );
      const isCategoryApplicable = coupon.applicableCategories?.some(
        (id) => String(id) === itemCategoryId,
      );
      if (hasProductOrCategoryScope && !isProductApplicable && !isCategoryApplicable) {
        return sum;
      }

      const isExcluded = coupon.excludedProducts?.some(
        (id) => String(id) === itemProductId,
      );
      if (isExcluded) {
        return sum;
      }

      const lineAmount = item.price * item.quantity;
      const vendorKey = itemVendorId || "";
      applicableByVendor.set(
        vendorKey,
        (applicableByVendor.get(vendorKey) || 0) + lineAmount,
      );
      return sum + lineAmount;
    }, 0);
  }

  if (applicableAmount <= 0) {
    throw new ValidationError({
      code: ["This coupon is not applicable to items in your cart"],
    });
  }

  const couponType = resolveCouponType(coupon) as CouponType;
  const discountTarget = couponType === CouponType.FREE_SHIPPING
    ? "shipping"
    : "subtotal";

  let discount = 0;
  // Which consignments' delivery this coupon actually pays for.
  let shippingShares: Record<string, number> | undefined;
  if (couponType === CouponType.FREE_SHIPPING) {
    const shippingCost = Math.max(0, Number(params.shippingCost ?? 0));
    if (shippingCost <= 0) {
      throw new ValidationError("Shipping is already free for this order");
    }
    const byVendor = params.shippingByVendor;
    if (couponVendorId && byVendor) {
      // A seller's own coupon covers their own delivery and no one else's.
      const own = Math.max(0, Number(byVendor[couponVendorId] || 0));
      if (own <= 0) {
        throw new ValidationError(
          "This coupon covers this seller's delivery, and there is none to discount",
        );
      }
      discount = Math.min(own, shippingCost);
      shippingShares = { [couponVendorId]: discount };
    } else {
      discount = shippingCost;
      if (byVendor) {
        shippingShares = Object.fromEntries(
          Object.entries(byVendor).map(([vendorId, cost]) => [
            vendorId,
            Math.max(0, Number(cost) || 0),
          ]),
        );
      }
    }
  } else if (couponType === CouponType.PERCENTAGE) {
    discount = (applicableAmount * coupon.value) / 100;
  } else {
    discount = coupon.value;
  }

  if (coupon.maxDiscount && discount > coupon.maxDiscount) {
    discount = coupon.maxDiscount;
  }
  if (discountTarget === "subtotal" && discount > applicableAmount) {
    discount = applicableAmount;
  }

  const roundedDiscount = roundMoney(discount);
  return {
    couponId: String(coupon._id),
    code: coupon.code,
    type: couponType,
    value: coupon.value,
    discount: roundedDiscount,
    fundedBy: resolveCouponFundedBy(coupon),
    // Rescaled if a cap brought the discount below what the delivery cost, so
    // the parts always add back up to what comes off the order.
    ...(shippingShares
      ? { shippingShares: splitCouponDiscount(roundedDiscount, shippingShares) }
      : {}),
    ...(couponType === CouponType.FREE_SHIPPING && couponVendorId
      ? { shippingVendorId: couponVendorId }
      : {}),
    ...(discountTarget === "subtotal" && applicableByVendor.size > 0
      ? {
          vendorShares: splitCouponDiscount(
            roundedDiscount,
            Object.fromEntries(applicableByVendor),
          ),
        }
      : {}),
    discountTarget,
    maxDiscount:
      typeof coupon.maxDiscount === "number" ? coupon.maxDiscount : undefined,
    description: coupon.description,
  };
}

/**
 * Who pays for a coupon's goods discount. A vendor's own coupon is always the
 * vendor's; a store coupon is the store's unless it says the sellers pay.
 */
export function resolveCouponFundedBy(coupon: {
  vendorId?: unknown;
  fundedBy?: string | null;
}): "platform" | "vendor" {
  if (coupon.vendorId) return "vendor";
  return coupon.fundedBy === "vendor" ? "vendor" : "platform";
}

/** The one hold a shopper keeps on a coupon, whichever checkout they retry. */
export function couponHoldKey(customerId: string): string {
  return `c_${String(customerId).replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * Whether the coupon has a use to spare once `holdKey`'s own hold is set
 * aside: its limit, less what has been used, less every OTHER checkout's live
 * hold. A coupon with no limit always has room.
 */
function couponHasRoom(holdKey: string | undefined, now: Date) {
  const otherLiveHolds = {
    $size: {
      $filter: {
        input: { $objectToArray: { $ifNull: ["$holds", { $literal: {} }] } },
        as: "hold",
        cond: {
          $and: [
            { $gt: ["$$hold.v", now] },
            ...(holdKey ? [{ $ne: ["$$hold.k", holdKey] }] : []),
          ],
        },
      },
    },
  };
  return {
    $or: [
      { $not: [{ $gt: [{ $ifNull: ["$usageLimit", 0] }, 0] }] },
      {
        $lt: [
          { $add: [{ $ifNull: ["$usedCount", 0] }, otherLiveHolds] },
          "$usageLimit",
        ],
      },
    ],
  };
}

/** Drop holds whose checkout has had its window. Best-effort housekeeping. */
async function pruneExpiredCouponHolds(couponId: string, now: Date) {
  const expired = {
    $filter: {
      input: { $objectToArray: { $ifNull: ["$holds", { $literal: {} }] } },
      as: "hold",
      cond: { $lte: ["$$hold.v", now] },
    },
  };
  await Coupon.updateOne(
    { _id: couponId, $expr: { $gt: [{ $size: expired }, 0] } },
    [
      {
        $set: {
          holds: {
            $arrayToObject: {
              $filter: {
                input: { $objectToArray: "$holds" },
                as: "hold",
                cond: { $gt: ["$$hold.v", now] },
              },
            },
          },
        },
      },
    ],
    // Housekeeping, not an edit anyone made to the coupon.
    { updatePipeline: true, timestamps: false },
  ).catch((err) => console.error("Failed to prune expired coupon holds:", err));
}

/**
 * Keep one use of a limited coupon for a checkout that is about to take
 * payment, or refuse the coupon when every use is spent or held.
 *
 * A use used to be counted only once the payment landed, so every shopper who
 * reached checkout while one use was left got the discount — the count was
 * refused afterwards and the order kept its discount anyway. The hold is keyed
 * by shopper, so a retry refreshes it rather than taking a second, and it
 * lapses by itself when the checkout is abandoned.
 */
export async function holdCouponUse(params: {
  couponId: string;
  holdKey: string;
}): Promise<void> {
  const { couponId, holdKey } = params;
  const now = new Date();
  if (Types.ObjectId.isValid(couponId)) {
    const held = await Coupon.findOneAndUpdate(
      { _id: couponId, usageLimit: { $gt: 0 }, $expr: couponHasRoom(holdKey, now) },
      { $set: { [`holds.${holdKey}`]: new Date(now.getTime() + COUPON_HOLD_WINDOW_MS) } },
      { projection: { _id: 1 }, timestamps: false },
    ).lean();
    if (held) {
      await pruneExpiredCouponHolds(couponId, now);
      return;
    }
    // Refused — or a coupon with no limit, which needs no hold at all.
    const unlimited = await Coupon.exists({
      _id: couponId,
      $or: [{ usageLimit: null }, { usageLimit: { $lte: 0 } }],
    });
    if (unlimited) return;
  }
  throw new ValidationError({
    code: ["This coupon has reached its usage limit"],
  });
}

/**
 * Count one use of the coupon, turning `holdKey`'s hold into the use. Refused
 * when the coupon has no use to spare beyond other checkouts' holds — which a
 * live hold of this checkout's own guarantees it has. Returns true if counted.
 */
async function consumeCouponUse(
  couponId: string | undefined,
  holdKey?: string,
): Promise<boolean> {
  if (!couponId || !Types.ObjectId.isValid(couponId)) return false;

  const result = await Coupon.findOneAndUpdate(
    { _id: couponId, $expr: couponHasRoom(holdKey, new Date()) },
    {
      $inc: { usedCount: 1 },
      ...(holdKey ? { $unset: { [`holds.${holdKey}`]: "" } } : {}),
    },
    { projection: { _id: 1 } },
  ).lean();

  if (!result) {
    console.warn(
      `Coupon ${couponId} usage limit reached during increment; skipping.`,
    );
    return false;
  }
  return true;
}

/**
 * Take a use of the coupon for an order that commits before any payment —
 * cash on delivery, a pay-later pre-order — or refuse the coupon. Taken before
 * the order exists, so a coupon with no use left is refused instead of the
 * order being placed with its discount and the use going uncounted. Give it
 * back with `releaseCouponUse` if the order then fails to be created.
 */
export async function takeCouponUse(params: {
  couponId: string;
  holdKey: string;
}): Promise<void> {
  if (!(await consumeCouponUse(params.couponId, params.holdKey))) {
    throw new ValidationError({
      code: ["This coupon has reached its usage limit"],
    });
  }
}

/**
 * Decrement a coupon's usedCount when a previously-counted order is cancelled
 * or fully refunded, or when an order a use was taken for was never created.
 * Floors at 0 to avoid going negative if state is ever inconsistent.
 */
export async function releaseCouponUse(couponId?: string) {
  if (!couponId || !Types.ObjectId.isValid(couponId)) return;
  await Coupon.findOneAndUpdate(
    { _id: couponId, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 } },
  );
}

/**
 * Increment coupon usage for a specific order and atomically mark the order
 * as having consumed a use, idempotently. Returns true if this call did the
 * work, false if it had already been done (or there is no coupon).
 *
 * Used by capture/verify routes that may re-run on retry.
 */
export async function applyCouponUsageForOrder(orderId: string) {
  if (!Types.ObjectId.isValid(orderId)) return false;

  // Atomically claim the "first one to apply usage" right. Subsequent retries
  // see usageIncremented=true and short-circuit.
  const claimed = await Order.findOneAndUpdate(
    {
      _id: orderId,
      "coupon.couponId": { $exists: true, $ne: null },
      "coupon.usageIncremented": { $ne: true },
    },
    { $set: { "coupon.usageIncremented": true } },
    { returnDocument: "before" },
  );

  if (!claimed || !claimed.coupon?.couponId) return false;

  const ok = await consumeCouponUse(
    String(claimed.coupon.couponId),
    claimed.customerId ? couponHoldKey(String(claimed.customerId)) : undefined,
  );
  if (!ok) {
    // Atomic increment refused (limit reached). Roll back the flag so a
    // future retry won't think it's done — admins can reconcile manually.
    await Order.findByIdAndUpdate(orderId, {
      $set: { "coupon.usageIncremented": false },
    }).catch(() => undefined);
    return false;
  }
  return true;
}

/**
 * Decrement coupon usage for an order that previously incremented it.
 * Idempotent: if the flag is already cleared, this no-ops.
 */
export async function reverseCouponUsageForOrder(orderId: string) {
  if (!Types.ObjectId.isValid(orderId)) return;

  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, "coupon.usageIncremented": true },
    { $set: { "coupon.usageIncremented": false } },
    { returnDocument: "before" },
  );

  if (!claimed || !claimed.coupon?.couponId) return;
  await releaseCouponUse(String(claimed.coupon.couponId));
}

/**
 * Split a coupon's goods discount across vendors in proportion to `weights`,
 * to the cent, so the shares add back up exactly to `discount`. The cent left
 * by rounding goes to the vendor with the most at stake.
 *
 * Also how a share recorded against one discount is rescaled when checkout
 * caps the discount lower (a cart worth less than the coupon).
 */
export function splitCouponDiscount(
  discount: number,
  weights: Record<string, number>,
): Record<string, number> {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!(discount > 0) || totalWeight <= 0) return {};

  const shares: Record<string, number> = {};
  let assigned = 0;
  for (const [vendorId, weight] of entries) {
    const share = Math.floor(((discount * weight) / totalWeight) * 100) / 100;
    shares[vendorId] = share;
    assigned += share;
  }
  const remainder = roundMoney(discount - assigned);
  if (remainder !== 0) {
    const [largest] = [...entries].sort((a, b) => b[1] - a[1])[0];
    shares[largest] = roundMoney(shares[largest] + remainder);
  }
  return shares;
}
