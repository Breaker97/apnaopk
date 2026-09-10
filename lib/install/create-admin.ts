import "server-only";

import { USER_ROLES } from "@/config/app.config";
import { ADMIN_PERMISSIONS } from "@/config/permissions.config";
import { ValidationError } from "@/lib/api/errors";
import { getActivePasswordPolicy, getAuthContext } from "@/lib/auth/auth";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { AdminProfile, User } from "@/models";

/**
 * Create the FIRST admin — the install wizard's account step.
 *
 * Mirrors the seed script's admin creation exactly (the canonical shape):
 * app User doc with the better-auth password hash, a SuperAdmin profile
 * with every permission, and the credential account linked through
 * better-auth's internal adapter so the same password signs in at /login.
 * No transaction on purpose — standalone MongoDB (no replica set) must
 * install too, and the wizard's lock makes a concurrent duplicate run
 * impossible in practice (the first successful User.create locks it).
 */
export async function createInstallAdmin(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ userId: string }> {
  const policy = await getActivePasswordPolicy();
  const problem = checkPasswordPolicy(input.password, policy);
  if (problem) {
    throw new ValidationError(problem);
  }

  const ctx = await getAuthContext();
  const passwordHash = await ctx.password.hash(input.password);

  const admin = await User.create({
    name: input.name,
    email: input.email,
    password: passwordHash,
    role: USER_ROLES.ADMIN,
    roles: [USER_ROLES.ADMIN],
    emailVerified: true,
    emailVerifiedAt: new Date(),
    status: "active",
  });

  await AdminProfile.create({
    userId: admin._id,
    isSuperAdmin: true,
    permissions: Object.values(ADMIN_PERMISSIONS),
    department: "Operations",
  });

  await ctx.internalAdapter.createAccount({
    userId: String(admin._id),
    providerId: "credential",
    accountId: String(admin._id),
    password: passwordHash,
  });

  return { userId: String(admin._id) };
}
