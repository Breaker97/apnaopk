import { sponsoredEventsRoute } from "@/lib/api-core/shop/home/sponsored-events";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(sponsoredEventsRoute);
