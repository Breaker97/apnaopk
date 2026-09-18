import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings } from "@/models";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { normalizePhoneNumber } from "@/lib/sms/phone";
import {
  buildNotificationSmsBody,
  isSmsDeliveryConfigured,
  sendSms,
} from "@/lib/sms/sms";

const TestSmsSchema = z.object({ to: z.string().trim().min(1).max(40) });

/**
 * POST /api/admin/settings/test-sms
 *
 * Sends one real text through the SAVED configuration — the credentials never
 * come back to the browser, so unsaved edits cannot be tested, and the form
 * asks for a save first. The message goes through the outbox like any other,
 * so it also shows up in the delivery log with Twilio's verdict.
 */
export const POST = withApi(
  {
    auth: "admin",
    // Reaches Twilio and is billed, so it is refused on a demo and throttled
    // like the other test actions.
    demo: "block-mutations",
    rateLimit: { action: "admin:settings:test-sms", preset: "strict" },
  },
  async ({ request }) => {
    const { to } = await validateBody(request, TestSmsSchema);
    const settings = await getSettings();

    if (!isSmsDeliveryConfigured(settings)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "SMS is not set up yet. Switch it on, save the Twilio credentials and a sender, then try again.",
        },
        { status: 400 },
      );
    }

    const phone = normalizePhoneNumber(to, {
      defaultCountry:
        settings.sms?.defaultCountry || settings.shipping?.origin?.country,
    });
    if (!phone) {
      return NextResponse.json(
        {
          success: false,
          message:
            "That is not a valid phone number. Include the country code, e.g. +8801712345678, or set a default country.",
        },
        { status: 400 },
      );
    }

    const result = await sendSms({
      to: phone,
      body: buildNotificationSmsBody({
        storeName: settings.general?.storeName?.trim() || DEFAULT_STORE_NAME,
        message: "This is a test message. Your SMS notifications are working.",
      }),
      category: "sms-test",
      settings,
    });

    if (result.status !== "sent") {
      return NextResponse.json(
        {
          success: false,
          message:
            result.error ||
            "Twilio did not accept the message. Check the SMS delivery log for details.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: `Test SMS sent to ${phone}.`,
    });
  },
);
