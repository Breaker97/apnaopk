import { connectDB } from "@/lib/db";
import { CustomerProfile, getSettingsLean } from "@/models";
import { ensureCustomerProfile } from "@/lib/customers/customer";
import { successResponse } from "@/lib/api/response";
import { UpdateCustomerProfileSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";
import { normalizeNotificationSettings } from "@/lib/notifications/notification-settings";
import { isSmsDeliveryConfigured } from "@/lib/sms/sms";
import { setMarketingConsent } from "@/lib/customers/marketing-consent";
import {
  MARKETING_CONSENT_SOURCE,
  MARKETING_CONSENT_STATE,
  MARKETING_OPT_IN_LEVEL,
} from "@/config/app.config";

/**
 * The profile as its shopper may see it. The store's own notes and tags about
 * them are for the store, and the unsubscribe token belongs in an email
 * footer, not in a page's data.
 */
function withoutStoreFields<T extends object>(profile: T | null) {
  if (!profile) return profile;
  const own = { ...profile } as Record<string, unknown>;
  delete own.notes;
  delete own.tags;
  delete own.unsubscribeToken;
  return own;
}

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
      profile: withoutStoreFields(profile),
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
    // Consent is not a plain field: it carries a state, a timestamp and where
    // it came from, and only `setMarketingConsent` may write those. Unticking
    // here IS an unsubscribe — unlike the checkout box, this switch is the
    // shopper saying what they want, on a page about nothing else.
    let consentChanged = false;
    if (parsed.marketingOptIn !== undefined) {
      consentChanged = true;
      await setMarketingConsent({
        state: parsed.marketingOptIn
          ? MARKETING_CONSENT_STATE.SUBSCRIBED
          : MARKETING_CONSENT_STATE.UNSUBSCRIBED,
        optInLevel: parsed.marketingOptIn
          ? MARKETING_OPT_IN_LEVEL.SINGLE
          : undefined,
        source: MARKETING_CONSENT_SOURCE.ACCOUNT,
        userId: session.user.id,
      });
    }
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
      return successResponse({
        message: consentChanged
          ? "Profile updated successfully"
          : "No fields to update",
      });
    }

    updateFields.lastActiveAt = new Date();

    await CustomerProfile.updateOne(
      { userId: session.user.id },
      { $set: updateFields },
    );

    return successResponse({ message: "Profile updated successfully" });
  },
);
