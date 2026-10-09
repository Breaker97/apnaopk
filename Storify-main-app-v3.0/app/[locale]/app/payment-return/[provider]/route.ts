import { NextResponse, type NextRequest } from "next/server";
import { locales, type Locale } from "@/config/i18n.config";
import { getMobileRuntimeSettings } from "@/lib/api-next/ports";
import {
  appPaymentReturnLocation,
  isAppPaymentReturnProvider,
} from "@/lib/checkout/app-payment-return";
import { isValidAppScheme } from "@/lib/settings/mobile-app";

/**
 * The return bridge for the shopper app's gateway payments: a gateway sends
 * the in-app browser here when the payer is done (or gives up), and this
 * answers a 303 to the app link `{scheme}://checkout/return/{provider}`,
 * carrying only the values the app's verify needs. See
 * lib/checkout/app-payment-return.ts.
 *
 * Stateless: it reads no session, verifies nothing, writes nothing. GET for
 * the gateways that redirect, POST for Razorpay, which posts its fields.
 * Not found while the mobile API is off, for a language the store does not
 * serve, or while the store has no valid app scheme. Never cached.
 */
export const dynamic = "force-dynamic";

const HEADERS = {
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

async function readFields(request: NextRequest): Promise<URLSearchParams> {
  const fields = new URLSearchParams();
  if (request.method !== "POST") return fields;
  try {
    const form = await request.formData();
    for (const [key, value] of form) {
      if (typeof value === "string") fields.append(key, value);
    }
  } catch {
    // An unreadable body is treated like a payment that did not go through.
  }
  return fields;
}

async function bridge(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string; provider: string }> },
): Promise<Response> {
  const { locale, provider } = await params;
  if (!locales.includes(locale as Locale) || !isAppPaymentReturnProvider(provider)) {
    return notFound();
  }

  const runtime = await getMobileRuntimeSettings();
  const { shop } = runtime.mobileApp;
  if (!shop.enabled || !runtime.routing.enabled.includes(locale as Locale) || !isValidAppScheme(shop.scheme)) {
    return notFound();
  }

  const location = appPaymentReturnLocation({
    scheme: shop.scheme,
    provider,
    query: request.nextUrl.searchParams,
    fields: await readFields(request),
  });
  // 303 turns Razorpay's POST into a GET on the app link.
  return new NextResponse(null, { status: 303, headers: { ...HEADERS, Location: location } });
}

export const GET = bridge;
export const POST = bridge;
