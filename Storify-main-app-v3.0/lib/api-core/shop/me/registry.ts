import type { RouteEntry } from "@/lib/api-core/registry";
import { deleteAccountRoute } from "./delete";
import { meRoute } from "./me";
import { meOverviewRoute } from "./overview";
import { changePasswordRoute } from "./password";
import { preferencesRoute, updatePreferencesRoute } from "./preferences";
import { meProductRoute } from "./product";
import { updateMeRoute } from "./update";

/**
 * The signed-in shopper: profile, password, account deletion, the private overlays.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const meRoutes: readonly RouteEntry[] = [
  meRoute,
  updateMeRoute,
  changePasswordRoute,
  deleteAccountRoute,
  meOverviewRoute,
  meProductRoute,
  preferencesRoute,
  updatePreferencesRoute,
];
