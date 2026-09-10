"use client";

import { useParams } from "next/navigation";
import { useMultiVendorMode } from "@/providers/app-settings-provider";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import { SubPageShell } from "@/components/admin/settings/drill/sub-page-shell";
import { LANGUAGE_OPTIONS } from "@/components/admin/settings/general/constants";

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
        const supported = Array.from(
          new Set([
            ...(g.supportedLanguages?.length
              ? g.supportedLanguages
              : ["en"]),
            g.defaultLanguage || "en",
          ]),
        );
        return (
          <SubPageShell
            backHref={`/${locale}/admin/settings/general`}
            title="Default language"
            description="Used for new content and customers without a preference"
            isSaving={isSaving}
            isDirty={dirtySections.has("general")}
            onSave={async () => {
              const ok = await saveSection("general", g);
              if (ok) await refreshSettings();
            }}
          >
            <div className="rounded-xl bg-card p-5 ring-1 ring-border/70">
              <div className="space-y-2">
                <Label htmlFor="defaultLanguage">Language</Label>
                <SearchableSelect
                  id="defaultLanguage"
                  value={g.defaultLanguage || "en"}
                  onValueChange={(v) =>
                    updateNestedField("general.defaultLanguage", v)
                  }
                  options={supported.map((code) => ({
                    value: code,
                    label:
                      LANGUAGE_OPTIONS.find((x) => x.code === code)?.name ||
                      code,
                  }))}
                  searchPlaceholder="Search language..."
                />
                <p className="text-xs text-muted-foreground">
                  Manage the full list under Markets → Supported languages.
                </p>
              </div>
            </div>
          </SubPageShell>
        );
      }}
    </SectionLoader>
  );
}
