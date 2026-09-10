"use client";

import { BoostingSettingsTab } from "@/components/admin/settings/sections/boosting-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

export default function Page() {
  const { isSaving, dirtySections, updateFieldInSection, saveSection } =
    useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <BoostingSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("boosting")}
          updateField={(path, value) =>
            updateFieldInSection("boosting", path, value)
          }
          onSave={() => saveSection("boosting", loadedSettings.boosting)}
        />
      )}
    </SectionLoader>
  );
}
