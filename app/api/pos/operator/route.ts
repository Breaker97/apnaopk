import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { canApplyPosDiscount } from "@/lib/access/rbac";
import {
  POS_OPERATOR_COOKIE,
  hasPosPin,
  issueOperatorToken,
  listPosOperators,
  resolvePosOperator,
  verifyOperatorPin,
} from "@/lib/pos/operator";

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  expires,
});

/** What the till shows about who is working it. */
async function operatorState(
  sessionUser: { id: string; name?: string | null; role?: string | null; roles?: (string | null | undefined)[] | null },
  operator: { id: string; name?: string | null; role?: string | null; roles?: (string | null | undefined)[] | null },
) {
  return {
    operator: { id: operator.id, name: operator.name || "", switched: operator.id !== sessionUser.id },
    sessionUser: { id: sessionUser.id, name: sessionUser.name || "" },
    canApplyDiscounts: await canApplyPosDiscount({
      id: operator.id,
      role: operator.role ?? undefined,
      roles: (operator.roles ?? undefined) as string[] | undefined,
    }),
  };
}

/**
 * GET /api/pos/operator — who is working this till, who could take over, and
 * whether the signed-in person has set their own PIN.
 */
export const GET = withApi(
  { auth: "user", rateLimit: { action: "pos:operator:read", preset: "lenient" } },
  async ({ request, session }) => {
    const operator = await resolvePosOperator(session.user, request.cookies);
    return successResponse({
      ...(await operatorState(session.user, operator)),
      operators: await listPosOperators(session.user),
      hasPin: await hasPosPin(session.user.id),
    });
  },
);

const SwitchSchema = z.object({
  operatorId: z.string().min(1).max(64),
  pin: z.string().min(1).max(16),
});

/** POST /api/pos/operator — a colleague takes over the till with their PIN. */
export const POST = withApi(
  { auth: "user", rateLimit: { action: "pos:operator:switch", preset: "strict" } },
  async ({ request, session }) => {
    const body = await validateBody(request, SwitchSchema);
    const cashier = await verifyOperatorPin({ user: session.user, operatorId: body.operatorId, pin: body.pin });
    const response = successResponse(
      await operatorState(session.user, { id: cashier.id, name: cashier.name, role: cashier.role, roles: cashier.roles }),
    );
    if (cashier.id === session.user.id) {
      response.cookies.delete(POS_OPERATOR_COOKIE);
    } else {
      const { token, expiresAt } = issueOperatorToken({ operatorId: cashier.id, sessionUserId: session.user.id });
      response.cookies.set(POS_OPERATOR_COOKIE, token, cookieOptions(expiresAt));
    }
    return response;
  },
);

/** DELETE /api/pos/operator — hand the till back to the signed-in person. */
export const DELETE = withApi(
  { auth: "user", rateLimit: { action: "pos:operator:read", preset: "lenient" } },
  async ({ session }) => {
    const response = successResponse(await operatorState(session.user, session.user));
    response.cookies.delete(POS_OPERATOR_COOKIE);
    return response;
  },
);
