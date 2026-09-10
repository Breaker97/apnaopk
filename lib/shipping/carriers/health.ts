import "server-only";

import { Settings } from "@/models/settings.model";
import type { CarrierProvider } from "@/lib/shipping/carrier-config";

/**
 * Whether a carrier's stored credentials are still being accepted.
 *
 * `CarrierFailure.authFailure` was computed by both adapters and then read by
 * nobody: a revoked Shippo token or a changed Shiprocket password made every
 * queued job dead-letter on its first attempt — correctly, since retrying a
 * rejected credential never helps, and completely silently. The carrier went on
 * reading as connected on the settings screen while orders piled up unshipped,
 * and the only symptom was in a job row nobody looks at.
 *
 * This is the flag `errors.ts` already promised: *"The stored credential is
 * dead; the carrier should be flagged."* Flagged, deliberately, and not
 * disabled — an intermittent 401 must not switch off a store's shipping, and
 * the merchant is the one who decides what to do about it.
 */

/**
 * Written straight to the collection rather than through the hydrated settings
 * document, for the same reason `persistShiprocketToken` is: this fires from
 * inside a carrier call that may be running in a cron worker, and a full
 * `settings.save()` would race whatever else is editing settings.
 */
export async function flagCarrierAuthFailure(
  provider: CarrierProvider,
  message?: string,
): Promise<void> {
  await Settings.updateOne(
    {},
    {
      $set: {
        [`shipping.carriers.${provider}.authFailure`]: {
          at: new Date(),
          message: message?.slice(0, 500),
        },
      },
    },
  ).catch(() => undefined);
}

/**
 * Clear the flag once the carrier accepts us again.
 *
 * Guarded on the flag existing so the overwhelmingly common case — a healthy
 * carrier completing a job — matches nothing and writes nothing, rather than
 * touching the settings document on every parcel.
 *
 * Best-effort throughout: a stale flag is a wrong banner, and failing a
 * successful shipment over one would be the worse trade by a wide margin.
 */
export async function clearCarrierAuthFailure(
  provider: CarrierProvider,
): Promise<void> {
  await Settings.updateOne(
    { [`shipping.carriers.${provider}.authFailure`]: { $exists: true } },
    { $unset: { [`shipping.carriers.${provider}.authFailure`]: "" } },
  ).catch(() => undefined);
}
