import { collectionListRoute } from "@/lib/api-core/shop/catalog/collections";
import { publicGet } from "@/lib/api-next/routes";

export const GET = publicGet(collectionListRoute);
