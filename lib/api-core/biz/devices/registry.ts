import type { BizRouteEntry } from "@/lib/api-core/registry";
import { bizDeviceRegisterRoute } from "./register";
import { bizDeviceUnregisterRoute } from "./unregister";

/** The business app's push registration. */
export const devicesRoutes: readonly BizRouteEntry[] = [bizDeviceRegisterRoute, bizDeviceUnregisterRoute];
