import { mergeCartRoute } from "@/lib/api-core/shop/cart/merge-cart";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(mergeCartRoute);
