import { chatDraftRoute } from "@/lib/api-core/shop/chat/draft";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(chatDraftRoute);
