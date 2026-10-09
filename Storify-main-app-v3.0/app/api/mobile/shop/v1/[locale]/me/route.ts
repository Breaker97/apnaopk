import { privateRoute } from "@/lib/api-next/routes";
import { deleteAccountRoute } from "@/lib/api-core/shop/me/delete";
import { meRoute } from "@/lib/api-core/shop/me/me";
import { updateMeRoute } from "@/lib/api-core/shop/me/update";

export const GET = privateRoute(meRoute);
export const PATCH = privateRoute(updateMeRoute);
export const DELETE = privateRoute(deleteAccountRoute);
