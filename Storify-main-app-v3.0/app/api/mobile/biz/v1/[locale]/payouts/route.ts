import { payoutListRoute } from "@/lib/api-core/biz/payouts/list";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(payoutListRoute);
