import { myReturnRoute } from "@/lib/api-core/shop/returns/routes";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(myReturnRoute);
