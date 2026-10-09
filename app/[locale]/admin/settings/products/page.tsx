"use client";

import { ProductsSettingsTab } from "@/components/admin/settings/sections/products-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import {
  pickPreorderRules,
  STORE_PREORDER_KEYS,
} from "@/components/admin/settings/preorder-rule-keys";

export default function Page() {
  const {
    isSaving,
    dirtySections,
    updateFieldInSection,
    saveSections,
    discardEdits,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <ProductsSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("products")}
          updateField={(path, value) =>
            updateFieldInSection("products", path, value)
          }
          onDiscard={discardEdits}
          // Only the keys this page owns: `catalog` also holds the product
          // card studio's out-of-stock policy, and `preorder` the vendor rules
          // edited under Multi-Vendor Mode.
          onSave={() =>
            saveSections({
              catalog: {
                physicalProducts:
                  loadedSettings.catalog?.physicalProducts !== false,
                digitalProducts:
                  loadedSettings.catalog?.digitalProducts !== false,
                priceOnRequest: loadedSettings.catalog?.priceOnRequest !== false,
              },
              preorder: {
                ...pickPreorderRules(loadedSettings.preorder, STORE_PREORDER_KEYS),
                enabled: loadedSettings.preorder?.enabled !== false,
              },
            })
          }
        />
      )}
    </SectionLoader>
  );
}
