import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { CARRIER_PROVIDERS } from "@/lib/shipping/carrier-config";
import { carrierAdapter } from "@/lib/shipping/carriers/registry";
import { resolveCarrierContext } from "@/lib/shipping/carriers/credentials";
import { CarrierError } from "@/lib/shipping/carriers/errors";
import {
  clearCarrierAuthFailure,
  flagCarrierAuthFailure,
} from "@/lib/shipping/carriers/health";

const TestCarrierSchema = z.object({
  provider: z.enum(CARRIER_PROVIDERS),
});

/**
 * POST /api/admin/settings/test-carrier
 *
 * Makes the cheapest authenticating call the provider offers, so an admin can
 * prove their credentials work before an order depends on them. Mirrors
 * `test-payment`, but written through `withApi` (that route predates it).
 */
export const POST = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:settings:test-carrier", preset: "strict" },
  },
  async ({ request }) => {
    const { provider } = await validateBody(request, TestCarrierSchema);

    // `ignoreEnabled`: an admin is entitled to test credentials before
    // switching the carrier on, which is the order most people work in.
    const context = await resolveCarrierContext({
      provider,
      ignoreEnabled: true,
    });

    try {
      const result = await carrierAdapter(provider).testConnection(context);
      // Proving the credentials work is exactly the act that should retire a
      // standing alarm about them — this is the button a merchant presses after
      // pasting a new token.
      await clearCarrierAuthFailure(provider);
      return successResponse(
        { mode: result.mode, account: result.account },
        result.account
          ? `Connected to ${provider} (${result.mode}) — ${result.account}`
          : `Connected to ${provider} (${result.mode})`,
      );
    } catch (error) {
      if (error instanceof CarrierError) {
        if (error.authFailure) {
          // Raised here as well as in the worker: an admin testing a carrier
          // that nothing has shipped on yet is the first place a dead
          // credential shows up, and the banner should already be right when
          // they next open the page.
          await flagCarrierAuthFailure(provider, error.message);
        }
        // A credential fault is the admin's to fix, so it is reported as a
        // validation failure rather than a 500.
        throw new ValidationError(error.message);
      }
      throw error;
    }
  },
);
