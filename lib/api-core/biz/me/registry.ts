import type { BizRouteEntry } from "@/lib/api-core/registry";
import { bizMeRoute } from "./me";
import { bizMePictureRemoveRoute, bizMePictureUpdateRoute } from "./picture";

/** The signed-in operator. */
export const meRoutes: readonly BizRouteEntry[] = [bizMeRoute, bizMePictureUpdateRoute, bizMePictureRemoveRoute];
