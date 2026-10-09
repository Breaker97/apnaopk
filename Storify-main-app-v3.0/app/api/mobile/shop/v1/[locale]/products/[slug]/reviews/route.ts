import { productReviewsRoute } from "@/lib/api-core/shop/catalog/product-reviews";
import { createReviewRoute } from "@/lib/api-core/shop/reviews/create";
import { privateRoute, publicGet } from "@/lib/api-next/routes";

export const GET = publicGet(productReviewsRoute);
export const POST = privateRoute(createReviewRoute);
