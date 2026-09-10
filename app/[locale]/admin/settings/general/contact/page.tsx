"use client";

import { useParams } from "next/navigation";
import { useMultiVendorMode } from "@/providers/app-settings-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
            title="Contact"
            description="How customers and admins reach your store"
            isSaving={isSaving}
            isDirty={dirtySections.has("general")}
            onSave={async () => {
              const ok = await saveSection("general", g);
              if (ok) await refreshSettings();
            }}
          >
            <div className="rounded-xl bg-card p-5 ring-1 ring-border/70 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="storeEmail">Email</Label>
                <Input
                  id="storeEmail"
                  type="email"
                  value={g.storeEmail || ""}
                  onChange={(e) =>
                    updateNestedField("general.storeEmail", e.target.value)
                  }
                  placeholder="store@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="storePhone">Phone</Label>
                <Input
                  id="storePhone"
                  value={g.storePhone || ""}
                  onChange={(e) =>
                    updateNestedField("general.storePhone", e.target.value)
                  }
                  placeholder="+1 555 000 1234"
                />
              </div>
            </div>
          </SubPageShell>
        );
      }}
    </SectionLoader>
  );
}
