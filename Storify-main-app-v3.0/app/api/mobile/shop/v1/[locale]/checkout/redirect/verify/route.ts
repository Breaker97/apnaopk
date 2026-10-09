import { redirectVerifyRoute } from "@/lib/api-core/shop/checkout/redirect-verify";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(redirectVerifyRoute);
