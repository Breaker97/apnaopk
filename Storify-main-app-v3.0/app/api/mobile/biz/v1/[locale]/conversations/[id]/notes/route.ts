import { inboxNoteRoute } from "@/lib/api-core/biz/inbox/notes";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const POST = bizPrivateRoute(inboxNoteRoute);
