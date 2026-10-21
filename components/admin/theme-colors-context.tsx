"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import {
  THEME_COLOR_REFS,
  themeColorRef,
  type ThemeColorRefKey,
} from "@/lib/theme-colors/theme-refs";
import { cn } from "@/lib/utils";

/**
 * The active theme's colours, offered by an admin surface whose colour
 * fields may follow the theme (Header Studio, the footer, the chat widget).
 * `swatches` is each reference resolved for display; `vars` are the
 * `--theme-*` values to set on a preview so a referenced colour paints the
 * store's colour there, not the dashboard's.
 */
export interface ThemeColorChoices {
  swatches: Record<ThemeColorRefKey, string>;
  vars: Record<string, string>;
}

const ThemeColorsContext = createContext<ThemeColorChoices | null>(null);

export function ThemeColorsProvider({
  value,
  children,
}: {
  value: ThemeColorChoices | null | undefined;
  children: ReactNode;
}) {
  return (
    <ThemeColorsContext.Provider value={value ?? null}>{children}</ThemeColorsContext.Provider>
  );
}

/** The theme colours on offer here; null where colour fields take hex only. */
export function useThemeColorChoices(): ThemeColorChoices | null {
  return useContext(ThemeColorsContext);
}

/** What a stored colour paints in the admin: a reference's store colour, else itself. */
export function useDisplayColor(value: string | undefined): string | undefined {
  const choices = useThemeColorChoices();
  const ref = themeColorRef(value);
  return ref && choices ? choices.swatches[ref.key] : value;
}

/** The preview's `--theme-*` values as inline style. */
export function themePreviewStyle(choices: ThemeColorChoices | null): CSSProperties | undefined {
  return choices ? (choices.vars as CSSProperties) : undefined;
}

/**
 * The theme's colours as a row of named swatches. Picking one stores the
 * reference, so the field follows Theme settings → Colors from then on.
 */
export function ThemeColorSwatches({
  value,
  onPick,
  tSafe,
  keys,
}: {
  value: string | undefined;
  onPick: (css: string) => void;
  tSafe: TSafe;
  /** Narrow the offer — a text colour has no use for "Dividers". */
  keys?: readonly ThemeColorRefKey[];
}) {
  const choices = useThemeColorChoices();
  if (!choices) return null;
  const selected = themeColorRef(value)?.key;
  const refs = keys ? THEME_COLOR_REFS.filter((ref) => keys.includes(ref.key)) : THEME_COLOR_REFS;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">
        {tSafe("admin.themeColors.title", "Theme colors")}
      </p>
      <div className="grid grid-cols-5 gap-1.5">
        {refs.map((ref) => {
          const active = selected === ref.key;
          const label = tSafe(`admin.themeColors.refs.${ref.key}`, ref.label);
          return (
            <button
              key={ref.key}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={active}
              onClick={() => onPick(ref.css)}
              className={cn(
                "relative flex h-9 items-center justify-center rounded-md border transition-shadow",
                active ? "border-primary ring-2 ring-primary/30" : "border-border hover:shadow-sm",
              )}
              style={{ backgroundColor: choices.swatches[ref.key] }}
            >
              {active ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-background shadow-sm">
                  <Check className="h-3 w-3 text-primary" aria-hidden />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {selected
          ? tSafe(
              "admin.themeColors.following",
              "Follows the theme's {name}. Change it in Theme settings → Colors.",
              { name: tSafe(`admin.themeColors.refs.${selected}`, THEME_COLOR_REFS.find((ref) => ref.key === selected)!.label).toLowerCase() },
            )
          : tSafe("admin.themeColors.hint", "Pick a theme color to follow Theme settings → Colors.")}
      </p>
    </div>
  );
}
