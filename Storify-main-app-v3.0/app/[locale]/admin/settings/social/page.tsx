"use client";

import { SocialSettingsTab } from "@/components/admin/settings/sections/social-settings-tab";
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
        <SocialSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("social")}
          updateNestedField={updateNestedField}
          onSave={() => saveSection("social", loadedSettings.social || {})}
        />
      )}
    </SectionLoader>
  );
}
