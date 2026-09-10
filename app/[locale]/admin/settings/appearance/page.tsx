"use client";

import { AppearanceSettingsTab } from "@/components/admin/settings/sections/appearance-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { normalizeAppearanceForSave } from "@/components/admin/settings/branding-save";
import { SectionLoader } from "@/components/admin/settings/section-loader";

// Settings → Dashboard. Only the admin-facing `appearance.*` toggles are
// edited here now; brand assets and colors moved to Online Store → Themes →
// Branding (see `components/admin/online-store/branding-panel.tsx`). The
// section is still saved whole — `normalizeAppearanceForSave` keeps the
// untouched brand colors canonical on the way through.
export default function Page() {
  const { isSaving, dirtySections, updateNestedField, saveSection } =
    useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <AppearanceSettingsTab
          settings={loadedSettings}
          isSaving={isSaving}
          isDirty={dirtySections.has("appearance")}
          updateNestedField={updateNestedField}
          onSave={() =>
            saveSection(
              "appearance",
              normalizeAppearanceForSave(loadedSettings.appearance),
            )
          }
        />
      )}
    </SectionLoader>
  );
}
