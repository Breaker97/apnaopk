import { inboxAssignmentRoute } from "@/lib/api-core/biz/inbox/assignment";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const PUT = bizPrivateRoute(inboxAssignmentRoute);
