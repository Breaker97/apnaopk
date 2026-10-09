import {
  COUPON_LIST_MAX,
  CouponList,
  type CouponReason,
  type ShopperCoupon,
} from "@/contracts/mobile/shop/v1/coupons";
import type { MobileSession } from "@/lib/api-core/ports";
import { defineRoute } from "@/lib/api-core/registry";
import { appCartIdentity } from "@/lib/api-core/shop/cart/app-cart";
import { toMoney } from "@/lib/api-core/shop/money";
import { getCartView, type CartView } from "@/lib/cart/cart-service";
import {
  CouponRefusedError,
  assertCouponOpenToShopper,
  calculateCouponForCart,
  type CouponDocument,
} from "@/lib/catalog/coupons";
import { connectDB } from "@/lib/db";
import type { Currency } from "@/lib/intl/currencies";
import { formatCurrency } from "@/lib/intl/money";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import { Coupon, Vendor } from "@/models";
import { CouponStatus, CouponType } from "@/models/coupon.model";
import { getCouponCopy } from "@/lib/catalog/coupon-copy";
import type { CouponCopy } from "@/lib/catalog/coupon-words";

/**
 * GET /coupons: the shopper's coupon sheet. The codes the store lists
 * (Discounts → "Show to shoppers"), each judged by checkout's own rules
 * (`assertCouponOpenToShopper`, then `calculateCouponForCart` against the cart
 * as it stands) and worded in the path's locale. Nothing here decides a code
 * differently from checkout: a code shown usable is one the quote applies,
 * unless the cart or the coupon changes in between.
 */

type Judgement =
  | { usable: true; discount?: number }
  | { usable: false; reason: CouponReason; shortBy?: number; startsAt?: Date };

const idOf = (value: unknown): string =>
  value && typeof value === "object" && "_id" in value
    ? String((value as { _id: unknown })._id)
    : String(value ?? "");

/** The cart as the coupon rules read it; null for no cart or an empty one. */
function couponCart(view: CartView | null) {
  if (!view || view.lines.length === 0) return null;
  return {
    subtotal: view.subtotal,
    cartItems: view.lines.map((line) => ({
      productId: idOf(line.item.productId),
      price: Number(line.item.price) || 0,
      quantity: Number(line.item.quantity) || 0,
      ...(line.facts?.vendorId ? { vendorId: line.facts.vendorId } : {}),
      quoted: line.quoted,
    })),
  };
}

async function judge(
  coupon: CouponDocument,
  shopper: { userId?: string; email?: string },
  cart: ReturnType<typeof couponCart>,
  currency: Currency,
): Promise<Judgement> {
  try {
    await assertCouponOpenToShopper(coupon, shopper);
    if (!cart) return { usable: true };
    const result = await calculateCouponForCart(coupon, {
      ...cart,
      ...shopper,
      shippingUnknown: true,
      currency: currency.code,
    });
    return {
      usable: true,
      ...(result.discountTarget === "subtotal" ? { discount: result.discount } : {}),
    };
  } catch (error) {
    if (!(error instanceof CouponRefusedError)) throw error;
    return {
      usable: false,
      reason: error.refusal,
      ...(error.facts.shortBy && error.facts.shortBy > 0 ? { shortBy: error.facts.shortBy } : {}),
      ...(error.facts.startsAt ? { startsAt: error.facts.startsAt } : {}),
    };
  }
}

function kindOf(coupon: CouponDocument): "PERCENTAGE" | "FIXED" | "FREE_SHIPPING" {
  if (coupon.type === CouponType.FREE_SHIPPING) return "FREE_SHIPPING";
  if (coupon.type === CouponType.FIXED) return "FIXED";
  return "PERCENTAGE";
}

