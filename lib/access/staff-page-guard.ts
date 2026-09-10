import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { StaffPermission } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { buildLoginUrl, returnPathFromHeaders } from "@/lib/auth/return-path";

export async function requireAdminOrStaffPageAccess(options: {
  locale: string;
  required?: StaffPermission[];
  mode?: "any" | "all";
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    redirect(
      buildLoginUrl(options.locale, returnPathFromHeaders(requestHeaders)),
    );
  }

  try {
    const { staffPermissions, staffScope } = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      options.required,
      options.mode || "any",
    );
    return { session, staffPermissions, staffScope };
  } catch {
    redirect(`/${options.locale}/forbidden`);
  }
}
