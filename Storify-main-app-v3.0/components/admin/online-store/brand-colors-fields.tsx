"use client";

import { nanoid } from "nanoid";
import { RefreshCw } from "lucide-react";
import {
  AddCurrentPresetCard,
  ColorField,
  ColorSystemPreview,
  CustomPresetCard,
  PresetColorCard,
  SectionContainer,
} from "@/components/admin/appearance-settings-ui";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import type { Settings } from "@/components/admin/settings/types";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { presetColors, type PresetColor } from "@/stores/app-settings";
import {
  colorsEqual,
  normalizeColorToHex,
} from "@/lib/site-config/appearance-colors";

/**
 * The store's brand colors: the three the whole product is built out of,
 * plus the loading-placeholder tint, and the presets that set all three at
 * once.
 *
 * These are GLOBAL — one brand, shared by every theme, and read by the
 * storefront, the dashboard, checkout and emails alike. They live in the
 * theme editor's Colors group because that is where a merchant is choosing
 * colors and where the theme's own roles reference them ("Brand" in a role's
 * source), but they are not part of the theme: switching themes does not
 * change them. Storage is unchanged — `appearance.*`, written by
 * `useBrandingSave` — so this is the same edit the Branding tab used to make.
 */

function generatePresetId(): string {
  return `cp_${nanoid()}`;
}

export function BrandColorsFields({
  settings,
  tSafe,
}: {
  settings: Settings;
  tSafe: TSafe;
}) {
  const { updateNestedField } = useAdminSettingsContext();

  // Optional chaining throughout: a document set up on an older schema may
  // be missing the sub-object entirely.
  const appearance = settings?.appearance;
  const primaryColor = appearance?.primaryColor ?? "";
  const secondaryColor = appearance?.secondaryColor ?? "";
  const accentColor = appearance?.accentColor ?? "";
  const skeletonColor = appearance?.skeletonColor ?? "";
  const customPresets = appearance?.customPresets ?? [];

  const applyColors = (primary?: string, secondary?: string, accent?: string) => {
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

  const handleColorChange = (path: string) => (value: string) =>
    updateNestedField(path, value);

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
    const number = customPresets.length + 1;
    updateNestedField("appearance.customPresets", [
      ...customPresets,
      {
        id: generatePresetId(),
        name: tSafe("admin.branding.customPresetName", `Custom ${number}`, { number }),
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

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
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
        {/* Loading placeholders. Their own colour, so they no longer borrow
            the accent's tint. */}
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
              className="h-2.5 w-16 shrink-0 animate-pulse rounded-full"
              style={{
                backgroundColor:
                  normalizeColorToHex(skeletonColor) ?? "rgb(0 0 0 / 0.06)",
              }}
            />
            <span className="text-[11px] leading-snug text-muted-foreground">
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
        <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-6">
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
    </div>
  );
}
