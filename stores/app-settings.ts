"use client";

import * as React from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  buildCustomColorVars,
  isValidCssColor,
} from "@/lib/site-config/appearance-colors";
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_PRESET_COLOR,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  type ThemeMode,
} from "@/config/branding.config";

type NavColor = "integrate" | "apparent";
export type PresetColor =
  | "default"
  | "cyan"
  | "purple"
  | "blue"
  | "orange"
  | "red";

/**
 * Two kinds of state live here, and they never mix:
 *
 * - The viewer's own dashboard preferences: contrast, right-to-left, a
 *   collapsed sidebar, the sidebar colour. They stay in this browser —
 *   nothing writes them to the store's settings, so one admin's choice never
 *   reaches another admin, a vendor, staff or a shopper. Light/dark is the
 *   ThemeProvider's, kept the same way.
 * - The store's brand colours, from the settings (Online Store → Themes →
 *   Branding). Never cached here: a colour kept in one browser would outlive
 *   a change to the brand.
 */
interface AppSettingsState {
  // The viewer's preferences
  contrast: boolean;
  rtl: boolean;
  collapsedSidebar: boolean;
  navColor: NavColor;

  // The store's brand
  presetColor: PresetColor;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;

  dbHydrated: boolean;

  // Actions
  setContrast: (enabled: boolean) => void;
  setRtl: (enabled: boolean) => void;
  setCollapsedSidebar: (enabled: boolean) => void;
  setNavColor: (color: NavColor) => void;
  resetPreferences: () => void;
  hydrateFromDb: (settings: InitialAppearanceSettings) => void;
  loadFromDb: () => Promise<void>;
}

export interface InitialAppearanceSettings {
  /** The storefront's default light/dark: the ThemeProvider's default. */
  themeMode?: ThemeMode;
  presetColor?: PresetColor;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  /** Loading placeholders; empty keeps a neutral grey. */
  skeletonColor?: string;
}

type Preferences = Pick<
  AppSettingsState,
  "contrast" | "rtl" | "collapsedSidebar" | "navColor"
>;

const DEFAULT_PREFERENCES: Preferences = {
  contrast: false,
  rtl: false,
  collapsedSidebar: false,
  navColor: "integrate",
};

const DEFAULT_BRAND = {
  presetColor: DEFAULT_PRESET_COLOR as PresetColor,
  primaryColor: DEFAULT_PRIMARY_COLOR,
  secondaryColor: DEFAULT_SECONDARY_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
};

let appSettingsStoreHydrationStarted = false;

function isNavColor(value: unknown): value is NavColor {
  return value === "integrate" || value === "apparent";
}

function isPresetColor(value: unknown): value is PresetColor {
  return (
    value === "default" ||
    value === "cyan" ||
    value === "purple" ||
    value === "blue" ||
    value === "orange" ||
    value === "red"
  );
}

/** The brand colours out of a settings payload, each checked or defaulted. */
function normalizeBrand(settings?: {
  presetColor?: unknown;
  primaryColor?: unknown;
  secondaryColor?: unknown;
  accentColor?: unknown;
}) {
  return {
    presetColor: isPresetColor(settings?.presetColor)
      ? settings.presetColor
      : DEFAULT_BRAND.presetColor,
    primaryColor: isValidCssColor(settings?.primaryColor)
      ? settings.primaryColor
      : DEFAULT_BRAND.primaryColor,
    secondaryColor: isValidCssColor(settings?.secondaryColor)
      ? settings.secondaryColor
      : DEFAULT_BRAND.secondaryColor,
    accentColor: isValidCssColor(settings?.accentColor)
      ? settings.accentColor
      : DEFAULT_BRAND.accentColor,
  };
}

/**
 * The preferences out of a stored blob. Blobs written before 2.4 also cached
 * the theme default and the brand colours from the database; only the
 * preferences carry over.
 */
export function pickPreferences(stored: unknown): Preferences {
  const value = (stored ?? {}) as Partial<Record<keyof Preferences, unknown>>;
  return {
    contrast:
      typeof value.contrast === "boolean"
        ? value.contrast
        : DEFAULT_PREFERENCES.contrast,
    rtl: typeof value.rtl === "boolean" ? value.rtl : DEFAULT_PREFERENCES.rtl,
    collapsedSidebar:
      typeof value.collapsedSidebar === "boolean"
        ? value.collapsedSidebar
        : DEFAULT_PREFERENCES.collapsedSidebar,
    navColor: isNavColor(value.navColor)
      ? value.navColor
      : DEFAULT_PREFERENCES.navColor,
  };
}

