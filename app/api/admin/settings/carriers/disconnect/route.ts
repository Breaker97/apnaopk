import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { getSettings } from "@/models/settings.model";
import { auditSettingsChange, createAuditContext } from "@/lib/audit";
import {
  CARRIER_PROVIDERS,
  CARRIER_PROVIDER_LABELS,
} from "@/lib/shipping/carrier-config";
import { revalidateSettingsContent } from "@/lib/cache-invalidation";
import { clearShiprocketTokenCache } from "@/lib/shipping/carriers/shiprocket-client";

const DisconnectSchema = z.object({
  provider: z.enum(CARRIER_PROVIDERS),
});

/**
 * Credential paths cleared per provider. Listed explicitly rather than derived
 * from a prefix so disabling a carrier can never take an unrelated setting
 * with it.
 */
const CREDENTIAL_PATHS: Record<string, string[]> = {
  shippo: [
    "shipping.carriers.shippo.testToken",
    "shipping.carriers.shippo.liveToken",
    "shipping.carriers.shippo.webhookSecret",
    "shipping.carriers.shippo.webhookSecretHash",
    "shipping.carriers.shippo.webhookRegisteredAt",
  ],
  shiprocket: [
    "shipping.carriers.shiprocket.email",
    "shipping.carriers.shiprocket.password",
    "shipping.carriers.shiprocket.webhookToken",
    "shipping.carriers.shiprocket.tokenCache.token",
    "shipping.carriers.shiprocket.tokenCache.expiresAt",
  ],
};

/**
 * POST /api/admin/settings/carriers/disconnect
 *
 * The settings save path drops blank credential values so an untouched form
 * cannot wipe a stored secret — which also means there is otherwise no way to
 * remove one at all. Tolerable for a payment gateway; not for a carrier, where
 * a forgotten *live* token silently buys real labels. This is the eraser.
 */
export const POST = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:settings:carrier-disconnect", preset: "strict" },
  },
  async ({ request, session }) => {
    const { provider } = await validateBody(request, DisconnectSchema);

    const settings = await getSettings();
    for (const path of CREDENTIAL_PATHS[provider] || []) {
      settings.set(path, undefined);
    }
    settings.set(`shipping.carriers.${provider}.enabled`, false);
    settings.updatedBy = session.user.id;
    await settings.save();

    if (provider === "shiprocket") {
      // Clearing the persisted token above is only half of it: a warm process
      // holds its own copy keyed by account email, and reconnecting under the
      // same email would otherwise keep presenting the token belonging to the
      // account that was just disconnected.
      clearShiprocketTokenCache();
    }

    await auditSettingsChange(
      createAuditContext(request, session),
      "shipping",
      { [`carriers.${provider}`]: "connected" },
      { [`carriers.${provider}`]: "disconnected" },
    ).catch(console.error);

    revalidateSettingsContent();

    return successResponse(
      { provider },
      `${CARRIER_PROVIDER_LABELS[provider]} disconnected`,
    );
  },
);
