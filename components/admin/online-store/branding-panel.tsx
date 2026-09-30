"use client";

import { ImageIcon, Loader2, Save, SunMoon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandAssetFields } from "@/components/admin/settings/general/brand-asset-fields";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { useBrandingSave } from "@/components/admin/settings/branding-save";
import type { Settings } from "@/components/admin/settings/types";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { normalizeThemeMode } from "@/config/branding.config";
import type { Theme } from "@/providers/theme-provider";
import { DiagramFrame, OptionCardGroup } from "./option-card-group";

/**
 * Online Store → Themes → Branding: the store's assets and its default
 * appearance. Both are GLOBAL — they survive every theme switch and feed the
 * storefront, the dashboard, checkout and emails alike.
 *
 * The brand's COLORS moved to Theme settings → Colors, beside the theme
 * roles that reference them, which is where a merchant is actually choosing
 * colors; they are still global and still stored under `appearance.*`, and
 * the editor saves them through this same `useBrandingSave`.
 *
 * Storage is unchanged from the old Settings → Appearance screen (assets
 * under `general.*`, the appearance default under `appearance.*`);
 * `useBrandingSave` writes whichever of the two sections was touched.
 */
export function BrandingPanel({ tSafe }: { tSafe: TSafe }) {
  return (
    <SectionLoader>
      {(settings) => <BrandingForm settings={settings} tSafe={tSafe} />}
    </SectionLoader>
  );
}

function BrandingForm({
  settings,
  tSafe,
}: {
  settings: Settings;
  tSafe: TSafe;
}) {
  const { updateNestedField } = useAdminSettingsContext();
  const { isDirty, isSaving, save } = useBrandingSave();

  // Optional chaining + fallbacks throughout: legacy documents (set up on an
  // older schema) may be missing sub-objects or fields entirely.
  const appearance = settings?.appearance;
  const general = settings?.general;

  // Light/dark only. "Follow the OS" is intentionally not offered: the store
  // renders light by default regardless of the visitor's
  // `prefers-color-scheme`. This is what shoppers see until they pick their
  // own, so it leaves the admin's own light/dark (Preferences) alone.
  const handleModeChange = (next: Theme) => {
    updateNestedField("appearance.theme", next);
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-[var(--dashboard-header-height,4rem)] z-10 -mx-1 flex flex-wrap items-start justify-between gap-3 bg-background px-1 py-2">
        <p className="min-w-0 max-w-3xl text-sm text-muted-foreground">
          {tSafe(
            "admin.branding.globalHint",
            "Your brand is global — it survives switching themes and is used by the storefront, the dashboard, checkout and emails.",
          )}
        </p>
        <Button
          type="button"
          onClick={() => void save(settings)}
          disabled={!isDirty || isSaving}
          className="shrink-0 gap-1.5"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {tSafe("admin.branding.save", "Save branding")}
        </Button>
      </div>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ImageIcon className="h-4 w-4 text-primary" />
            {tSafe("admin.branding.assetsTitle", "Brand assets")}
          </CardTitle>
          <CardDescription>
            {tSafe(
              "admin.branding.assetsSubtitle",
              "Logos, favicon and app icon used across your storefront and dashboard.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandAssetFields
            general={general}
            updateNestedField={updateNestedField}
          />
        </CardContent>
      </Card>

      {/* Brand COLORS moved to Theme settings → Colors, beside the roles
          that reference them; they are still global and still stored under
          `appearance.*`. What stays here is the brand's assets and the
          default appearance. */}
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <SunMoon className="h-4 w-4 text-primary" />
            {tSafe("admin.branding.appearanceTitle", "Default appearance")}
          </CardTitle>
          <CardDescription>
            {tSafe(
              "admin.branding.appearanceSubtitle",
              "How the store opens before a visitor picks light or dark themselves.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OptionCardGroup
            label={tSafe("admin.branding.appearanceMode", "Mode")}
            value={normalizeThemeMode(appearance?.theme)}
            onChange={(value) => handleModeChange(value as Theme)}
            columns="grid-cols-2 sm:grid-cols-4 lg:grid-cols-6"
            options={[
              {
                key: "light",
                label: tSafe("admin.settings.appearance.themes.light", "Light"),
                diagram: <ModeDiagram mode="light" />,
              },
              {
                key: "dark",
                label: tSafe("admin.settings.appearance.themes.dark", "Dark"),
                diagram: <ModeDiagram mode="dark" />,
              },
            ]}
          />
        </CardContent>
      </Card>

    </div>
  );
}

/** A page in light or dark ink — the storefront's two appearances. */
function ModeDiagram({ mode }: { mode: "light" | "dark" }) {
  const dark = mode === "dark";
  return (
    <DiagramFrame className={dark ? "bg-zinc-900 border-zinc-700" : undefined}>
      <div className="flex flex-1 flex-col gap-1 px-2 pb-2">
        <div
          className={
            dark ? "h-5 rounded-sm bg-zinc-700" : "h-5 rounded-sm bg-foreground/15"
          }
        />
        <div className="grid grid-cols-3 gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={
                dark
                  ? "h-4 rounded-sm bg-zinc-800 ring-1 ring-zinc-700"
                  : "h-4 rounded-sm bg-background ring-1 ring-border"
              }
            />
          ))}
        </div>
      </div>
    </DiagramFrame>
  );
}
