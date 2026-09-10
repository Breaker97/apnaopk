"use client";

import { SeoSettingsTab } from "@/components/admin/settings/sections/seo-settings-tab";
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
        <SeoSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("seo")}
          updateNestedField={updateNestedField}
          onSave={() => saveSection("seo", loadedSettings.seo || {})}
        />
      )}
    </SectionLoader>
  );
}
