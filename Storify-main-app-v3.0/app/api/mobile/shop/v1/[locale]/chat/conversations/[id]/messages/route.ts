import { chatMessagesRoute } from "@/lib/api-core/shop/chat/messages";
import { chatSendRoute } from "@/lib/api-core/shop/chat/send";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(chatMessagesRoute);
export const POST = privateRoute(chatSendRoute);
