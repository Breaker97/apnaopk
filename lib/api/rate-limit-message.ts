import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import { describeWait, type Translate } from "@/lib/auth/auth-error-message";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale-prefix";

type CookieSource = {
  cookies: { get(name: string): { value: string } | undefined };
};

/**
 * What a refused request says: "Too many requests. Wait 9 minutes, then try
 * again.", in the language of the page that sent it.
 *
 * Every screen that prints a failed request's `message` — checkout, the
 * coupon field, order tracking, reviews, the contact form, the dashboards'
 * toasts — used to print "Please try again in 523 seconds." in English on
 * every store. Unlike Better Auth's refusals (lib/auth/auth-error-message.ts),
 * these come from our own routes, and the page keeps the locale cookie on its
 * own language (LocaleCookieSync), so the answer can be worded here once for
 * every screen. `code` and `retryAfter` still carry the facts for anything
 * that words it itself. English when the cookie names no language we have.
 */
export async function rateLimitMessage(
  request: CookieSource,
  retryAfterSeconds: number,
): Promise<string> {
  const requested = request.cookies.get(LOCALE_COOKIE_NAME)?.value ?? "";
  const locale = isValidLocale(requested) ? requested : defaultLocale;
  const seconds = Math.max(0, Math.ceil(retryAfterSeconds));
  try {
    // Loaded on the refusal alone: it brings every language's messages, which
    // the routes that merely count requests have no other use for.
    const { getTranslations } = await import("next-intl/server");
    const t = (await getTranslations({ locale })) as unknown as Translate;
    return seconds > 0
      ? t("errors.tooManyRequestsIn", { duration: describeWait(seconds, t) })
      : t("errors.tooManyRequests");
  } catch {
    // No catalogue to word it from: the same sentence, in English.
    if (seconds === 0) return "Too many requests. Wait a moment, then try again.";
    const wait =
      seconds < 60 ? count(seconds, "second") : count(Math.ceil(seconds / 60), "minute");
    return `Too many requests. Wait ${wait}, then try again.`;
  }
}

function count(amount: number, unit: string): string {
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}
