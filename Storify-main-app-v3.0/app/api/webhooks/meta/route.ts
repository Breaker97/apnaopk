import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { verifyMetaWebhookSignature } from "@/lib/conversations/secret-box";
import { processMetaWebhookPayload } from "@/lib/conversations/providers/meta-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (
    expected &&
    mode === "subscribe" &&
    token === expected &&
    challenge
  ) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json(
    { success: false, message: "Webhook verification failed" },
    { status: 403 },
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (
    !verifyMetaWebhookSignature(
      rawBody,
      request.headers.get("x-hub-signature-256") || undefined,
    )
  ) {
    return NextResponse.json(
      { success: false, message: "Invalid webhook signature" },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid webhook payload" },
      { status: 400 },
    );
  }

  try {
    await connectDB();
    const result = await processMetaWebhookPayload(rawBody, payload);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Meta messaging webhook failed:", error);
    return NextResponse.json(
      { success: false, message: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
