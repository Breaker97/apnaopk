import { createHash, timingSafeEqual } from "node:crypto";

/** What `.env.example` ships: a store that copied it as-is has no secret. */
const PLACEHOLDER_SECRET = "replace-with-a-long-random-secret";

/** Shorter than this, a secret can be guessed over HTTP. */
const MIN_SECRET_LENGTH = 16;

let warnedAbout: string | null = null;

/**
 * Whether a request carries the scheduler's `CRON_SECRET`, as
 * `Authorization: Bearer <secret>`.
 *
 * Every cron route compared it with `!==` itself — a comparison that returns
 * sooner the earlier the first wrong character — and accepted the placeholder
 * `.env.example` ships, which anyone with a copy of the code can read. The
 * comparison is now constant-time, and a missing, short or placeholder secret
 * refuses every call, with one log line saying why.
 */
export function isCronRequestAuthorized(
  request: Request,
  secret: string | undefined = process.env.CRON_SECRET,
): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH || secret === PLACEHOLDER_SECRET) {
    const reason = !secret
      ? "CRON_SECRET is not set"
      : secret === PLACEHOLDER_SECRET
        ? "CRON_SECRET is still the placeholder from .env.example"
        : `CRON_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`;
    if (warnedAbout !== reason) {
      warnedAbout = reason;
      console.error(`[cron] ${reason}; scheduled jobs are refused until it is set to a long random value.`);
    }
    return false;
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(
    digest(request.headers.get("authorization") ?? ""),
    digest(`Bearer ${secret}`),
  );
}
