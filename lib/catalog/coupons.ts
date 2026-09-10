import { Types } from "mongoose";
import { Coupon, Order, Product } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { CouponStatus, CouponType } from "@/models/coupon.model";
import { PAYMENT_STATUS } from "@/config/app.config";
import {
  isFreeShippingCouponType,
} from "@/lib/catalog/discounts";
import { roundMoney } from "@/lib/intl/money";

// Order payment statuses that represent an actual coupon use. Pending and
// cancelled orders should not block a customer from retrying.
const COUPON_CONSUMING_PAYMENT_STATUSES = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.PARTIALLY_PAID,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
];

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
}

type ValidateCouponParams = {
  code: string;
  subtotal: number;
  shippingCost?: number;
  cartItems: CouponCartItem[];
  userId?: string;
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

  if (coupon.perUserLimit && params.userId) {
    // Only count orders that actually consumed the coupon — pending or
    // cancelled orders must not lock the customer out from retrying.
    const userUsageCount = await Order.countDocuments({
      customerId: params.userId,
      "coupon.code": coupon.code,
      "coupon.usageIncremented": true,
      paymentStatus: { $in: COUPON_CONSUMING_PAYMENT_STATUSES },
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

      return sum + item.price * item.quantity;
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
  if (couponType === CouponType.FREE_SHIPPING) {
    const shippingCost = Math.max(0, Number(params.shippingCost ?? 0));
    if (shippingCost <= 0) {
      throw new ValidationError("Shipping is already free for this order");
    }
    discount = shippingCost;
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

  return {
    couponId: String(coupon._id),
    code: coupon.code,
    type: couponType,
    value: coupon.value,
    discount: roundMoney(discount),
    discountTarget,
    maxDiscount:
      typeof coupon.maxDiscount === "number" ? coupon.maxDiscount : undefined,
    description: coupon.description,
  };
}

/**
 * Atomically increment the coupon's usedCount, refusing the update if doing
 * so would exceed `usageLimit`. Returns true if the increment succeeded.
 *
 * The conditional update closes the race where two concurrent checkouts both
 * pass `validateAndCalculateCoupon` and then both call increment. With this
 * helper the second one will return false and the caller can decide how to
 * handle it (typically: log and proceed, since the order has already been
 * accepted by the gateway).
 */
async function incrementCouponUsage(couponId?: string): Promise<boolean> {
  if (!couponId || !Types.ObjectId.isValid(couponId)) return false;

  const result = await Coupon.findOneAndUpdate(
    {
      _id: couponId,
      $or: [
        { usageLimit: null },
        { usageLimit: { $exists: false } },
        { $expr: { $lt: ["$usedCount", "$usageLimit"] } },
      ],
    },
    { $inc: { usedCount: 1 } },
    { new: true },
  );

  if (!result) {
    console.warn(
      `Coupon ${couponId} usage limit reached during increment; skipping.`,
    );
    return false;
  }
  return true;
}

/**
 * Decrement a coupon's usedCount when a previously-counted order is cancelled
 * or fully refunded. Floors at 0 to avoid going negative if state is ever
 * inconsistent.
 */
async function decrementCouponUsage(couponId?: string) {
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
    { new: false },
  );

  if (!claimed || !claimed.coupon?.couponId) return false;

  const ok = await incrementCouponUsage(String(claimed.coupon.couponId));
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
    { new: false },
  );

  if (!claimed || !claimed.coupon?.couponId) return;
  await decrementCouponUsage(String(claimed.coupon.couponId));
}
