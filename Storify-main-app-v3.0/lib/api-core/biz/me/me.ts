import { ALL_STAFF_PERMISSIONS } from "@/config/permissions.config";
import { Me, type WorkspaceAccess } from "@/contracts/mobile/biz/v1/me";
import { BIZ_ACCESS, capabilitiesOf } from "@/lib/api-core/biz/access";
import type { BizActor, BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { isScoped, scopeOf } from "@/lib/api-core/biz/scope";
import { MobileApiError } from "@/lib/api-core/errors";
import type { MobileSession } from "@/lib/api-core/ports";
import { defineBizRoute } from "@/lib/api-core/registry";
import { absoluteUrl } from "@/lib/api-core/shop/absolute-url";
import { imageSet } from "@/lib/api-core/shop/images";
import { connectDB } from "@/lib/db";
import { AdminProfile, User } from "@/models";

function roleIn(grant: BizWorkspaceGrant): string {
  return grant.kind;
}

/** One workspace as GET /me describes it, decided by the rules the routes enforce. */
export function toWorkspaceAccess(grant: BizWorkspaceGrant): WorkspaceAccess {
  const permissions =
    grant.kind === "admin"
      ? [...ALL_STAFF_PERMISSIONS]
      : grant.kind === "staff"
        ? [...grant.permissions]
        : [...grant.access.effective];
  const vendor = grant.workspace === "vendor" ? grant.vendor : null;
  const logo = vendor ? imageSet(vendor.logo) : undefined;
  return {
    workspace: grant.workspace,
    role: roleIn(grant),
    capabilities: capabilitiesOf(grant),
    permissions,
    scoped: isScoped(scopeOf(grant)),
    ...(vendor
      ? {
          vendor: {
            id: vendor.id,
            name: vendor.name,
            ...(logo ? { logo } : {}),
            status: vendor.status,
            active: vendor.mode === "approved",
            packs: grant.kind === "vendor" ? [...grant.access.entitledPacks] : [],
          },
        }
      : {}),
  };
}

type UserRow = { name?: string; email?: string; image?: string; twoFactorEnabled?: boolean };

/**
 * The operator as GET /me describes them, read fresh from the account; also
 * the answer to a change of their own account (PUT /me/picture).
 */
export async function readBizMe(ctx: {
  session: MobileSession;
  actor: BizActor;
  workspace: BizWorkspaceGrant | null;
}): Promise<Me> {
  const { session, actor, workspace } = ctx;
  await connectDB();
  const [user, adminProfile] = await Promise.all([
    User.findById(session.user.id).select("name email image twoFactorEnabled").lean<UserRow | null>(),
    actor.role === "admin"
      ? AdminProfile.findOne({ userId: session.user.id }).select("isSuperAdmin").lean<{ isSuperAdmin?: boolean } | null>()
      : Promise.resolve(null),
  ]);
  // Deleted between the session check and here.
  if (!user) throw new MobileApiError(401, "AUTHENTICATION_ERROR", "Sign in to continue.");
  const imageUrl = absoluteUrl(user.image);
  return {
    id: session.user.id,
    name: String(user.name ?? ""),
    email: String(user.email ?? ""),
    ...(imageUrl ? { imageUrl } : {}),
    role: actor.role ?? session.user.role,
    isOwner: adminProfile?.isSuperAdmin === true,
    twoFactorEnabled: user.twoFactorEnabled === true,
    workspaces: actor.workspaces.map(toWorkspaceAccess),
    ...(workspace ? { currentWorkspace: workspace.workspace } : {}),
  };
}

/**
 * GET /me: who the operator is and where they can work. Read fresh: a role
 * or permission changed elsewhere shows at once (the workspaces come from the
 * operator the pipeline has just read).
 */
export const bizMeRoute = defineBizRoute({
  id: "me.get",
  method: "GET",
  path: "/me",
  auth: "user",
  ...BIZ_ACCESS.account,
  cache: { kind: "private" },
  output: Me,
  handler: ({ session, actor, workspace }) => readBizMe({ session, actor, workspace }),
});
