import { payoutDetailRoute } from "@/lib/api-core/biz/payouts/detail";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(payoutDetailRoute);
