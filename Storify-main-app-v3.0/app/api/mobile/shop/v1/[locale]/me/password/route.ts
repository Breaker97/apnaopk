import { privateRoute } from "@/lib/api-next/routes";
import { changePasswordRoute } from "@/lib/api-core/shop/me/password";

export const POST = privateRoute(changePasswordRoute);
