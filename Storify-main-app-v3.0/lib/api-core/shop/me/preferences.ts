import {
  PREFERENCE_REASONS,
  Preferences,
  UpdatePreferencesRequest,
} from "@/contracts/mobile/shop/v1/preferences";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import {
  NOTIFICATION_PREFERENCES,
  NotificationPreferenceError,
  readNotificationPreferences,
  setNotificationPreferences,
  type NotificationPreferenceState,
  type PreferenceGroupKey,
} from "@/lib/customers/notification-preferences";
import { getPreferenceCopy, type PreferenceCopy } from "@/lib/customers/preference-copy";

/**
 * GET and PATCH /me/preferences: the shopper's notification switches, the
 * website's Account → Preferences and the app's push topics, read and written
 * through the same store (lib/customers/notification-preferences.ts).
 */

const GROUP_ORDER: readonly PreferenceGroupKey[] = ["EMAIL", "SMS", "MARKETING", "PUSH"];

function toPreferences(state: NotificationPreferenceState, copy: PreferenceCopy): Preferences {
  return {
    groups: GROUP_ORDER.filter((group) => group !== "SMS" || state.smsAvailable).map((group) => ({
      key: group,
      title: copy.group(group),
      items: NOTIFICATION_PREFERENCES.filter((preference) => preference.group === group).map((preference) => ({
        key: preference.key,
        title: copy.title(preference.key),
        description: copy.description(preference.key),
        enabled: state.values[preference.key],
      })),
    })),
  };
}

async function readPreferences(userId: string, locale: string): Promise<Preferences> {
  const [state, copy] = await Promise.all([readNotificationPreferences(userId), getPreferenceCopy(locale)]);
  return toPreferences(state, copy);
}

export const preferencesRoute = defineRoute({
  id: "me.preferences",
  method: "GET",
  path: "/me/preferences",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  output: Preferences,
  handler: ({ session, locale }) => readPreferences(session.user.id, locale),
});

export const updatePreferencesRoute = defineRoute({
  id: "me.preferences.update",
  method: "PATCH",
  path: "/me/preferences",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "account:preferences", preset: "moderate" },
  demo: "block-mutations",
  reasons: { values: PREFERENCE_REASONS },
  input: UpdatePreferencesRequest,
  output: Preferences,
  handler: async ({ input, session, locale }) => {
    try {
      await setNotificationPreferences(session.user.id, input.preferences);
    } catch (error) {
      if (!(error instanceof NotificationPreferenceError)) throw error;
      throw new MobileApiError(400, "VALIDATION_ERROR", error.message, {
        reason: error.reason,
        errors: { preferences: [error.message] },
      });
    }
    return readPreferences(session.user.id, locale);
  },
});
