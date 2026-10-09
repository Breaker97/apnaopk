import * as z from "zod";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { changeOwnPassword } from "@/lib/auth/own-password";
import { createAuditContext } from "@/lib/audit";
import { withApi } from "@/lib/api/handler";

const ChangePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  // Length and complexity are the admin's policy, checked by changeOwnPassword.
  // A fixed minimum here would answer first, with a different rule and message.
  newPassword: z.string(),
});

/**
 * The account page changes passwords here, not through Better Auth's own
 * /change-password, so the catch-all route's policy check never sees these
 * requests: `changeOwnPassword` (lib/auth/own-password.ts) applies it, the
 * same as for the shopper app's `POST /me/password`.
 */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "change-password", preset: "strict" },
  },
  async ({ request, session }) => {
    const { currentPassword, newPassword } = await validateBody(
      request,
      ChangePasswordSchema,
    );

    const result = await changeOwnPassword({
      userId: session.user.id,
      sessionId: session.session.id,
      signedInAt: session.session.createdAt,
      currentPassword,
      newPassword,
      auditContext: createAuditContext(request, session),
    });

    if (!result.ok) {
      const { field, message } = result.refusal;
      if (field === null) throw new AuthorizationError(message);
      throw new ValidationError({ [field]: [message] });
    }

    return successResponse(
      { updated: true, mode: result.mode },
      result.mode === "changed"
        ? "Password changed successfully"
        : "Password set successfully",
    );
  },
);
