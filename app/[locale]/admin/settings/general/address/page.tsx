"use client";

import { useParams } from "next/navigation";
import { useMultiVendorMode } from "@/providers/app-settings-provider";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import { SubPageShell } from "@/components/admin/settings/drill/sub-page-shell";

export default function Page() {
  const { locale } = useParams<{ locale: string }>();
  const { refreshSettings } = useMultiVendorMode();
  const {
    isSaving,
    dirtySections,
    updateNestedField,
    saveSection,
  } = useAdminSettingsContext();

  return (
    <SectionLoader>
      {(loadedSettings) => {
        const g = loadedSettings.general;
        return (
          <SubPageShell
            backHref={`/${locale}/admin/settings/general`}
            title="Store address"
            description="Used for invoices, taxes, and shipping origin"
            isSaving={isSaving}
            isDirty={dirtySections.has("general")}
            onSave={async () => {
              const ok = await saveSection("general", g);
              if (ok) await refreshSettings();
            }}
          >
            <div className="rounded-xl bg-card p-5 ring-1 ring-border/70">
              <div className="space-y-2">
                <Label htmlFor="storeAddress">Address</Label>
                <Textarea
                  id="storeAddress"
                  rows={4}
                  value={g.storeAddress || ""}
                  onChange={(e) =>
                    updateNestedField("general.storeAddress", e.target.value)
                  }
                  placeholder="Street, City, State, Country"
                />
              </div>
            </div>
          </SubPageShell>
        );
      }}
    </SectionLoader>
  );
}
