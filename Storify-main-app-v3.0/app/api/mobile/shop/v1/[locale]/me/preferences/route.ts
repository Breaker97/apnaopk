import { preferencesRoute, updatePreferencesRoute } from "@/lib/api-core/shop/me/preferences";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(preferencesRoute);
export const PATCH = privateRoute(updatePreferencesRoute);
