import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { getActivePasswordPolicy } from "@/lib/auth/auth";
import {
  DEFAULT_PASSWORD_POLICY,
  describePasswordPolicy,
} from "@/lib/auth/password-policy";
import {
  getInstallPreflight,
  hasStorageEnvCredentials,
  isInstalled,
} from "@/lib/install/status";

/**
 * Wizard bootstrap: install state + environment preflight. Public by
 * necessity (nobody exists yet); once installed it answers only
 * `{ installed: true }` so a live store leaks nothing about its setup.
 */
export const GET = withApi(
  {
    // No `auth`, not even optional: reading a session builds the auth
    // instance, which refuses to build in production on a missing or weak
    // BETTER_AUTH_SECRET — exactly what this endpoint exists to report. With
    // it, that buyer got a 500 and the wizard blamed MongoDB instead.
    rateLimit: { action: "install:status", preset: "lenient" },
  },
  async () => {
    if (await isInstalled()) {
      return successResponse({ installed: true });
    }
    // Same trap: the policy lives on the auth instance. A store with no
    // admin yet runs the default rules anyway, and a weak secret blocks the
    // wizard before any password is typed.
    const policy = await getActivePasswordPolicy().catch(
      () => DEFAULT_PASSWORD_POLICY,
    );
    return successResponse({
      installed: false,
      preflight: await getInstallPreflight(),
      passwordHint: describePasswordPolicy(policy),
      storageFromEnv: hasStorageEnvCredentials(),
    });
  },
);
