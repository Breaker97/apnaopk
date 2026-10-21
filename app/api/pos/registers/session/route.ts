import * as z from "zod";
import { getSettingsLean } from "@/models";
import { withApi } from "@/lib/api/handler";
import { createdResponse, successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import {
  findOpenSession,
  openRegisterSession,
  registerSessionTotals,
  registerVendorScope,
} from "@/lib/pos/register-session";
import { resolvePosOperator } from "@/lib/pos/operator";
import { registerSessionView } from "@/lib/pos/register-session-dto";

/**
 * GET /api/pos/registers/session?terminalId= — this device's open drawer, with
 * its running totals (the X report), or null.
 */
export const GET = withApi(
  { auth: "user", rateLimit: { action: "pos:registers", preset: "lenient" } },
  async ({ request, session }) => {
    const vendorId = await registerVendorScope(session.user);
    const terminalId = new URL(request.url).searchParams.get("terminalId") || "";
    const open = terminalId ? await findOpenSession(vendorId, terminalId) : null;
    return successResponse(
      open ? await registerSessionView(open, await registerSessionTotals(open)) : null,
    );
  },
);

const OpenSchema = z.object({
  terminalId: z.string().max(40),
  locationId: z.string().max(64).optional(),
  openingFloat: z.number().min(0),
  requestId: z.string().max(100),
});

/** POST /api/pos/registers/session — open this device's drawer with a float. */
export const POST = withApi(
  { auth: "user", rateLimit: { action: "pos:registers", preset: "lenient" } },
  async ({ request, session }) => {
    const vendorId = await registerVendorScope(session.user);
    const body = await validateBody(request, OpenSchema);
    const settings = await getSettingsLean();
    const { session: opened, created } = await openRegisterSession({
      vendorId,
      terminalId: body.terminalId,
      locationId: body.locationId,
      openingFloat: body.openingFloat,
      currency: settings.general?.defaultCurrency || "USD",
      openedBy: (await resolvePosOperator(session.user, request.cookies)).id,
      requestId: body.requestId,
    });
    const view = await registerSessionView(opened, await registerSessionTotals(opened));
    return created ? createdResponse(view) : successResponse(view);
  },
);
