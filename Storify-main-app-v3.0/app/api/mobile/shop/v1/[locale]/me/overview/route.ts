import { meOverviewRoute } from "@/lib/api-core/shop/me/overview";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(meOverviewRoute);
