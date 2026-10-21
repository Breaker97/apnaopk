"use client";

import { useEffect, useState } from "react";
import { nanoid } from "nanoid";
import { Check, Plus, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { colorsEqual, normalizeColorToHex } from "@/lib/site-config/appearance-colors";
import { contrastRatio } from "@/lib/theme-colors/contrast";
import { KEY_COLOR_PALETTES, type KeyColorTrio } from "@/lib/theme-colors/palettes";
import {
  KEY_COLOR_META,
  KEY_COLOR_ROLES,
  type ColorRole,
  type KeyColorRole,
} from "@/lib/storefront/themes/tokens";
import { cn } from "@/lib/utils";
import { ColorRoleEditor, issueSummary, type ColorIssue } from "./color-role-row";

/** The text colour that sits on each key colour's fill. */
const ON_COLOR: Partial<Record<KeyColorRole, ColorRole>> = {
  primary: "onPrimary",
  secondary: "onSecondary",
  accent: "onAccent",
};

/** A palette to apply: its three colours, or the theme's own default. */
export type PaletteChoice = (Partial<KeyColorTrio> & { primary: string; accent: string }) | "default";

export function keyColorLabel(role: KeyColorRole, tSafe: TSafe): string {
  return tSafe(`admin.themeEditor.keyColors.${role}.label`, KEY_COLOR_META[role].label);
}

/**
 * The four colours a theme is built from — Primary, Secondary, Accent and
 * Loading — as tiles that show each one where a shopper meets it, above the
 * palettes that set three at once. They belong to the theme being edited:
 * another theme keeps its own, so choosing them here never repaints it.
 *
 * Pointing at a tile (or opening it) asks the preview to mark where that
 * colour paints, through `onHighlight`.
 */
export function KeyColorsEditor({
  themeName,
  mode,
  values,
  defaults,
  resolved,
  themeDefaults,
  issuesFor,
  darkOwnFor,
  onChange,
  onApplyPalette,
  onHighlight,
  tSafe,
}: {
  themeName: string;
  mode: "light" | "dark";
  /** What is stored for this mode. */
  values: Record<ColorRole, string>;
  /** What "default" stores for this mode. */
  defaults: Record<ColorRole, string>;
  /** This mode's scheme as it paints. */
  resolved: Record<ColorRole, string>;
  /** The theme's own default key colours (light), for its palette chip. */
  themeDefaults: KeyColorTrio;
  issuesFor: (role: ColorRole) => ColorIssue[];
  /** On the light tab: the colour a role keeps for dark mode, if any. */
  darkOwnFor: (role: ColorRole) => string | undefined;
  onChange: (role: ColorRole, value: string) => void;
  onApplyPalette: (palette: PaletteChoice) => void;
  onHighlight: (role: KeyColorRole | null) => void;
  tSafe: TSafe;
}) {
  const [open, setOpen] = useState<KeyColorRole | null>(null);
  const [pointed, setPointed] = useState<KeyColorRole | null>(null);
  const defaultLabel = tSafe("admin.themeEditor.themeDefaultNamed", "{theme} default", { theme: themeName });

  // The tile being pointed at wins; an open editor keeps its colour marked.
  const highlighted = pointed ?? open;
  useEffect(() => onHighlight(highlighted), [highlighted, onHighlight]);
  useEffect(() => () => onHighlight(null), [onHighlight]);

  return (
    <section className="space-y-4" aria-labelledby="key-colors-title">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="key-colors-title" className="text-[13px] font-semibold">
            {tSafe("admin.themeEditor.keyColorsTitle", "Key colors")}
          </h3>
          <span className="hidden truncate text-[11px] text-muted-foreground xl:inline">
            {tSafe("admin.themeEditor.keyColorsHint", "Point at one to see it in the preview")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {KEY_COLOR_ROLES.map((role) => (
            <KeyColorTile
              key={`${mode}-${role}`}
              role={role}
              mode={mode}
              values={values}
              defaults={defaults}
              resolved={resolved}
              issues={issuesFor(role)}
              darkOwn={mode === "light" ? darkOwnFor(role) : undefined}
              defaultLabel={defaultLabel}
              open={open === role}
              onOpenChange={(next) => setOpen(next ? role : null)}
              onPoint={(pointing) => setPointed(pointing ? role : null)}
              onChange={onChange}
              tSafe={tSafe}
            />
          ))}
        </div>
      </div>

      {/* Palettes set light; dark follows (or keeps its own). */}
      {mode === "light" ? (
        <Palettes
          resolved={resolved}
          themeDefaults={themeDefaults}
          defaultLabel={defaultLabel}
          onApply={onApplyPalette}
          tSafe={tSafe}
        />
      ) : null}
    </section>
  );
}

function KeyColorTile({
  role,
  mode,
  values,
  defaults,
  resolved,
  issues,
  darkOwn,
  defaultLabel,
  open,
  onOpenChange,
  onPoint,
  onChange,
  tSafe,
}: {
  role: KeyColorRole;
  mode: "light" | "dark";
  values: Record<ColorRole, string>;
  defaults: Record<ColorRole, string>;
  resolved: Record<ColorRole, string>;
  issues: ColorIssue[];
  darkOwn?: string;
  defaultLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPoint: (pointing: boolean) => void;
  onChange: (role: ColorRole, value: string) => void;
  tSafe: TSafe;
}) {
  const label = keyColorLabel(role, tSafe);
  const color = resolved[role];
  const hex = (normalizeColorToHex(color) ?? color).toUpperCase();
  const onRole = ON_COLOR[role];
  const onColor = onRole ? resolved[onRole] : undefined;
  const issueText = issueSummary(role, issues, resolved, tSafe);
  // Dark keeps only the colours set FOR dark; the rest follow light.
  const auto = mode === "dark" && !values[role];
  const sampleFallback = KEY_COLOR_META[role].sample;
  const sample = sampleFallback ? tSafe(`admin.themeEditor.keyColors.${role}.sample`, sampleFallback) : "";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={[
            tSafe("admin.themeEditor.editKeyColor", "{name}: {hex}", { name: label, hex }),
            auto ? tSafe("admin.themeEditor.sourceAuto", "Auto") : "",
            issueText,
          ].filter(Boolean).join(". ")}
          onPointerEnter={() => onPoint(true)}
          onPointerLeave={() => onPoint(false)}
          onFocus={() => onPoint(true)}
          onBlur={() => onPoint(false)}
          className={cn(
            "flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background text-start transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            open ? "border-primary ring-4 ring-primary/10" : "border-border",
          )}
        >
          {role === "skeleton" ? (
            // Placeholders as a shopper sees them: on the page's own background.
            <span
              aria-hidden
              className="flex h-12 flex-col justify-center gap-1.5 border-b border-border/60 px-3"
              style={{ backgroundColor: resolved.background }}
            >
              <span className="block h-2 w-[70%] rounded" style={{ backgroundColor: color }} />
              <span className="block h-2 w-[45%] rounded" style={{ backgroundColor: color }} />
            </span>
          ) : (
            <span
              aria-hidden
              className="flex h-12 items-center justify-between gap-2 px-3"
              style={{ backgroundColor: color, color: onColor }}
            >
              <span
                className={cn(
                  "truncate font-semibold",
                  role === "accent" ? "text-[11px] uppercase tracking-[0.04em]" : "text-[12.5px]",
                )}
              >
                {sample}
              </span>
              {onColor ? (
                <span className="shrink-0 text-[11px] font-medium tabular-nums opacity-90">
                  {contrastRatio(onColor, color).toFixed(1)}:1
                </span>
              ) : null}
            </span>
          )}
          <span className="flex min-w-0 flex-col gap-0.5 px-3 pb-2.5 pt-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold text-foreground">{label}</span>
              {issues.length > 0 ? (
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-status-on-warning" />
              ) : null}
            </span>
            <span className="truncate text-[11px] tabular-nums text-muted-foreground">
              {hex}
              {auto ? ` · ${tSafe("admin.themeEditor.sourceAuto", "Auto")}` : ""}
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-[340px] max-w-[calc(100vw-24px)] space-y-3.5 p-3.5"
        aria-label={label}
        // Focus lands on the chosen source, not the hex field (a phone would
        // open its keyboard) — and not on the tile, where Tab would leave.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const content = event.currentTarget as HTMLElement | null;
          content?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
        }}
      >
        <ColorRoleEditor
          role={role}
          mode={mode}
          value={values[role]}
          defaultValue={defaults[role]}
          values={values}
          defaults={defaults}
          resolved={resolved}
          issues={issues}
          onChange={onChange}
          onClose={() => onOpenChange(false)}
          darkOwn={darkOwn}
          title={label}
          defaultLabel={mode === "light" ? defaultLabel : undefined}
          tSafe={tSafe}
        />
      </PopoverContent>
    </Popover>
  );
}

