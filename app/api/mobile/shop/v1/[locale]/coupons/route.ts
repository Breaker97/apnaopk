import { couponListRoute } from "@/lib/api-core/shop/coupons/list";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(couponListRoute);
