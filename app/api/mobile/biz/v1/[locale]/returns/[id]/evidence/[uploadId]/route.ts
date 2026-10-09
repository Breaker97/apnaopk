import { bizPrivateRoute } from "@/lib/api-next/routes";
import { returnEvidenceRoute } from "@/lib/api-core/biz/returns/routes";
export const GET = bizPrivateRoute(returnEvidenceRoute);