/** A palette's colours as one pill of segments, the way it will paint. */
function PaletteSwatch({ colors }: { colors: string[] }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgb(15_23_42/0.12)]">
      {colors.map((color, index) => (
        <span key={index} className="h-[18px] w-[9px]" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

function generatePaletteId(): string {
  return `cp_${nanoid()}`;
}

/**
 * Ready-made sets of primary, secondary and accent: the theme's own default
 * first, then the built-in palettes, then the merchant's saved ones (a
 * library shared by every theme — applying one still colours only this
 * theme). The current colours can be saved as a new palette.
 */
function Palettes({
  resolved,
  themeDefaults,
  defaultLabel,
  onApply,
  tSafe,
}: {
  resolved: Record<ColorRole, string>;
  themeDefaults: KeyColorTrio;
  defaultLabel: string;
  onApply: (palette: PaletteChoice) => void;
  tSafe: TSafe;
}) {
  const { settings, updateNestedField } = useAdminSettingsContext();
  const customPresets = settings?.appearance?.customPresets ?? [];
  const current: KeyColorTrio = {
    primary: resolved.primary,
    secondary: resolved.secondary,
    accent: resolved.accent,
  };
  // A palette saved by the two-colour brand editor has no secondary: it
  // leaves Add to cart as it is, so only its two colours decide a match.
  const matches = (palette: PaletteChoice) =>
    palette !== "default" &&
    colorsEqual(palette.primary, current.primary) &&
    colorsEqual(palette.accent, current.accent) &&
    (!palette.secondary || colorsEqual(palette.secondary, current.secondary));

  const entries: { id: string; name: string; palette: PaletteChoice; colors: string[]; matched: boolean; removable?: boolean }[] = [
    {
      id: "theme-default",
      name: defaultLabel,
      palette: "default",
      colors: [themeDefaults.primary, themeDefaults.secondary, themeDefaults.accent],
      matched: matches(themeDefaults),
    },
    ...KEY_COLOR_PALETTES.map((palette) => ({
      id: palette.key,
      name: tSafe(`admin.themeEditor.presets.${palette.key}`, palette.name),
      palette,
      colors: [palette.primary, palette.secondary, palette.accent],
      matched: matches(palette),
    })),
    ...customPresets.flatMap((preset) => {
      const primary = normalizeColorToHex(preset?.primaryColor);
      const accent = normalizeColorToHex(preset?.accentColor);
      if (!preset?.id || !primary || !accent) return [];
      const secondary = normalizeColorToHex(preset.secondaryColor) ?? undefined;
      const palette = { primary, secondary, accent };
      return [{
        id: preset.id,
        name: preset.name,
        palette,
        colors: secondary ? [primary, secondary, accent] : [primary, accent],
        matched: matches(palette),
        removable: true,
      }];
    }),
  ];
  // One chip is "current": the first that matches, so the theme's default
  // wins over a built-in palette that happens to share its colours.
  const activeId = entries.find((entry) => entry.matched)?.id;

  const saveCurrent = () => {
    const primary = normalizeColorToHex(current.primary);
    const secondary = normalizeColorToHex(current.secondary);
    const accent = normalizeColorToHex(current.accent);
    if (!primary || !secondary || !accent) return;
    // The lowest free number, so deleting "Custom 1" and saving again does
    // not produce a second "Custom 2".
    const taken = new Set(customPresets.map((preset) => preset?.name));
    const nameFor = (n: number) => tSafe("admin.branding.customPresetName", `Custom ${n}`, { number: n });
    let number = 1;
    while (taken.has(nameFor(number))) number += 1;
    updateNestedField("appearance.customPresets", [
      ...customPresets,
      { id: generatePaletteId(), name: nameFor(number), primaryColor: primary, secondaryColor: secondary, accentColor: accent },
    ]);
  };

  const chipClass = (active: boolean) =>
    cn(
      "inline-flex h-8 max-w-full items-center rounded-full border text-xs transition-colors",
      active ? "border-primary bg-selection font-medium" : "border-border bg-background hover:bg-muted/50",
    );

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {tSafe("admin.themeEditor.palettes", "Palettes")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {entries.map((entry) => {
          const active = entry.id === activeId;
          const apply = (
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onApply(entry.palette)}
              className={cn(
                "inline-flex h-full min-w-0 items-center gap-1.5 rounded-full ps-1.5",
                entry.removable ? "pe-1" : "pe-2.5",
              )}
            >
              <PaletteSwatch colors={entry.colors} />
              <span className="truncate">{entry.name}</span>
              {active ? <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden /> : null}
            </button>
          );
          if (!entry.removable) {
            return (
              <span key={entry.id} className={chipClass(active)}>
                {apply}
              </span>
            );
          }
          return (
            <span key={entry.id} className={chipClass(active)}>
              {apply}
              <button
                type="button"
                aria-label={tSafe("admin.branding.removeNamedPreset", "Remove {name}", { name: entry.name })}
                title={tSafe("admin.branding.removePreset", "Remove preset")}
                onClick={() =>
                  updateNestedField(
                    "appearance.customPresets",
                    customPresets.filter((preset) => preset?.id !== entry.id),
                  )
                }
                className="me-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          );
        })}

        {activeId ? null : (
          <button
            type="button"
            onClick={saveCurrent}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-primary/50 bg-selection/60 pe-2.5 ps-2 text-xs font-medium text-primary hover:bg-selection"
          >
            <Plus className="h-3 w-3" aria-hidden />
            {tSafe("admin.themeEditor.saveAsPalette", "Save as palette")}
          </button>
        )}
      </div>
    </div>
  );
}
