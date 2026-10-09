"use client";

import { POSSettingsTab } from "@/components/admin/settings/sections/pos-settings-tab";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import { usePOSLocations } from "@/components/admin/settings/use-pos-locations";
import { useRouter } from "@/hooks/use-locale-navigation";

export default function Page() {
  const router = useRouter();
  const {
    settings,
    isSaving,
    dirtySections,
    updateFieldInSection,
    saveSection,
    discardEdits,
  } = useAdminSettingsContext();
  // Only the default counter needs them, and it shows only while POS is on.
  const locations = usePOSLocations(Boolean(settings?.pos?.enabled));

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <POSSettingsTab
          settings={loadedSettings}
          locations={locations}
          isSaving={isSaving}
          isDirty={dirtySections.has("pos")}
          updateField={(path, value) =>
            updateFieldInSection("pos", path, value)
          }
          onSave={async () => {
            const saved = await saveSection("pos", loadedSettings.pos || {});
            // The save refreshes the sidebar's menu itself. The top bar's POS
            // button is the admin layout's, rendered on the server, so it
            // follows only once the layout is asked again.
            if (saved) router.refresh();
          }}
          onDiscard={discardEdits}
        />
      )}
    </SectionLoader>
  );
}
