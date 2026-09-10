import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { auditSettingsChange, createAuditContext } from "@/lib/audit";
import {
  clearLockoutsForEmail,
  listActiveLockouts,
} from "@/lib/auth/login-lockout";

const UnlockSchema = z.object({
  email: z.string().trim().min(1).max(320),
});

/**
 * POST /api/admin/security/unlock
 *
 * Lift the failed-sign-in lock on an address. The lockout expires on its own,
 * but "wait fifteen minutes" is not an answer you can give a merchant standing
 * at their own till — and the lock is keyed per host, so a locked-out shop
 * cannot simply move to another browser.
 *
 * Audited, because clearing a brute-force counter is exactly the action an
 * attacker with an admin session would want to take quietly.
 */
export const POST = withApi(
  { auth: "admin", demo: "block-mutations" },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:security:unlock",
      "moderate",
      session.user.role,
    );

    const { email } = await validateBody(request, UnlockSchema);

    const before = await listActiveLockouts(email);
    const cleared = await clearLockoutsForEmail(email);

    await auditSettingsChange(
      createAuditContext(request, session),
      "security.lockout",
      { email, lockedHosts: before.length },
      { email, lockedHosts: 0 },
    );

    return successResponse(
      { cleared, wasLocked: before.length > 0 },
      before.length > 0
        ? "Account unlocked. They can sign in again now."
        : "That address was not locked. Nothing to clear.",
    );
  },
);
