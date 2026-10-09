import { getTranslations } from "next-intl/server";
import { locales, type Locale } from "@/config/i18n.config";
import { getMobileRuntimeSettings } from "@/lib/api-next/ports";
import { turnstileSiteKey } from "@/lib/checkout/turnstile";
import { connectDB } from "@/lib/db";
import { escapeHtml } from "@/lib/email/escape-html";
import { getSettingsLean } from "@/models/settings.model";

/**
 * The human check, for the shopper app.
 *
 * A checkout asks for Cloudflare Turnstile once a shopper's cards have been
 * refused too often (lib/checkout/card-testing-guard.ts), and a native app has
 * no Turnstile widget. Without one, a single card tester behind a mobile
 * carrier's shared address would stop card payments for every app user
 * behind it. So the app opens this page in a WebView when its quote says
 * `captcha.required`, the page shows the store's own widget, and hands the
 * token back:
 *
 *   window.ReactNativeWebView.postMessage(
 *     JSON.stringify({ type: "turnstile", token, nonce }))
 *
 * `nonce` is echoed from `?nonce=` so the app can tell its own page's answer
 * from a stale one. The token is good once, for a few minutes; the app sends
 * it as `turnstileToken`. A token that lapses before it is used posts
 * `turnstile-expired`; a widget that cannot load posts `turnstile-error`; a
 * store without Turnstile posts `turnstile-unavailable` (and never asks).
 *
 * A plain document rather than a storefront page: no header, no links to
 * wander off on, nothing loaded but Cloudflare's script. Not found while the
 * mobile API is off. Never cached, never indexed.
 */
export const dynamic = "force-dynamic";

const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** A value for an inline <script>: JSON that cannot close the tag. */
function scriptValue(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) return notFound();

  const runtime = await getMobileRuntimeSettings();
  if (!runtime.mobileApp.shop.enabled || !runtime.routing.enabled.includes(locale as Locale)) {
    return notFound();
  }

  await connectDB();
  const [settings, t] = await Promise.all([
    getSettingsLean(),
    getTranslations({ locale, namespace: "checkout.payment" }),
  ]);
  const siteKey = turnstileSiteKey(settings);
  const nonceParam = new URL(request.url).searchParams.get("nonce") ?? "";
  const nonce = NONCE_PATTERN.test(nonceParam) ? nonceParam : "";
  const label = t("humanCheck");
  const storeName = settings.general?.storeName || "";

  const html = `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(storeName)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; box-sizing: border-box; text-align: center; }
  p { margin: 0; font-size: 15px; line-height: 1.5; max-width: 22rem; }
</style>
${siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=storifyTurnstileReady&render=explicit" async defer></script>' : ""}
</head>
<body>
<main>
  <p>${escapeHtml(label)}</p>
  <div id="check"></div>
</main>
<script>
(function () {
  var nonce = ${scriptValue(nonce)};
  var siteKey = ${scriptValue(siteKey)};
  function send(message) {
    message.nonce = nonce;
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }
  if (!siteKey) {
    send({ type: "turnstile-unavailable" });
    return;
  }
  // Cloudflare unreachable: say so rather than leave the app waiting.
  var unanswered = setTimeout(function () { send({ type: "turnstile-error" }); }, 15000);
  window.storifyTurnstileReady = function () {
    clearTimeout(unanswered);
    window.turnstile.render("#check", {
      sitekey: siteKey,
      theme: "auto",
      callback: function (token) { send({ type: "turnstile", token: token }); },
      "expired-callback": function () { send({ type: "turnstile-expired" }); },
      "error-callback": function () { send({ type: "turnstile-error" }); }
    });
  };
})();
</script>
</body>
</html>`;

  return new Response(html, { status: 200, headers: HEADERS });
}
