import { updateReviewRoute } from "@/lib/api-core/shop/reviews/update";
import { privateRoute } from "@/lib/api-next/routes";

export const PATCH = privateRoute(updateReviewRoute);
