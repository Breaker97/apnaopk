import { compareRoute } from "@/lib/api-core/shop/catalog/compare";
import { publicGet } from "@/lib/api-next/routes";

export const GET = publicGet(compareRoute);