function toShopperCoupon(
  coupon: CouponDocument,
  verdict: Judgement,
  ctx: { copy: CouponCopy; currency: Currency; sellerName?: string },
): ShopperCoupon {
  const { copy, currency } = ctx;
  const money = (amount: number) => toMoney(amount, currency);
  const say = (amount: number) => formatCurrency(amount, currency.code, currency.locale);
  const kind = kindOf(coupon);
  const minimum = Number(coupon.minOrderAmount) || 0;
  const cap = kind === "PERCENTAGE" && Number(coupon.maxDiscount) > 0 ? Number(coupon.maxDiscount) : 0;

  const conditions: string[] = [];
  if (minimum > 0) conditions.push(copy.minOrder(say(minimum)));
  if (cap > 0) conditions.push(copy.maxDiscount(say(cap)));
  if (ctx.sellerName) conditions.push(copy.sellerOnly(ctx.sellerName));
  if (coupon.applicableProducts?.length || coupon.applicableCategories?.length || coupon.excludedProducts?.length) {
    conditions.push(copy.selectedProducts());
  }
  if (coupon.perUserLimit && coupon.perUserLimit > 0) conditions.push(copy.perCustomer(coupon.perUserLimit));
  if (coupon.endDate) conditions.push(copy.ends(new Date(coupon.endDate)));

  const now = Date.now();
  return {
    code: coupon.code,
    ...(coupon.label?.trim() ? { title: coupon.label.trim() } : {}),
    kind,
    benefit:
      kind === "FREE_SHIPPING"
        ? copy.offerFreeShipping()
        : kind === "FIXED"
          ? copy.offerFixed(say(coupon.value))
          : copy.offerPercent(coupon.value),
    ...(kind === "FIXED" ? { benefitAmount: money(coupon.value) } : {}),
    conditions,
    ...(minimum > 0 ? { minimumSpend: money(minimum) } : {}),
    ...(cap > 0 ? { maxDiscount: money(cap) } : {}),
    ...(coupon.endDate ? { endsAt: new Date(coupon.endDate).toISOString() } : {}),
    ...(coupon.startDate && new Date(coupon.startDate).getTime() > now
      ? { startsAt: new Date(coupon.startDate).toISOString() }
      : {}),
    usable: verdict.usable,
    ...(verdict.usable
      ? verdict.discount !== undefined
        ? { discount: money(verdict.discount) }
        : {}
      : {
          reason: verdict.reason,
          reasonMessage: copy.refusal(verdict.reason, {
            ...(verdict.shortBy ? { shortBy: say(verdict.shortBy) } : {}),
            ...(verdict.startsAt ? { startsAt: verdict.startsAt } : {}),
          }),
          ...(verdict.shortBy ? { shortBy: money(verdict.shortBy) } : {}),
        }),
  };
}

/** The listed codes a shopper may see now: switched on and not ended. */
function listedCoupons() {
  return Coupon.find({
    listed: true,
    status: CouponStatus.ACTIVE,
    endDate: { $gte: new Date() },
  })
    .sort({ endDate: 1 })
    .limit(COUPON_LIST_MAX);
}

async function sellerNames(coupons: CouponDocument[]): Promise<Map<string, string>> {
  const ids = [...new Set(coupons.map((coupon) => (coupon.vendorId ? String(coupon.vendorId) : "")).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const vendors = await Vendor.find({ _id: { $in: ids } })
    .select("storeName")
    .lean<Array<{ _id: unknown; storeName?: string }>>();
  return new Map(
    vendors.filter((vendor) => vendor.storeName?.trim()).map((vendor) => [String(vendor._id), vendor.storeName!.trim()]),
  );
}

async function readCouponList(ctx: {
  session: MobileSession | null;
  client: Parameters<typeof appCartIdentity>[1];
  locale: string;
}): Promise<CouponList> {
  await connectDB();
  const identity = appCartIdentity(ctx.session, ctx.client);
  const [coupons, view, currency, copy] = await Promise.all([
    listedCoupons(),
    identity ? getCartView(identity, { forApp: true }) : null,
    getStoreCurrency(),
    getCouponCopy(ctx.locale),
  ]);
  const cart = couponCart(view);
  const shopper = ctx.session
    ? { userId: ctx.session.user.id, email: ctx.session.user.email }
    : {};
  const [verdicts, sellers] = await Promise.all([
    Promise.all(coupons.map((coupon) => judge(coupon, shopper, cart, currency))),
    sellerNames(coupons),
  ]);
  const items = coupons.map((coupon, index) =>
    toShopperCoupon(coupon, verdicts[index], {
      copy,
      currency,
      sellerName: coupon.vendorId ? sellers.get(String(coupon.vendorId)) : undefined,
    }),
  );
  // Usable first; within each, the soonest end first (the query's order).
  items.sort((a, b) => Number(b.usable) - Number(a.usable));
  return { items, cartChecked: cart !== null };
}

export const couponListRoute = defineRoute({
  id: "coupons.list",
  method: "GET",
  path: "/coupons",
  auth: "optional",
  cache: { kind: "private" },
  etag: true,
  rateLimit: { bucket: "coupons:list", preset: "browse" },
  output: CouponList,
  handler: ({ session, client, locale }) => readCouponList({ session, client, locale }),
});
