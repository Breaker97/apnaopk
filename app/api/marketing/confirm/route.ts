import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import {
  findProfileByUnsubscribeToken,
  readEmailConsentState,
  setMarketingConsent,
} from "@/lib/customers/marketing-consent";
import {
  MARKETING_CONSENT_SOURCE,
  MARKETING_CONSENT_STATE,
  MARKETING_OPT_IN_LEVEL,
} from "@/config/app.config";

/**
 * The link in a double opt-in confirmation email.
 *
 * It only moves a shopper the store is already waiting on — `pending`, or
 * `subscribed` already, which makes a second click harmless. A link opened by
 * someone who has since unsubscribed does not quietly put them back: that
 * would turn every old confirmation email into a way to undo an unsubscribe.
 */

const ConfirmSchema = z.object({ token: z.string().min(16).max(128) });

export const POST = withApi({ auth: "optional" }, async ({ request }) => {
  await rateLimitByIP(request, "moderate");

  const { token } = await validateBody(request, ConfirmSchema);
  const profile = await findProfileByUnsubscribeToken(token);
  if (!profile) return notFoundResponse("Subscription");

  const state = readEmailConsentState(profile);
  if (
    state !== MARKETING_CONSENT_STATE.PENDING &&
    state !== MARKETING_CONSENT_STATE.SUBSCRIBED
  ) {
    return notFoundResponse("Subscription");
  }

  const result = await setMarketingConsent({
    profileId: String(profile._id),
    state: MARKETING_CONSENT_STATE.SUBSCRIBED,
    optInLevel: MARKETING_OPT_IN_LEVEL.CONFIRMED,
    source: MARKETING_CONSENT_SOURCE.CONFIRMATION_LINK,
  });

  return successResponse({ state: result.state });
});
