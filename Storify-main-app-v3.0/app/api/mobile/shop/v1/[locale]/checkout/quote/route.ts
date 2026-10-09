import { checkoutQuoteRoute } from "@/lib/api-core/shop/checkout/quote";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(checkoutQuoteRoute);
