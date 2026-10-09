import { orderPayVerifyRoute } from "@/lib/api-core/shop/orders/pay-verify";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(orderPayVerifyRoute);
