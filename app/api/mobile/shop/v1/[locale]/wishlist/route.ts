import { getWishlistRoute } from "@/lib/api-core/shop/wishlist/get-wishlist";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(getWishlistRoute);
