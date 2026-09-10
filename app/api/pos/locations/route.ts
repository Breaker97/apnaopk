import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError } from "@/lib/api/errors";
import { canAccessPOS } from "@/lib/access/rbac";
import { withApi } from "@/lib/api/handler";
import { listPOSLocations } from "@/lib/pos/list-locations";

/**
 * GET /api/pos/locations
 *
 * The counters this cashier may stand at, re-read after the page was rendered.
 *
 * The POS page ships this list with the server render, which is enough for the
 * shift-start question but not for the rest of a shift: a register is left open
 * for hours, and an admin can deactivate a branch or take a counter off the till
 * while a cashier is standing at it. Without a way to re-ask, the terminal would
 * keep decrementing a closed branch until someone reloaded the tab.
 *
 * Deliberately the same `listPOSLocations` the server render uses, so a refresh
 * can never widen what the page was originally allowed to show.
 */
export const GET = withApi({ auth: "user" }, async ({ session }) => {
  if (!(await canAccessPOS(session.user))) throw new AuthorizationError();

  await connectDB();

  return successResponse({
    locations: await listPOSLocations(session.user),
  });
});
