"use client";

import { VendorConfigSettingsTab } from "@/components/admin/settings/sections/vendor-config-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

/**
 * Vendor Configuration screen. Lives under Admin → Vendors (not Settings)
 * because the whole vendor feature set is gated on multi-vendor mode; it reuses
 * the settings data layer via AdminSettingsProvider, which the route wraps it in
 * (and with it the prompt before leaving unsaved edits behind).
 */
export function VendorConfigurationScreen() {
  const { isSaving, dirtySections, updateFieldInSection, saveSections } =
    useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => {
        const configDirty = dirtySections.has("vendorConfig");
        const commissionDirty = dirtySections.has("orders");
        return (
          <VendorConfigSettingsTab
            settings={loadedSettings}
            disabled={!loadedSettings.multiVendorMode.enabled}
            isSaving={isSaving}
            isDirty={configDirty}
            commissionDirty={commissionDirty}
            updateField={(path, value) =>
              updateFieldInSection("vendorConfig", path, value)
            }
            updateCommissionField={(path, value) =>
              updateFieldInSection("orders", path, value)
            }
            onSave={() => {
              // One atomic PUT for both sections, so a failure cannot leave
              // one of them saved and the other not.
              const payload: Record<string, unknown> = {};
              if (configDirty) payload.vendorConfig = loadedSettings.vendorConfig;
              if (commissionDirty) payload.orders = loadedSettings.orders;
              return saveSections(payload);
            }}
          />
        );
      }}
    </SectionLoader>
  );
}
