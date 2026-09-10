import { NextResponse } from "next/server";
import { Settings, getSettings } from "@/models/settings.model";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { resolvePesapalCredentials } from "@/lib/settings/credentials";
import {
  getPesapalCredentials,
  registerPesapalIpn,
} from "@/lib/payments/pesapal";
import { revalidateSettingsContent } from "@/lib/cache-invalidation";

export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:settings:pesapal-register-ipn", preset: "strict" },
    demo: "block-mutations",
  },
  async () => {
    const settings = await getSettings();
    const resolved = resolvePesapalCredentials(settings.payment?.pesapal);
    const creds = getPesapalCredentials(resolved);
    const configuredUrl =
      process.env.NEXT_PUBLIC_APP_URL || settings.general?.storeDomain;
    if (!configuredUrl) {
      throw new ValidationError(
        "Set NEXT_PUBLIC_APP_URL to your public HTTPS domain before registering Pesapal IPN.",
      );
    }

    const normalizedUrl = /^https?:\/\//i.test(configuredUrl)
      ? configuredUrl
      : `https://${configuredUrl}`;
    const appUrl = new URL(normalizedUrl);
    if (
      appUrl.hostname === "localhost" ||
      appUrl.hostname === "127.0.0.1" ||
      appUrl.protocol !== "https:"
    ) {
      throw new ValidationError(
        "Pesapal IPN requires a public HTTPS NEXT_PUBLIC_APP_URL.",
      );
    }

    const ipnUrl = new URL("/api/payments/pesapal/ipn", appUrl).toString();
    const registration = await registerPesapalIpn({
      creds,
      url: ipnUrl,
      notificationType: "POST",
    });
    if (!registration.ipn_id) {
      throw new Error("Pesapal did not return an IPN ID");
    }

    await Settings.updateOne(
      { _id: settings._id },
      { $set: { "payment.pesapal.ipnId": registration.ipn_id } },
    );
    revalidateSettingsContent();

    return NextResponse.json({
      success: true,
      message: "Pesapal IPN registered",
      data: {
        ipnId: registration.ipn_id,
        url: ipnUrl,
      },
    });
  },
);
