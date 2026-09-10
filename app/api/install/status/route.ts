import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { getActivePasswordPolicy } from "@/lib/auth/auth";
import { describePasswordPolicy } from "@/lib/auth/password-policy";
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
    auth: "optional",
    rateLimit: { action: "install:status", preset: "lenient" },
  },
  async () => {
    if (await isInstalled()) {
      return successResponse({ installed: true });
    }
    const policy = await getActivePasswordPolicy();
    return successResponse({
      installed: false,
      preflight: await getInstallPreflight(),
      passwordHint: describePasswordPolicy(policy),
      storageFromEnv: hasStorageEnvCredentials(),
    });
  },
);
