"use client";

import { useParams } from "next/navigation";
import { useMultiVendorMode } from "@/providers/app-settings-provider";
import { Input } from "@/components/ui/input";
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
            title="Store information"
            description="The name and domain customers see"
            isSaving={isSaving}
            isDirty={dirtySections.has("general")}
            onSave={async () => {
              const ok = await saveSection("general", g);
              if (ok) await refreshSettings();
            }}
          >
            <div className="rounded-xl bg-card p-5 ring-1 ring-border/70 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="storeName">Store name</Label>
                <Input
                  id="storeName"
                  value={g.storeName || ""}
                  onChange={(e) =>
                    updateNestedField("general.storeName", e.target.value)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="storeDomain">Store domain</Label>
                <Input
                  id="storeDomain"
                  value={g.storeDomain || ""}
                  onChange={(e) =>
                    updateNestedField("general.storeDomain", e.target.value)
                  }
                  placeholder="https://example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="storeDescription">Description</Label>
                <Textarea
                  id="storeDescription"
                  rows={3}
                  value={g.storeDescription || ""}
                  onChange={(e) =>
                    updateNestedField(
                      "general.storeDescription",
                      e.target.value,
                    )
                  }
                />
              </div>
            </div>
          </SubPageShell>
        );
      }}
    </SectionLoader>
  );
}
