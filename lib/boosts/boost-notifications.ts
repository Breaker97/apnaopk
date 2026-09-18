/**
 * Vendor-facing boost campaign notifications (activated / expiring soon /
 * ended): in-app + push via createNotification (deduped per campaign+type),
 * email through the shared vendor email shell. Fire-and-forget by contract —
 * a notification failure must never fail the payment webhook or the cron
 * that triggered it.
 */

import { Vendor } from "@/models";
import { User } from "@/models";
import type { IBoostCampaign } from "@/models/boostCampaign.model";
import { NotificationType } from "@/models/notification.model";
import { getSettings } from "@/models/settings.model";
import { createNotification } from "@/lib/notifications/notifications";
import { buildEmailShell } from "@/lib/email/vendor-emails";
import { sendEmail, isEmailDeliveryConfigured } from "@/lib/email/email";

export type BoostNotificationEvent =
  | "activated"
  | "booked"
  | "starts_tomorrow"
  | "expiring_soon"
  | "ended"
  | "not_delivered"
  | "days_released";

/**
 * Per-event payload. `days_released` and `not_delivered` are about specific
 * days, so they carry them — and the dedupe key below includes the day, or a
 * vendor is told once that their boost did not run and then never again for a
 * booking they are still being charged for daily.
 */
export type BoostNotificationContext = {
  days?: string[];
  day?: string;
  amount?: number;
};

const EVENT_TYPE: Record<BoostNotificationEvent, NotificationType> = {
  activated: NotificationType.BOOST_ACTIVATED,
  booked: NotificationType.BOOST_BOOKED,
  starts_tomorrow: NotificationType.BOOST_STARTS_TOMORROW,
  expiring_soon: NotificationType.BOOST_EXPIRING_SOON,
  ended: NotificationType.BOOST_ENDED,
  not_delivered: NotificationType.BOOST_NOT_DELIVERED,
  days_released: NotificationType.BOOST_DAYS_RELEASED,
};

/** UTC, and a range rather than a single date — the booking is days, not an instant. */
function formatRange(startDay: string, endDay: string) {
  return startDay === endDay ? startDay : `${startDay} – ${endDay}`;
}

function copyFor(
  event: BoostNotificationEvent,
  productName: string,
  campaign: Pick<IBoostCampaign, "startDay" | "endDay" | "positionSnapshot">,
  context?: BoostNotificationContext,
) {
  const position = campaign.positionSnapshot?.position;
  const range = formatRange(campaign.startDay, campaign.endDay);

  switch (event) {
    case "booked":
      return {
        title: "Your boost is booked",
        message: `Position ${position} is booked for "${productName}" from ${range} (UTC).`,
      };
    case "starts_tomorrow":
      return {
        title: "Your boost starts tomorrow",
        message: `Position ${position} for "${productName}" starts tomorrow and runs to ${campaign.endDay} (UTC).`,
      };
    case "activated":
      return {
        title: "Your boost is live",
        message: `"${productName}" now holds position ${position} until ${campaign.endDay} (UTC).`,
      };
    case "expiring_soon":
      return {
        title: "Boost ends in 24 hours",
        message: `Position ${position} for "${productName}" ends soon. Book it again to keep the placement.`,
      };
    case "not_delivered":
      return {
        title: "A booked day did not run",
        message: `Position ${position} did not run on ${context?.day} — "${productName}" was not available to shoppers. That day is credited.`,
      };
    case "days_released":
      return {
        title: "Booked days were released",
        message: `${context?.days?.length ?? 0} day(s) of your position ${position} booking for "${productName}" were released and credited.`,
      };
    default:
      return {
        title: "Boost ended",
        message: `Position ${position} for "${productName}" has ended. Book it again to bring back the extra visibility.`,
      };
  }
}

export async function sendBoostNotification(
  event: BoostNotificationEvent,
  campaign: IBoostCampaign,
  productName: string,
  context?: BoostNotificationContext,
): Promise<void> {
  try {
    const copy = copyFor(event, productName || "your product", campaign, context);
    await createNotification({
      userId: campaign.userId,
      type: EVENT_TYPE[event],
      title: copy.title,
      message: copy.message,
      link: "/vendor/boosts",
      data: {
        campaignId: String(campaign._id),
        boostEvent: event,
        ...(context?.day ? { day: context.day } : {}),
      },
      dedupe: {
        "data.campaignId": String(campaign._id),
        type: EVENT_TYPE[event],
        // Day-scoped for the per-day events. Without it the campaign-wide key
        // means a vendor hears once about a day that did not run and never
        // again, for a booking still being charged daily.
        ...(context?.day ? { "data.day": context.day } : {}),
      },
    });

    const settings = await getSettings();
    if (!isEmailDeliveryConfigured(settings)) return;
    const [vendor] = await Promise.all([
      Vendor.findById(campaign.vendorId)
        .select("userId storeName")
        .lean<{ userId?: string; storeName?: string } | null>(),
    ]);
    const ownerId = vendor?.userId || campaign.userId;
    const user = await User.findById(ownerId)
      .select("email name")
      .lean<{ email?: string; name?: string } | null>();
    if (!user?.email) return;

    await sendEmail({
      to: user.email,
      subject: copy.title,
      html: buildEmailShell({
        title: copy.title,
        intro: `Hi ${user.name || vendor?.storeName || "there"},`,
        body: `<p style="margin:0 0 12px;">${copy.message}</p>`,
        settings,
        cta: {
          label: "View your boosts",
          href: `${(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")}/en/vendor/boosts`,
        },
      }),
      settings,
    });
  } catch (error) {
    console.error(`Failed to send boost ${event} notification:`, error);
  }
}
