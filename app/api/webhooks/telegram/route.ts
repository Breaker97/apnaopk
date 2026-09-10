import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import {
  processTelegramUpdate,
  resolveTelegramConnection,
} from "@/lib/conversations/providers/telegram-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram Bot API webhook.
 *
 * Unlike Meta there is no request signature at all, so the secret token handed
 * to `setWebhook` is the only proof an update is genuine — and because an
 * update names the chat but never the receiving bot, that same secret is also
 * what identifies the connection. Both jobs are done by looking the connection
 * up by the hash of this header; a miss means the caller is not Telegram.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

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
    const connection = await resolveTelegramConnection(
      request.headers.get("x-telegram-bot-api-secret-token"),
    );
    if (!connection) {
      return NextResponse.json(
        { success: false, message: "Invalid webhook secret" },
        { status: 401 },
      );
    }
    const result = await processTelegramUpdate({
      connection,
      payload,
      rawBody,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    // A non-2xx makes Telegram redeliver, which is what we want for a
    // transient fault; the receipt guard keeps the retry idempotent.
    console.error("Telegram messaging webhook failed:", error);
    return NextResponse.json(
      { success: false, message: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
