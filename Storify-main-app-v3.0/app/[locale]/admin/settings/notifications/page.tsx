"use client";

import { NotificationsSettingsTab } from "@/components/admin/settings/sections/notifications-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import { useStaffNotificationAudience } from "@/components/admin/settings/use-staff-notification-audience";

export default function Page() {
  const {
    savedSettings,
    isSaving,
    dirtySections,
    updateNestedField,
    saveSection,
    discardEdits,
  } = useAdminSettingsContext();
  // For the Staff tab's "nobody on the team can see …" lines.
  const staffAudience = useStaffNotificationAudience();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <NotificationsSettingsTab
          settings={loadedSettings}
          savedSettings={savedSettings ?? loadedSettings}
          staffAudience={staffAudience}
          isSaving={isSaving}
          isDirty={dirtySections.has("notifications")}
          updateNestedField={updateNestedField}
          onSave={() =>
            saveSection("notifications", loadedSettings.notifications)
          }
          onDiscard={discardEdits}
        />
      )}
    </SectionLoader>
  );
}
