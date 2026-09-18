import { NextRequest, NextResponse } from "next/server";
import { resolveRazorpayCallbackRedirect } from "@/lib/payments/razorpay-callback";

/**
 * Razorpay Checkout's `callback_url`: the payer's browser arrives here from
 * Razorpay after paying, or after the payment failed.
 *
 * It verifies nothing and writes nothing. The request is a cross-site form POST
 * that carries none of the store's SameSite=Lax cookies, so it only hands the
 * payer back to the page they started from, where the ordinary verify route
 * runs with their session. The webhook settles the payment on its own if the
 * payer never gets that far. See lib/payments/razorpay-callback.ts.
 */
async function readFields(request: NextRequest): Promise<URLSearchParams> {
  if (request.method !== "POST") return request.nextUrl.searchParams;
  const fields = new URLSearchParams();
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

async function redirectPayer(request: NextRequest) {
  const location = resolveRazorpayCallbackRedirect({
    query: request.nextUrl.searchParams,
    fields: await readFields(request),
  });
  // Relative on purpose: behind a reverse proxy `request.nextUrl.origin` is the
  // internal host, and the browser resolves this against the public origin it
  // actually posted to. 303 turns the POST into a GET.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

export const POST = redirectPayer;

/** Razorpay posts; a GET (a reload, a proxy that rewrote the method) must not dead-end. */
export const GET = redirectPayer;
