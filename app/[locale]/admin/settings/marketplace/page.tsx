"use client";

import { MarketplaceSettingsTab } from "@/components/admin/settings/sections/marketplace-settings-tab";
import { VendorPermissionsSettingsTab } from "@/components/admin/settings/sections/vendor-permissions-settings-tab";
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
        <div className="space-y-6">
          <MarketplaceSettingsTab
            settings={loadedSettings}
            updateField={(path, value) =>
              updateFieldInSection("multiVendorMode", path, value)
            }
          />
          <VendorPermissionsSettingsTab
            settings={loadedSettings}
            isSaving={isSaving}
            isDirty={dirtySections.has("multiVendorMode")}
            disabled={!loadedSettings.multiVendorMode.enabled}
            updateField={(path, value) =>
              updateFieldInSection("multiVendorMode", path, value)
            }
            onSave={() =>
              saveSection("multiVendorMode", loadedSettings.multiVendorMode)
            }
          />
        </div>
      )}
    </SectionLoader>
  );
}
