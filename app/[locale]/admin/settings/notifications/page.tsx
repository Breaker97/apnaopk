"use client";

import { NotificationsSettingsTab } from "@/components/admin/settings/sections/notifications-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

export default function Page() {
  const { isSaving, dirtySections, updateNestedField, saveSection } =
    useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <NotificationsSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("notifications")}
          updateNestedField={updateNestedField}
          onSave={() =>
            saveSection("notifications", loadedSettings.notifications)
          }
        />
      )}
    </SectionLoader>
  );
}
