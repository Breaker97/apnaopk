import { myStoreCreditHistoryRoute } from "@/lib/api-core/shop/store-credit/routes";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(myStoreCreditHistoryRoute);
