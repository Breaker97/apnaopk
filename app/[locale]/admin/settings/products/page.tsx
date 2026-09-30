"use client";

import { ProductsSettingsTab } from "@/components/admin/settings/sections/products-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";

export default function Page() {
  const { isSaving, dirtySections, updateFieldInSection, saveSections } =
    useAdminSettingsContext();

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
          // Only the keys this page owns: `catalog` also holds the product
          // card studio's out-of-stock policy, and `preorder` the vendor rules
          // edited under Multi-Vendor Management.
          onSave={() =>
            saveSections({
              catalog: {
                physicalProducts:
                  loadedSettings.catalog?.physicalProducts !== false,
                digitalProducts:
                  loadedSettings.catalog?.digitalProducts !== false,
                priceOnRequest: loadedSettings.catalog?.priceOnRequest !== false,
              },
              preorder: { enabled: loadedSettings.preorder?.enabled !== false },
            })
          }
        />
      )}
    </SectionLoader>
  );
}
