"use client";

import { ShippingSettingsTab } from "@/components/admin/settings/sections/shipping-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

export default function Page() {
  const {
    isSaving,
    dirtySections,
    updateNestedField,
    saveSection,
    isCarrierBusy,
    testCarrierConnection,
    registerCarrierWebhook,
    disconnectCarrier,
    fetchShiprocketPickupLocations,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <ShippingSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("shipping")}
          isCarrierBusy={isCarrierBusy}
          updateField={updateNestedField}
          onSave={() => saveSection("shipping", loadedSettings.shipping)}
          onTestCarrier={testCarrierConnection}
          onRegisterCarrierWebhook={registerCarrierWebhook}
          onDisconnectCarrier={disconnectCarrier}
          onLoadPickupLocations={fetchShiprocketPickupLocations}
        />
      )}
    </SectionLoader>
  );
}
