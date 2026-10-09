import { orderTrackRoute } from "@/lib/api-core/shop/orders/track";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(orderTrackRoute);
