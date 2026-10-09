import { waitingReviewsRoute } from "@/lib/api-core/shop/reviews/mine";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(waitingReviewsRoute);
