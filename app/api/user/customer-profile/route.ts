import { connectDB } from "@/lib/db";
import { CustomerProfile, getSettingsLean } from "@/models";
import { ensureCustomerProfile } from "@/lib/customers/customer";
import { successResponse } from "@/lib/api/response";
import { UpdateCustomerProfileSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";
import { normalizeNotificationSettings } from "@/lib/notifications/notification-settings";
import { isSmsDeliveryConfigured } from "@/lib/sms/sms";

/**
 * GET /api/user/customer-profile
 * Get the current customer's profile (auto-creates if missing)
 */
export const GET = withApi(
  { auth: "user" },
  async ({ session }) => {
    const [profile, settings] = await Promise.all([
      ensureCustomerProfile(session.user.id),
      getSettingsLean(),
    ]);
    const customerChannels = normalizeNotificationSettings(
      settings.notifications,
    ).customer;

    return successResponse({
      profile,
      // Whether the store texts customers at all. The Preferences page only
      // offers the SMS switch then — a switch for texts nobody sends would be
      // the kind of setting that saves and does nothing.
      smsUpdatesAvailable:
        isSmsDeliveryConfigured(settings) &&
        (customerChannels.orderUpdates.sms || customerChannels.returnUpdates.sms),
    });
  },
);

/**
 * PUT /api/user/customer-profile
 * Update customer preferences and marketing settings
 */
export const PUT = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const body = await request.json();
    const parsed = UpdateCustomerProfileSchema.parse(body);

    await connectDB();

    // Ensure profile exists first
    await ensureCustomerProfile(session.user.id);

    const updateFields: Record<string, unknown> = {};

    if (parsed.preferredPaymentMethod !== undefined)
      updateFields.preferredPaymentMethod = parsed.preferredPaymentMethod;
    if (parsed.preferredCurrency !== undefined)
      updateFields.preferredCurrency = parsed.preferredCurrency;
    if (parsed.preferredLanguage !== undefined)
      updateFields.preferredLanguage = parsed.preferredLanguage;
    if (parsed.preferredCategories !== undefined)
      updateFields.preferredCategories = parsed.preferredCategories;
    if (parsed.sizePreferences !== undefined)
      updateFields.sizePreferences = parsed.sizePreferences;
    if (parsed.marketingOptIn !== undefined)
      updateFields.marketingOptIn = parsed.marketingOptIn;
    if (parsed.emailNotifications !== undefined) {
      // Merge with existing notification preferences
      const existing = await CustomerProfile.findOne(
        { userId: session.user.id },
        { emailNotifications: 1 },
      ).lean();

      updateFields.emailNotifications = {
        ...existing?.emailNotifications,
        ...parsed.emailNotifications,
      };
    }
    if (parsed.smsNotifications?.orderUpdates !== undefined) {
      updateFields["smsNotifications.orderUpdates"] =
        parsed.smsNotifications.orderUpdates;
    }

    if (Object.keys(updateFields).length === 0) {
      return successResponse({ message: "No fields to update" });
    }

    updateFields.lastActiveAt = new Date();

    await CustomerProfile.updateOne(
      { userId: session.user.id },
      { $set: updateFields },
    );

    return successResponse({ message: "Profile updated successfully" });
  },
);
