import { brandListRoute } from "@/lib/api-core/shop/catalog/brands";
import { publicGet } from "@/lib/api-next/routes";

export const GET = publicGet(brandListRoute);
