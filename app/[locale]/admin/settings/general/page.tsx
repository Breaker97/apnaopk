"use client";

import { SectionLoader } from "@/components/admin/settings/section-loader";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { GeneralSettingsTab } from "@/components/admin/settings/sections/general-settings-tab";

export default function Page() {
  const { dirtySections, isSaving, saveSection, updateNestedField } =
    useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <GeneralSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("general")}
          updateNestedField={updateNestedField}
          onSave={() => saveSection("general", loadedSettings.general)}
        />
      )}
    </SectionLoader>
  );
}
