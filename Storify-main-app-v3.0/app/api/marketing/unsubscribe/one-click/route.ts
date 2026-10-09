import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { applyUnsubscribeLink } from "@/lib/customers/marketing-consent";
import { stopRecoveryLadderForEmail } from "@/lib/orders/abandoned-checkouts";

/**
 * The unsubscribe button inside Gmail, Outlook and Apple Mail.
 *
 * RFC 8058: the mailbox provider POSTs to the address in `List-Unsubscribe`
 * without ever showing the shopper a page, which is why this cannot be the
 * confirmation page the footer link opens — that is a Next page route and
 * answers a POST with 405, so the provider would report the unsubscribe as
 * having failed and, in time, mark the sender as one that ignores them.
 *
 * The token is in the query string because a one-click POST carries a fixed
 * body (`List-Unsubscribe=One-Click`) and nothing of ours. It is the only
 * credential accepted, exactly as on the page route: no email address is
 * taken, so nobody can unsubscribe anybody else.
 *
 * Always 200, even for a token that matches nothing. A provider treats any
 * other answer as a broken unsubscribe, and a bad token is not the shopper's
 * problem to see.
 */
export const POST = withApi({ auth: "optional" }, async ({ request }) => {
  // Lenient, unlike the page behind the footer link: these arrive from a
  // mailbox provider's own servers, so one address covers every shopper who
  // presses Gmail's unsubscribe button. A tighter bucket refuses real
  // unsubscribes — the provider reports a failure while the shopper believes
  // they are off the list, which is the one outcome this endpoint must not
  // produce. What actually guards it is the signed token: nothing here can be
  // done without one, and a wrong one changes nothing.
  await rateLimitByIP(request, "lenient");

  const token = new URL(request.url).searchParams.get("token") || "";
  // Either kind of token: a customer record's own, or the sealed one carrying
  // the address of a shopper with no record — see `applyUnsubscribeLink`.
  const result = await applyUnsubscribeLink({ token });
  // And stop whatever recovery ladder is mid-flight for this address, so the
  // next sweep does not send a rung that was queued before they asked.
  if (result?.email) await stopRecoveryLadderForEmail(result.email);

  return NextResponse.json({ success: true });
});
