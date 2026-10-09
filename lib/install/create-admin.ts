import "server-only";

import { USER_ROLES } from "@/config/app.config";
import { ADMIN_PERMISSIONS } from "@/config/permissions.config";
import { ValidationError } from "@/lib/api/errors";
import { getActivePasswordPolicy, getAuthContext } from "@/lib/auth/auth";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { AdminProfile, User } from "@/models";
import { DEMO_PASSWORDS } from "@/lib/install/demo-seed-guard";

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
 *
 * Without a transaction the three writes are undone by hand instead: the
 * User row alone already locks the wizard, so a profile or credential write
 * that fails after it would leave a store nobody can sign in to and nobody
 * can install. On such a failure the rows this call made are removed and the
 * error is rethrown, which reopens the wizard for another attempt.
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
  // They meet the policy, and they are printed in the README for anyone.
  if (DEMO_PASSWORDS.includes(input.password)) {
    throw new ValidationError(
      "That is one of the published demo passwords. Choose your own.",
    );
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

  try {
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
  } catch (error) {
    await undoAdmin(ctx, String(admin._id));
    throw error;
  }

  return { userId: String(admin._id) };
}

/**
 * Remove what a failed `createInstallAdmin` wrote. Each removal is attempted
 * even when another fails; a leftover is logged, because only someone with
 * database access can then clear it.
 */
async function undoAdmin(
  ctx: Awaited<ReturnType<typeof getAuthContext>>,
  userId: string,
) {
  const results = await Promise.allSettled([
    ctx.internalAdapter.deleteAccounts(userId),
    AdminProfile.deleteMany({ userId }),
    User.deleteOne({ _id: userId }),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        "[install] A half-created admin could not be removed; the installer stays locked until it is:",
        result.reason,
      );
    }
  }
}
