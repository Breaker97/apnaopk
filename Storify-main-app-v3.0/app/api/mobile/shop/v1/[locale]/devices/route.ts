import { deviceRegisterRoute } from "@/lib/api-core/shop/devices/register";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(deviceRegisterRoute);
