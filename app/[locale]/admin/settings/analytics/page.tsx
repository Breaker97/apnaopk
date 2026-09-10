"use client";

import { AnalyticsSettingsTab } from "@/components/admin/settings/sections/analytics-settings-tab";
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
        <AnalyticsSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("analytics")}
          updateNestedField={updateNestedField}
          onSave={() => saveSection("analytics", loadedSettings.analytics || {})}
        />
      )}
    </SectionLoader>
  );
}
