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
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <OrdersSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("orders")}
          updateNestedField={updateNestedField}
          onSave={() => saveSection("orders", loadedSettings.orders)}
        />
      )}
    </SectionLoader>
  );
}
