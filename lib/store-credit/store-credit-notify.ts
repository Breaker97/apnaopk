import "server-only";

import { User } from "@/models";
import { getSettings } from "@/models/settings.model";
import { NotificationType } from "@/models/notification.model";
import { createNotification } from "@/lib/notifications/notifications";
import {
  sendStoreCreditIssuedEmail,
  type StoreCreditEmailReason,
} from "@/lib/email/store-credit-emails";
import { appBaseUrl } from "@/lib/app-url";

/**
 * Tell a shopper store credit was added to their account (R8): in the app,
 * and by email with how much and when it expires. Once per lot, however many
 * times it is asked.
 */
export async function notifyStoreCreditIssued(params: {
  customerId: string;
  lotId: string;
  amount: number;
  currency: string;
  expiresAt?: Date | null;
  reason: StoreCreditEmailReason;
  note?: string;
}): Promise<void> {
  const user = await User.findById(params.customerId)
    .select("name email")
    .lean<{ name?: string; email?: string } | null>();
  if (!user) return;
  const amount = new Intl.NumberFormat("en", {
    style: "currency",
    currency: params.currency || "USD",
  }).format(params.amount);
  await createNotification({
    userId: params.customerId,
    type: NotificationType.STORE_CREDIT,
    title: "Store credit added",
    message: `${amount} in store credit was added to your account.`,
    link: "/account/store-credit",
    data: { lotId: params.lotId },
    dedupe: { type: NotificationType.STORE_CREDIT, "data.lotId": params.lotId },
  });
  if (user.email) {
    await sendStoreCreditIssuedEmail(
      {
        to: user.email,
        customerName: user.name,
        amount: params.amount,
        currency: params.currency,
        expiresAt: params.expiresAt,
        reason: params.reason,
        note: params.note,
        accountUrl: `${appBaseUrl()}/account/store-credit`,
      },
      await getSettings(),
      `store-credit:${params.lotId}`,
    );
  }
}
