import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { resolveTeamAccess } from "@/lib/access/team-permissions";
import {
  CreateTeamRoleSchema,
  createTeamRole,
  listTeamRoles,
} from "@/lib/access/team-role-service";

/**
 * GET /api/admin/team-roles — every team role, the built-ins first, with how
 * many members each has. Open to whoever sees the Team page.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:teamRoles:list", preset: "lenient" },
  },
  async () => successResponse(await listTeamRoles()),
);

/**
 * POST /api/admin/team-roles — a new role: a name, the dashboard its members
 * use (`tier`), and its permissions — never more than the creator holds.
 */
export const POST = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:teamRoles:create", preset: "moderate" },
  },
  async ({ request, session, team }) => {
    const input = await validateBody(request, CreateTeamRoleSchema);
    const role = await createTeamRole(
      input,
      team ?? (await resolveTeamAccess(session.user.id)),
      createAuditContext(request, session),
    );
    return successResponse(role, "Role created", 201);
  },
);
