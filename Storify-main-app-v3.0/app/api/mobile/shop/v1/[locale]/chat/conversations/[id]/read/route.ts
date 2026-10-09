import { chatReadRoute } from "@/lib/api-core/shop/chat/read";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(chatReadRoute);
