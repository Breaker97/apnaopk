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
            title="Time zone"
            description="Used to time-stamp orders, analytics, and reports"
            isSaving={isSaving}
            isDirty={dirtySections.has("general")}
            onSave={async () => {
              const ok = await saveSection("general", g);
              if (ok) await refreshSettings();
            }}
          >
            <div className="rounded-xl bg-card p-5 ring-1 ring-border/70">
              <div className="space-y-2">
                <Label htmlFor="timezone">Time zone</Label>
                <Input
                  id="timezone"
                  value={g.timezone || "UTC"}
                  onChange={(e) =>
                    updateNestedField("general.timezone", e.target.value)
                  }
                  placeholder="UTC, America/New_York, Asia/Dhaka …"
                />
                <p className="text-xs text-muted-foreground">
                  IANA time-zone name (e.g. <code>America/New_York</code>).
                </p>
              </div>
            </div>
          </SubPageShell>
        );
      }}
    </SectionLoader>
  );
}
