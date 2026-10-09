import { stripeConfirmRoute } from "@/lib/api-core/shop/checkout/stripe-confirm";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(stripeConfirmRoute);
