"use client";

import { OrdersSettingsTab } from "@/components/admin/settings/sections/orders-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

export default function Page() {
  const {
    isSaving,
    dirtySections,
    updateNestedField,
    saveSection,
    discardEdits,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <OrdersSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("orders")}
          updateNestedField={updateNestedField}
          onDiscard={discardEdits}
          onSave={() => {
            // The commission is Vendors → Configuration's to edit; this page
            // only shows it, so it is not sent (an unsaved edit made there
            // stays that page's).
            const { commission, ...orders } = loadedSettings.orders;
            return saveSection("orders", orders);
          }}
        />
      )}
    </SectionLoader>
  );
}
