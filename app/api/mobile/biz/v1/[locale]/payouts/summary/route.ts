import { payoutSummaryRoute } from "@/lib/api-core/biz/payouts/summary";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(payoutSummaryRoute);
