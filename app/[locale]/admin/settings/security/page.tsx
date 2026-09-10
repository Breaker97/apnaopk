"use client";

import { SecuritySettingsTab } from "@/components/admin/settings/sections/security-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
// The same defaults the schema stamps and the tab clamps to — hard-coding them
// here is how this screen ends up saving a number nothing else agrees with.
import {
  DEFAULT_LOCKOUT_MINUTES,
  DEFAULT_MAX_LOGIN_ATTEMPTS,
  DEFAULT_SESSION_MAX_AGE_DAYS,
} from "@/lib/security-limits";
import { MIN_ALLOWED_PASSWORD_LENGTH } from "@/lib/auth/password-policy";

export default function Page() {
  const {
    isSaving,
    dirtySections,
    updateFieldInSection,
    saveSection,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <SecuritySettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("security")}
          updateField={(path, value) =>
            updateFieldInSection("security", path, value)
          }
          onSave={() =>
            saveSection("security", {
              sessionMaxAgeDays:
                loadedSettings.security?.sessionMaxAgeDays ??
                DEFAULT_SESSION_MAX_AGE_DAYS,
              maxLoginAttempts:
                loadedSettings.security?.maxLoginAttempts ??
                DEFAULT_MAX_LOGIN_ATTEMPTS,
              lockoutDurationMinutes:
                loadedSettings.security?.lockoutDurationMinutes ??
                DEFAULT_LOCKOUT_MINUTES,
              minPasswordLength:
                loadedSettings.security?.minPasswordLength ??
                MIN_ALLOWED_PASSWORD_LENGTH,
              requireUppercase: loadedSettings.security?.requireUppercase ?? false,
              requireNumbers: loadedSettings.security?.requireNumbers ?? false,
              requireSpecialChars:
                loadedSettings.security?.requireSpecialChars ?? false,
            })
          }
        />
      )}
    </SectionLoader>
  );
}
