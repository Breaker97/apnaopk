import { bizDeviceRegisterRoute } from "@/lib/api-core/biz/devices/register";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const POST = bizPrivateRoute(bizDeviceRegisterRoute);
