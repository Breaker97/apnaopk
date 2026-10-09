import {
  addToWishlistRoute,
  removeFromWishlistRoute,
} from "@/lib/api-core/shop/wishlist/change-wishlist";
import { privateRoute } from "@/lib/api-next/routes";

export const PUT = privateRoute(addToWishlistRoute);
export const DELETE = privateRoute(removeFromWishlistRoute);
