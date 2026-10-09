import { meProductRoute } from "@/lib/api-core/shop/me/product";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(meProductRoute);
