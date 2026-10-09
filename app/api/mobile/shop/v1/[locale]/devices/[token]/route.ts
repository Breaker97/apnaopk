import { deviceUnregisterRoute } from "@/lib/api-core/shop/devices/unregister";
import { privateRoute } from "@/lib/api-next/routes";

export const DELETE = privateRoute(deviceUnregisterRoute);
