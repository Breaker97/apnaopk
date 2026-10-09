"use client";

import { MaintenanceSettingsTab } from "@/components/admin/settings/sections/maintenance-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

export default function Page() {
  const {
    isSaving,
    dirtySections,
    updateNestedField,
    saveSection,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <MaintenanceSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("maintenance")}
          updateNestedField={updateNestedField}
          onSave={() => saveSection("maintenance", loadedSettings.maintenance || {})}
        />
      )}
    </SectionLoader>
  );
}
