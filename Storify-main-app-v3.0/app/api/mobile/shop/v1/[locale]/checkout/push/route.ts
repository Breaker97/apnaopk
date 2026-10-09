import { pushStartRoute } from "@/lib/api-core/shop/checkout/push";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(pushStartRoute);
