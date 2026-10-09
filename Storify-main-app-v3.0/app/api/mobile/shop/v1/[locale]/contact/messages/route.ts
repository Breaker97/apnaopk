import { contactMessageRoute } from "@/lib/api-core/shop/content/contact";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(contactMessageRoute);
