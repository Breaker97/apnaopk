import { chatSendAttachmentRoute } from "@/lib/api-core/shop/chat/attachments";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(chatSendAttachmentRoute);
