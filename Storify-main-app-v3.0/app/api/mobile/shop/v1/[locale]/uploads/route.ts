import { uploadRoute } from "@/lib/api-core/shop/uploads/create";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(uploadRoute);
