import { myQuotesRoute } from "@/lib/api-core/shop/quotes/routes";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(myQuotesRoute);
