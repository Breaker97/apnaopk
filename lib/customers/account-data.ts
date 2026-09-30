import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { Notification } from "@/models";
import { ensureCustomerProfile } from "@/lib/customers/customer";

/**
 * Reads the account layout and the page inside it both make.
 *
 * Next renders a page in parallel with its layout, so on a full load of
 * /account the session, the customer profile and the unread count were each
 * looked up twice. `cache()` memoises them per request, so a revoked session
 * or a new notification still shows on the next navigation. It also keeps a
 * first visit from racing two `ensureCustomerProfile` calls into creating the
 * profile twice.
 */
export const getAccountSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

export const getAccountProfile = cache((userId: string) =>
  ensureCustomerProfile(userId),
);

export const countUnreadNotifications = cache(async (userId: string) => {
  await connectDB();
  return Notification.countDocuments({
    userId,
    isRead: false,
    isArchived: { $ne: true },
  });
});
