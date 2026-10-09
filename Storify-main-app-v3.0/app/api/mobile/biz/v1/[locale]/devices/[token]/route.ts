import { bizDeviceUnregisterRoute } from "@/lib/api-core/biz/devices/unregister";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const DELETE = bizPrivateRoute(bizDeviceUnregisterRoute);
