"use client";

import { MobileAppSettingsTab } from "@/components/admin/settings/sections/mobile-app-settings-tab";
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
        <MobileAppSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("mobileApp")}
          updateNestedField={updateNestedField}
          onSave={() => saveSection("mobileApp", loadedSettings.mobileApp || {})}
        />
      )}
    </SectionLoader>
  );
}
