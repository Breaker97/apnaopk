import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { applyUnsubscribeLink } from "@/lib/customers/marketing-consent";

/**
 * The unsubscribe link at the foot of every marketing email.
 *
 * Public and account-less on purpose: most shoppers this store emails are
 * guests, and a way out that requires signing in is not a way out. The token
 * is the only credential, so it is all this route will act on — it never takes
 * an email address, which would otherwise let anyone unsubscribe anyone.
 *
 * Resubscribing is offered from the same page, for the shopper who clicked by
 * mistake; it is recorded as a single opt-in from the link, not as consent the
 * store collected — and only for someone who was a subscriber before. See
 * `applyUnsubscribeLink` for what each direction writes.
 */

const UnsubscribeSchema = z.object({
  // A customer record's own token, or a sealed one carrying the address of
  // someone with no record (`lib/customers/unsubscribe-token.ts`) — up to
  // ~380 characters for the longest address SMTP allows.
  token: z.string().min(16).max(512),
  /** True re-joins the list from the confirmation page. */
  subscribe: z.boolean().optional(),
});

export const POST = withApi(
  { auth: "optional" },
  async ({ request }) => {
    await rateLimitByIP(request, "moderate");

    const { token, subscribe } = await validateBody(request, UnsubscribeSchema);
    const result = await applyUnsubscribeLink({ token, subscribe });
    // A token that matches nothing is answered the same way a valid one is:
    // this endpoint does not confirm whether an address is on the list.
    if (!result) return notFoundResponse("Subscription");

    // A ladder of recovery emails already scheduled for this address stops
    // here too, rather than being refused one at a time by the suppression
    // check and left looking due in the admin's list.
    if (!subscribe && result.email) {
      const { stopRecoveryLadderForEmail } = await import(
        "@/lib/orders/abandoned-checkouts"
      );
      await stopRecoveryLadderForEmail(result.email).catch((err) =>
        console.error("Failed to stop the recovery ladder:", err),
      );
    }

    return successResponse({ state: result.state });
  },
);
