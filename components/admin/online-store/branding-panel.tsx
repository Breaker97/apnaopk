"use client";

import { nanoid } from "nanoid";

import { ImageIcon, Loader2, Palette, RefreshCw, Save, SunMoon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AddCurrentPresetCard,
  ColorField,
  ColorSystemPreview,
  CustomPresetCard,
  PresetColorCard,
  SectionContainer,
} from "@/components/admin/appearance-settings-ui";
import { BrandAssetFields } from "@/components/admin/settings/general/brand-asset-fields";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { useBrandingSave } from "@/components/admin/settings/branding-save";
import type { Settings } from "@/components/admin/settings/types";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { normalizeThemeMode } from "@/config/branding.config";
import { presetColors, type PresetColor } from "@/stores/app-settings";
import {
  colorsEqual,
  normalizeColorToHex,
} from "@/lib/site-config/appearance-colors";
import { useTheme, type Theme } from "@/providers/theme-provider";
import { DiagramFrame, OptionCardGroup } from "./option-card-group";

function generatePresetId(): string {
  return `cp_${nanoid()}`;
}

/**
 * Online Store → Themes → Branding: the store's identity, edited in one
 * place. Brand assets, brand colors and the default appearance are GLOBAL —
 * they survive every theme switch and feed the storefront, the dashboard,
 * checkout and emails. What a particular theme does with them (widths,
 * tints, shapes) lives on the Theme settings tab next door.
 *
 * Storage is unchanged from the old Settings → Appearance screen (assets
 * under `general.*`, colors under `appearance.*`); `useBrandingSave` writes
 * whichever of the two sections was touched.
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
  const { setTheme } = useTheme();

  // Optional chaining + fallbacks throughout: legacy documents (set up on an
  // older schema) may be missing sub-objects or fields entirely.
  const appearance = settings?.appearance;
  const general = settings?.general;

  const primaryColor = appearance?.primaryColor ?? "";
  const secondaryColor = appearance?.secondaryColor ?? "";
  const accentColor = appearance?.accentColor ?? "";
  const skeletonColor = appearance?.skeletonColor ?? "";
  const customPresets = appearance?.customPresets ?? [];

  const applyColors = (primary: string, secondary: string, accent: string) => {
    updateNestedField("appearance.primaryColor", primary);
    updateNestedField("appearance.secondaryColor", secondary);
    updateNestedField("appearance.accentColor", accent);
  };

  const applyBuiltInPreset = (key: PresetColor) => {
    const preset = presetColors[key];
    if (!preset) return;
    applyColors(preset.hex, preset.secondaryHex, preset.accentHex);
    updateNestedField("appearance.presetColor", key);
  };

  // Store raw keystrokes so half-typed values aren't fought by the controlled
  // input; the field only *applies* once it parses to a valid color.
  const handleColorChange = (path: string) => (raw: string) => {
    updateNestedField(path, raw);
  };

  // On blur, fold rgb()/rgba() and shorthand hex down to a canonical hex so
  // the stored value is always something the color pipeline understands.
  const handleColorCommit = (path: string) => (raw: string) => {
    const hex = normalizeColorToHex(raw);
    if (hex && hex !== raw) updateNestedField(path, hex);
  };

  const tripleMatches = (primary?: string, secondary?: string, accent?: string) =>
    colorsEqual(primaryColor, primary) &&
    colorsEqual(secondaryColor, secondary) &&
    colorsEqual(accentColor, accent);

  const activeBuiltInKey = (Object.keys(presetColors) as PresetColor[]).find(
    (key) => {
      const preset = presetColors[key];
      return tripleMatches(preset.hex, preset.secondaryHex, preset.accentHex);
    },
  );

  const activeCustomId = customPresets.find((preset) =>
    tripleMatches(
      preset?.primaryColor,
      preset?.secondaryColor,
      preset?.accentColor,
    ),
  )?.id;

  const allColorsValid = Boolean(
    normalizeColorToHex(primaryColor) &&
      normalizeColorToHex(secondaryColor) &&
      normalizeColorToHex(accentColor),
  );
  const isCurrentUnsaved = allColorsValid && !activeBuiltInKey && !activeCustomId;

  const addCurrentAsPreset = () => {
    const primary = normalizeColorToHex(primaryColor);
    const secondary = normalizeColorToHex(secondaryColor);
    const accent = normalizeColorToHex(accentColor);
    if (!primary || !secondary || !accent) return;
    updateNestedField("appearance.customPresets", [
      ...customPresets,
      {
        id: generatePresetId(),
        name: `Custom ${customPresets.length + 1}`,
        primaryColor: primary,
        secondaryColor: secondary,
        accentColor: accent,
      },
    ]);
  };

  const removeCustomPreset = (id: string) => {
    updateNestedField(
      "appearance.customPresets",
      customPresets.filter((preset) => preset?.id !== id),
    );
  };

  // Light/dark only. "Follow the OS" is intentionally not offered: the store
  // renders light by default regardless of the visitor's
  // `prefers-color-scheme`. Applied to the admin immediately so the choice
  // is visible before it is saved — the same behaviour the old screen had.
  const handleModeChange = (next: Theme) => {
    updateNestedField("appearance.theme", next);
    setTheme(next);
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

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Palette className="h-4 w-4 text-primary" />
            {tSafe("admin.branding.colorsTitle", "Brand colors")}
          </CardTitle>
          <CardDescription>
            {tSafe(
              "admin.branding.colorsSubtitle",
              "Buttons, links and highlights on the storefront, and the dashboard, checkout and emails. Pick a preset or set your own with the color picker, hex or rgb().",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <ColorField
              id="brandPrimaryColor"
              label={tSafe("admin.settings.appearance.primaryColor", "Primary color")}
              value={primaryColor}
              onChange={handleColorChange("appearance.primaryColor")}
              onCommit={handleColorCommit("appearance.primaryColor")}
            />
            <ColorField
              id="brandSecondaryColor"
              label={tSafe("admin.settings.appearance.secondaryColor", "Secondary color")}
              value={secondaryColor}
              onChange={handleColorChange("appearance.secondaryColor")}
              onCommit={handleColorCommit("appearance.secondaryColor")}
            />
            <ColorField
              id="brandAccentColor"
              label={tSafe("admin.settings.appearance.accentColor", "Accent color")}
              value={accentColor}
              onChange={handleColorChange("appearance.accentColor")}
              onCommit={handleColorCommit("appearance.accentColor")}
            />
            {/* Loading placeholders. Their own colour, so they no longer
                borrow the accent's tint. */}
            <div className="space-y-1.5">
              <ColorField
                id="brandSkeletonColor"
                label={tSafe("admin.settings.appearance.skeletonColor", "Skeleton color")}
                value={skeletonColor}
                onChange={handleColorChange("appearance.skeletonColor")}
                onCommit={handleColorCommit("appearance.skeletonColor")}
              />
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-24 animate-pulse rounded-full"
                  style={{
                    backgroundColor:
                      normalizeColorToHex(skeletonColor) ?? "rgb(0 0 0 / 0.06)",
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  {tSafe(
                    "admin.settings.appearance.skeletonColorHint",
                    "Loading placeholders. Empty keeps a neutral grey.",
                  )}
                </span>
              </div>
            </div>
          </div>

          <ColorSystemPreview
            primary={normalizeColorToHex(primaryColor) ?? undefined}
            secondary={normalizeColorToHex(secondaryColor) ?? undefined}
            accent={normalizeColorToHex(accentColor) ?? undefined}
          />

          <SectionContainer
            label={tSafe("admin.settings.appearance.presets", "Presets")}
            icon={<RefreshCw className="h-2.5 w-2.5" />}
          >
            <div className="grid grid-cols-3 gap-2.5 md:grid-cols-6">
              {(Object.keys(presetColors) as PresetColor[]).map((key) => {
                const preset = presetColors[key];
                return (
                  <PresetColorCard
                    key={key}
                    color={preset.primary}
                    isActive={activeBuiltInKey === key}
                    onClick={() => applyBuiltInPreset(key)}
                  />
                );
              })}

              {customPresets.map((preset) =>
                preset?.id ? (
                  <CustomPresetCard
                    key={preset.id}
                    color={preset.primaryColor || "#000000"}
                    name={preset.name}
                    isActive={activeCustomId === preset.id}
                    onClick={() =>
                      applyColors(
                        preset.primaryColor,
                        preset.secondaryColor,
                        preset.accentColor,
                      )
                    }
                    onRemove={() => removeCustomPreset(preset.id)}
                  />
                ) : null,
              )}

              {isCurrentUnsaved ? (
                <AddCurrentPresetCard
                  color={normalizeColorToHex(primaryColor) ?? "#000000"}
                  onSave={addCurrentAsPreset}
                />
              ) : null}
            </div>
          </SectionContainer>
        </CardContent>
      </Card>

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
