import { mongoose } from "@/lib/db";
import { ObjectId } from "mongodb";
import { successResponse } from "@/lib/api/response";
import { ensureCustomerProfile } from "@/lib/customers/customer";
import { Notification } from "@/models";
import { withApi } from "@/lib/api/handler";

type AccountStatsUser = {
  addresses?: unknown[];
};

export const GET = withApi(
  { auth: "user" },
  async ({ session }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const [profile, user, notificationsCount] = await Promise.all([
      ensureCustomerProfile(session.user.id),
      db.collection("user").findOne(
        { _id: new ObjectId(session.user.id) },
        { projection: { addresses: 1 } },
      ),
      Notification.countDocuments({
        userId: session.user.id,
        isRead: false,
        isArchived: { $ne: true },
      }),
    ]);

    const accountUser = user as AccountStatsUser | null;
    const addressesCount = Array.isArray(accountUser?.addresses)
      ? accountUser.addresses.length
      : 0;

    return successResponse(
      {
        stats: {
          ordersCount: profile?.stats?.totalOrders ?? 0,
          wishlistCount: profile?.stats?.totalWishlistItems ?? 0,
          addressesCount,
          notificationsCount,
          loyaltyTier: profile?.loyaltyTier ?? "bronze",
          loyaltyPoints: profile?.loyaltyPoints ?? 0,
        },
      },
      "Account stats loaded",
    );
  },
);

