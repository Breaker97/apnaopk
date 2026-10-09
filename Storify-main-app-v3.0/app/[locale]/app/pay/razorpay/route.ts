import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { locales, type Locale } from "@/config/i18n.config";
import { getMobileRuntimeSettings } from "@/lib/api-next/ports";
import { loadRedirectRecord } from "@/lib/api-core/shop/checkout/redirect-payment";
import { readAppPaymentReference } from "@/lib/checkout/app-payment-reference";
import { appPaymentReturnUrl } from "@/lib/checkout/app-payment-return";
import { connectDB } from "@/lib/db";
import { escapeHtml } from "@/lib/email/escape-html";
import { toRazorpayAmountSubunits } from "@/lib/payments/razorpay";
import { resolveRazorpayCredentials } from "@/lib/settings/credentials";
import { isValidAppScheme } from "@/lib/settings/mobile-app";
import { getSettingsLean } from "@/models/settings.model";

/**
 * Razorpay, for the shopper app. Razorpay has no hosted payment page — its
 * Checkout runs inside the store's own page — so the app's in-app browser
 * opens this one (`RedirectPayment.url`) for a payment POST
 * /checkout/redirect started. It opens Razorpay Checkout in redirect mode,
 * the website's own rules (`openRazorpayCheckout`,
 * components/checkout/checkout-helpers.tsx): `callback_url` is the app's
 * return bridge, which Razorpay posts the payment to, and closing the window
 * goes to the bridge as a payer who gave up.
 *
 * The signed reference is the only key (the browser has no session): the
 * page shows the store's public key, the Razorpay order and the amount, and
 * nothing of the shopper. A payment that is already settled goes straight
 * back to the app, which verifies it. Not found while the mobile API is off.
 * A plain document, like the human check (app/[locale]/app/captcha): never
 * cached, never indexed.
 */
export const dynamic = "force-dynamic";

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
  const { shop } = runtime.mobileApp;
  if (!shop.enabled || !runtime.routing.enabled.includes(locale as Locale) || !isValidAppScheme(shop.scheme)) {
    return notFound();
  }

  const reference = readAppPaymentReference(new URL(request.url).searchParams.get("reference") ?? "");
  if (!reference || reference.method !== "razorpay") return notFound();
  await connectDB();
  const record = await loadRedirectRecord(reference);
  const razorpayOrderId = record?.gateway.razorpayOrderId;
  if (!record || !razorpayOrderId) return notFound();

  const [settings, t, returnUrl, cancelUrl] = await Promise.all([
    getSettingsLean(),
    getTranslations({ locale, namespace: "checkout.payment" }),
    appPaymentReturnUrl(locale, "razorpay", "return"),
    appPaymentReturnUrl(locale, "razorpay", "cancel"),
  ]);
  const keyId = resolveRazorpayCredentials(settings.payment?.razorpay).keyId;
  // Paid meanwhile, or Razorpay switched off since: nothing to open here. The
  // app's verify says which.
  if (record.paid || !settings.payment?.razorpay?.enabled || !keyId) {
    return NextResponse.redirect(returnUrl, { status: 303, headers: { "Cache-Control": "no-store" } });
  }

  const storeName = settings.general?.storeName || "Store";
  const checkout = {
    key: keyId,
    amount: toRazorpayAmountSubunits(record.amountDue, record.currency),
    currency: record.currency,
    name: storeName,
    ...(record.order?.number ? { description: `Order ${record.order.number}` } : {}),
    order_id: razorpayOrderId,
    callback_url: returnUrl,
    redirect: true,
  };

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
  main { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; text-align: center; }
  p { margin: 0; font-size: 15px; line-height: 1.5; max-width: 22rem; }
</style>
</head>
<body>
<main><p>${escapeHtml(t("razorpayRedirect"))}</p></main>
<script>
(function () {
  var options = ${scriptValue(checkout)};
  var cancelUrl = ${scriptValue(cancelUrl)};
  function giveUp() { window.location.replace(cancelUrl); }
  var script = document.createElement("script");
  script.src = "https://checkout.razorpay.com/v1/checkout.js";
  script.async = true;
  script.onerror = giveUp;
  script.onload = function () {
    if (!window.Razorpay) return giveUp();
    options.modal = { ondismiss: giveUp };
    new window.Razorpay(options).open();
  };
  document.head.appendChild(script);
})();
</script>
</body>
</html>`;

  return new Response(html, { status: 200, headers: HEADERS });
}
