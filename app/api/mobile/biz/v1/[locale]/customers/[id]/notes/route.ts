import { customerNoteCreateRoute, customerNotesRoute } from "@/lib/api-core/biz/customers/routes";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(customerNotesRoute);
export const POST = bizPrivateRoute(customerNoteCreateRoute);
