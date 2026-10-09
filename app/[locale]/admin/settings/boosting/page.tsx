"use client";

import { BoostingSettingsTab } from "@/components/admin/settings/sections/boosting-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import { useBoostingOverview } from "@/components/admin/settings/use-boosting-overview";

export default function Page() {
  const {
    settings,
    isSaving,
    dirtySections,
    updateFieldInSection,
    saveSection,
    savedSettings,
    discardEdits,
  } = useAdminSettingsContext();
  // Boosting is a multi-vendor feature: without vendors the page is a note.
  const overview = useBoostingOverview(Boolean(settings?.multiVendorMode?.enabled));

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <BoostingSettingsTab
          settings={loadedSettings}
          savedEnabled={
            savedSettings?.boosting?.enabled ?? loadedSettings.boosting?.enabled ?? false
          }
          overview={overview}
          isSaving={isSaving}
          isDirty={dirtySections.has("boosting")}
          updateField={(path, value) =>
            updateFieldInSection("boosting", path, value)
          }
          onSave={() => saveSection("boosting", loadedSettings.boosting)}
          onDiscard={discardEdits}
        />
      )}
    </SectionLoader>
  );
}
