import { inboxSendAttachmentRoute } from "@/lib/api-core/biz/inbox/attachments";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const POST = bizPrivateRoute(inboxSendAttachmentRoute);
