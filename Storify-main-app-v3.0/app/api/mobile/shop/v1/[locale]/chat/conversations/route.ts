import { chatConversationListRoute } from "@/lib/api-core/shop/chat/list";
import { chatStartRoute } from "@/lib/api-core/shop/chat/start";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(chatConversationListRoute);
export const POST = privateRoute(chatStartRoute);
