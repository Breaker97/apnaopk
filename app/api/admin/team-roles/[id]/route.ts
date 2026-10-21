import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { resolveTeamAccess } from "@/lib/access/team-permissions";
import {
  UpdateTeamRoleSchema,
  deleteTeamRole,
  getTeamRole,
  updateTeamRole,
} from "@/lib/access/team-role-service";

/** GET /api/admin/team-roles/[id] — one role and its member count. */
export const GET = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:teamRoles:read", preset: "lenient" },
  },
  async ({ params }) => successResponse(await getTeamRole(params.id)),
);

/**
 * PUT /api/admin/team-roles/[id] — rename a role or change its permissions;
 * every member on it holds the new ones at once. The Administrator's
 * permissions stay "everything".
 */
export const PUT = withApi<{ id: string }>(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:teamRoles:update", preset: "moderate" },
  },
  async ({ request, params, session, team }) => {
    const input = await validateBody(request, UpdateTeamRoleSchema);
    const role = await updateTeamRole(
      params.id,
      input,
      team ?? (await resolveTeamAccess(session.user.id)),
      createAuditContext(request, session),
    );
    return successResponse(role, "Role updated");
  },
);

/** DELETE /api/admin/team-roles/[id] — a role the store made, once nobody has it. */
export const DELETE = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:teamRoles:delete", preset: "moderate" },
  },
  async ({ request, params, session, team }) => {
    await deleteTeamRole(params.id, team ?? (await resolveTeamAccess(session.user.id)), createAuditContext(request, session));
    return successResponse(null, "Role deleted");
  },
);
