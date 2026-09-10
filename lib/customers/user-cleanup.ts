import {
  AdminProfile,
  Cart,
  Conversation,
  ConversationContact,
  ConversationMessage,
  ConversationParticipant,
  CustomerProfile,
  Notification,
  PushSubscription,
  Review,
  StaffProfile,
  Wishlist,
} from "@/models";
import { recomputeProductRating } from "@/lib/catalog/reviews";

const DELETED_CONTACT_NAME = "Deleted user";

/**
 * Remove documents owned by a hard-deleted user.
 *
 * Without this, deleting a user strands a CustomerProfile with a unique
 * userId (blocking any future profile for a reused id), plus carts,
 * wishlists, notifications, push subscriptions, and reviews that reference a
 * user who no longer exists. Orders are intentionally kept — they are
 * financial history.
 *
 * The user's reviews are deleted and each affected product's rating cache is
 * recomputed so storefront aggregates don't keep counting ghost reviews.
 *
 * Conversations follow the same rule as orders: the thread is a vendor's
 * support history and is kept, but every personal identifier on it is scrubbed
 * and the dangling user references are dropped. Per-user read state is deleted
 * outright, and freeing `ConversationContact.userId` matters for the same
 * reason as CustomerProfile — it carries a unique index that would otherwise
 * block a reused id.
 *
 * Best-effort: each cleanup runs independently and failures are logged, so a
 * partial failure never blocks the account deletion itself.
 */
export async function cleanupDeletedUserReferences(
  userId: string,
): Promise<void> {
  let reviewedProductIds: string[] = [];
  try {
    reviewedProductIds = (
      await Review.find({ userId }).select("productId").lean()
    ).map((review) => String(review.productId));
  } catch (err) {
    console.error(`Failed to list reviews for deleted user ${userId}:`, err);
  }

  const results = await Promise.allSettled([
    CustomerProfile.deleteOne({ userId }),
    AdminProfile.deleteOne({ userId }),
    StaffProfile.deleteOne({ userId }),
    Cart.deleteMany({ userId }),
    Wishlist.deleteMany({ userId }),
    Notification.deleteMany({ userId }),
    PushSubscription.deleteMany({ userId }),
    Review.deleteMany({ userId }),
    ConversationParticipant.deleteMany({ userId }),
    ConversationContact.updateMany(
      { userId },
      {
        $set: { name: DELETED_CONTACT_NAME },
        $unset: { userId: "", email: "", phone: "", image: "" },
      },
    ),
    Conversation.updateMany(
      { customerUserId: userId },
      {
        $set: { "contact.name": DELETED_CONTACT_NAME },
        $unset: {
          customerUserId: "",
          "contact.email": "",
          "contact.phone": "",
          "contact.image": "",
        },
      },
    ),
    ConversationMessage.updateMany(
      { senderUserId: userId },
      {
        $set: { senderName: DELETED_CONTACT_NAME },
        $unset: { senderUserId: "" },
      },
    ),
    Conversation.updateMany(
      { assignedToUserId: userId },
      { $unset: { assignedToUserId: "" } },
    ),
  ]);

  const labels = [
    "customer profile",
    "admin profile",
    "staff profile",
    "carts",
    "wishlists",
    "notifications",
    "push subscriptions",
    "reviews",
    "conversation participants",
    "conversation contacts",
    "conversation contact snapshots",
    "conversation message senders",
    "conversation assignments",
  ];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `Failed to clean up ${labels[index]} for deleted user ${userId}:`,
        result.reason,
      );
    }
  });

  for (const productId of Array.from(new Set(reviewedProductIds))) {
    await recomputeProductRating(productId).catch((err) =>
      console.error(
        `Failed to recompute rating for product ${productId} after user delete:`,
        err,
      ),
    );
  }
}
