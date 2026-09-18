import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getSettingsLean } from "@/models/settings.model";
import { appBaseUrl } from "@/lib/app-url";
import { resolveTwilioCredentials } from "@/lib/settings/credentials";
import { isValidTwilioSignature } from "@/lib/sms/twilio";
import { TWILIO_WEBHOOK_PATH, applySmsDeliveryReceipt } from "@/lib/sms/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio delivery receipts (the `StatusCallback` sent with every text).
 *
 * Authenticated by `X-Twilio-Signature`, an HMAC of the URL Twilio called and
 * the posted fields, keyed with the account's Auth Token. The URL has to be
 * the public one Twilio was given, not `request.url` — behind a reverse proxy
 * that is `http://localhost:3000/…` — so both spellings are accepted.
 *
 * Always answers 200 once the signature holds, even for a receipt that matches
 * no message: Twilio does not retry receipts, and a non-2xx only lands as an
 * error in the merchant's Twilio debugger.
 */
export async function POST(request: NextRequest) {
  const body = new URLSearchParams(await request.text());

  await connectDB();
  const settings = await getSettingsLean();
  const { accountSid, authToken } = resolveTwilioCredentials(settings.sms);
  if (!authToken) {
    return NextResponse.json({ received: false }, { status: 401 });
  }

  const search = request.nextUrl.search;
  const signed = isValidTwilioSignature({
    authToken,
    signature: request.headers.get("x-twilio-signature"),
    urls: [`${appBaseUrl()}${TWILIO_WEBHOOK_PATH}${search}`, request.url],
    body,
  });
  if (!signed || (accountSid && body.get("AccountSid") !== accountSid)) {
    return NextResponse.json({ received: false }, { status: 401 });
  }

  const messageSid = body.get("MessageSid");
  const messageStatus = body.get("MessageStatus");
  if (!messageSid || !messageStatus) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const updated = await applySmsDeliveryReceipt({
    messageSid,
    messageStatus,
    errorCode: body.get("ErrorCode") || undefined,
  });
  return NextResponse.json({ received: true, updated });
}
