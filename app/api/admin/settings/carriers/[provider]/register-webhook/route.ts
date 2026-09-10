import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
import { CARRIER_PROVIDERS, type CarrierProvider } from "@/lib/shipping/carrier-config";
import { revalidateSettingsContent } from "@/lib/cache-invalidation";
import {
  createCarrierWebhookSecret,
  hashCarrierWebhookSecret,
} from "@/lib/shipping/carriers/webhook-secret";

function isCarrierProvider(value: string): value is CarrierProvider {
  return (CARRIER_PROVIDERS as readonly string[]).includes(value);
}

/**
 * POST /api/admin/settings/carriers/[provider]/register-webhook
 *
 * Mints the shared secret a carrier's tracking callbacks must carry and hands
 * back the URL to paste into the carrier's own dashboard.
 *
 * Shippo documents no HMAC signature on its webhooks, so the secret lives in
 * the URL path and is compared as a hash. That alone is not proof of origin,
 * which is why the receiver also re-fetches the authoritative object from
 * Shippo before believing anything — a leaked URL then buys a forger nothing
 * but the ability to make us poll our own account.
 */
export const POST = withApi<{ provider: string }>(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:settings:carrier-webhook", preset: "strict" },
  },
  async ({ params, request, session }) => {
    if (!isCarrierProvider(params.provider)) {
      throw new ValidationError(`Unknown carrier: ${params.provider}`);
    }
    if (params.provider !== "shippo") {
      // Shiprocket's webhook is authenticated by a token the merchant types
      // into both systems, so there is nothing for us to mint.
      throw new ValidationError(
        "Shiprocket webhooks are configured with the webhook token in Settings → Shipping",
      );
    }

    const secret = createCarrierWebhookSecret();
    const settings = await getSettings();
    settings.set("shipping.carriers.shippo.webhookSecret", secret);
    settings.set(
      "shipping.carriers.shippo.webhookSecretHash",
      hashCarrierWebhookSecret(secret),
    );
    settings.set("shipping.carriers.shippo.webhookRegisteredAt", new Date());
    settings.updatedBy = session.user.id;
    await settings.save();

    revalidateSettingsContent();

    const origin =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      new URL(request.url).origin;

    return successResponse(
      { url: `${origin}/api/webhooks/carriers/shippo/${secret}` },
      "Webhook URL generated — paste it into the Shippo dashboard",
    );
  },
);
