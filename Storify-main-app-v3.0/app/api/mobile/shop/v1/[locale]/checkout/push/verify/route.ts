import { pushVerifyRoute } from "@/lib/api-core/shop/checkout/push-verify";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(pushVerifyRoute);
