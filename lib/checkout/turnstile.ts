/**
 * The human check the checkout asks for once a card has been refused too often.
 *
 * Cloudflare Turnstile: free, and for almost every shopper invisible — it
 * watches the browser rather than asking anyone to read wobbly letters. The
 * store's own keys go in Settings › Payments; a store that has not set them
 * gets no check at all, which is the whole reason the velocity pause exists
 * beside it rather than behind it.
 *
 * **Not configured is not the same as failed.** A shop that never entered a
 * key must still be able to sell: the checkout falls back to the pause alone,
 * and says so in the log rather than turning every shopper away.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileConfig = {
  enabled?: boolean;
  siteKey?: string;
  secretKey?: string;
};

type TurnstileSettings = {
  payment?: unknown;
} | null;

/** The store's Turnstile configuration, or null when it has none. */
function resolveTurnstile(settings: TurnstileSettings): TurnstileConfig | null {
  const payment = settings?.payment as
    | { turnstile?: TurnstileConfig }
    | null
    | undefined;
  const turnstile = payment?.turnstile;
  if (!turnstile?.enabled) return null;
  if (!turnstile.siteKey || !turnstile.secretKey) return null;
  return turnstile;
}

type TurnstileOutcome =
  /** Cloudflare says a human did this. */
  | { ok: true }
  /** The token was missing, stale, or Cloudflare said no. */
  | { ok: false; reason: string }
  /** No keys, or Cloudflare could not be reached — see the note above. */
  | { ok: true; skipped: true; reason: string };

/**
 * Ask Cloudflare whether the token the browser sent is a real one.
 *
 * A token is good once and for a few minutes, so a replayed one fails here —
 * which is what stops a script solving one challenge and reusing it for a
 * thousand cards.
 */
export async function verifyTurnstileToken(params: {
  settings: TurnstileSettings;
  token?: string | null;
  clientIp?: string | null;
}): Promise<TurnstileOutcome> {
  const config = resolveTurnstile(params.settings);
  if (!config) {
    return { ok: true, skipped: true, reason: "turnstile_not_configured" };
  }
  if (!params.token) return { ok: false, reason: "missing_token" };

  const body = new URLSearchParams({
    secret: String(config.secretKey),
    response: String(params.token),
    ...(params.clientIp ? { remoteip: params.clientIp } : {}),
  });

  let answer: { success?: boolean; "error-codes"?: string[] };
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    answer = (await res.json()) as typeof answer;
  } catch (error) {
    // Cloudflare unreachable. Refusing every payment because a third party is
    // down would cost the store far more than the attack does; the velocity
    // pause still applies, and this is logged so an outage is visible.
    console.error("Turnstile could not be reached:", error);
    return { ok: true, skipped: true, reason: "turnstile_unreachable" };
  }

  if (answer.success) return { ok: true };
  return {
    ok: false,
    reason: (answer["error-codes"] || []).join(",") || "turnstile_failed",
  };
}
