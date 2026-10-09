"use client";

import { TwoFactorSettingsTab } from "@/components/admin/settings/sections/two-factor-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

export default function Page() {
  const {
    isSaving,
    dirtySections,
    updateFieldInSection,
    saveSection,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <TwoFactorSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("twoFactor")}
          updateField={(path, value) =>
            updateFieldInSection("twoFactor", path, value)
          }
          onSave={() =>
            saveSection("twoFactor", {
              twoFactorEnabled: loadedSettings.security?.twoFactorEnabled ?? false,
              twoFactorRequiredForAdmin:
                loadedSettings.security?.twoFactorRequiredForAdmin ?? false,
              twoFactorRequiredForVendors:
                loadedSettings.security?.twoFactorRequiredForVendors ?? false,
              twoFactorRequiredForStaff:
                loadedSettings.security?.twoFactorRequiredForStaff ?? false,
            })
          }
        />
      )}
    </SectionLoader>
  );
}