export const useAppSettings = create<AppSettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_PREFERENCES,
      ...DEFAULT_BRAND,
      dbHydrated: false,

      setContrast: (enabled) => set({ contrast: enabled }),
      setRtl: (enabled) => set({ rtl: enabled }),
      setCollapsedSidebar: (enabled) => set({ collapsedSidebar: enabled }),
      setNavColor: (color) => set({ navColor: color }),
      resetPreferences: () => set(DEFAULT_PREFERENCES),
      hydrateFromDb: (settings) =>
        set({ ...normalizeBrand(settings), dbHydrated: true }),
      loadFromDb: async () => {
        if (get().dbHydrated) return;
        try {
          const res = await fetch("/api/settings/public");
          const json = (await res.json()) as unknown;
          const payload = json as {
            success?: boolean;
            data?: { appearance?: Record<string, unknown> };
          };
          if (!payload?.success || !payload.data?.appearance) return;
          set({
            ...normalizeBrand(payload.data.appearance),
            dbHydrated: true,
          });
        } catch {
          set({ dbHydrated: true });
        }
      },
    }),
    {
      name: "app-settings",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state): Preferences => ({
        contrast: state.contrast,
        rtl: state.rtl,
        collapsedSidebar: state.collapsedSidebar,
        navColor: state.navColor,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...pickPreferences(persistedState),
      }),
    }
  )
);

export function useHydrateAppSettingsStore() {
  const [hasHydrated, setHasHydrated] = React.useState(() =>
    typeof window === "undefined"
      ? false
      : useAppSettings.persist.hasHydrated(),
  );

  React.useEffect(() => {
    const unsubscribe = useAppSettings.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });

    if (
      appSettingsStoreHydrationStarted ||
      useAppSettings.persist.hasHydrated()
    ) {
      return unsubscribe;
    }

    appSettingsStoreHydrationStarted = true;
    void Promise.resolve(useAppSettings.persist.rehydrate()).then(() => {
      setHasHydrated(true);
    });

    return unsubscribe;
  }, []);

  return hasHydrated;
}

// Preset color values. `primary` is the OKLCH swatch used only for the preview
// card; `hex`/`secondaryHex`/`accentHex` are the full triple applied to the app
// when a preset is picked (they fill the Primary/Secondary/Accent inputs).
export const presetColors: Record<
  PresetColor,
  {
    primary: string;
    hex: string;
    secondaryHex: string;
    accentHex: string;
    name: string;
  }
> = {
  default: {
    primary: "oklch(0.55 0.20 250)",
    hex: DEFAULT_PRIMARY_COLOR,
    secondaryHex: DEFAULT_SECONDARY_COLOR,
    accentHex: DEFAULT_ACCENT_COLOR,
    name: "Blue",
  },
  cyan: {
    primary: "oklch(0.65 0.15 200)",
    hex: "#00B8D9",
    secondaryHex: "#7635DC",
    accentHex: "#FFC107",
    name: "Cyan",
  },
  purple: {
    primary: "oklch(0.55 0.20 290)",
    hex: "#7635DC",
    secondaryHex: "#2065D1",
    accentHex: "#FFAB00",
    name: "Purple",
  },
  blue: {
    primary: "oklch(0.18 0 0)",
    hex: "#111111",
    secondaryHex: "#637381",
    accentHex: "#FFC107",
    name: "Black",
  },
  orange: {
    primary: "oklch(0.70 0.18 60)",
    hex: "#FDA92D",
    secondaryHex: "#7635DC",
    accentHex: "#2065D1",
    name: "Orange",
  },
  red: {
    primary: "oklch(0.55 0.25 25)",
    hex: "#FF3030",
    secondaryHex: "#7635DC",
    accentHex: "#FFAB00",
    name: "Red",
  },
};

/**
 * Apply the custom appearance colors to the global CSS variables on <html>.
 * The server layout inlines the same variables (buildCustomColorVars) into the
 * initial HTML; this client-side pass only matters when the colors change at
 * runtime (admin editing appearance settings).
 */
export function applyCustomColors(colors: {
  primary?: string;
  secondary?: string;
  accent?: string;
}) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [varName, value] of Object.entries(buildCustomColorVars(colors))) {
    // The root layout inlines these on <html> for the first paint. Writing an
    // identical value again still re-styles the whole page — on a phone, over
    // a hundred milliseconds in the middle of hydration.
    if (root.style.getPropertyValue(varName) === value) continue;
    root.style.setProperty(varName, value);
  }
}
