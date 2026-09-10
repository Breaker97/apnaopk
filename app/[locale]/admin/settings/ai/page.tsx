"use client";

import { AiSettingsTab } from "@/components/admin/settings/sections/ai-settings-tab";
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
        <AiSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("aiAuthoring")}
          updateNestedField={updateNestedField}
          onSave={() =>
            saveSection("aiAuthoring", loadedSettings.aiAuthoring || {})
          }
        />
      )}
    </SectionLoader>
  );
}
