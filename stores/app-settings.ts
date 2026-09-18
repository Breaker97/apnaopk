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
  DEFAULT_THEME_MODE,
  normalizeThemeMode,
  type ThemeMode,
} from "@/config/branding.config";
import { apiClient } from "@/lib/api/client";

export type NavLayout = "vertical" | "horizontal" | "mini";
export type NavColor = "integrate" | "apparent";
export type PresetColor =
  | "default"
  | "cyan"
  | "purple"
  | "blue"
  | "orange"
  | "red";

interface AppSettingsState {
  // Theme
  themeMode: ThemeMode;
  contrast: boolean;

  // Layout
  rtl: boolean;
  collapsedSidebar: boolean;
  navLayout: NavLayout;
  navColor: NavColor;

  // Colors
  presetColor: PresetColor;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;

  dbHydrated: boolean;

  // Actions
  setThemeMode: (mode: ThemeMode) => void;
  setContrast: (enabled: boolean) => void;
  setRtl: (enabled: boolean) => void;
  setCollapsedSidebar: (enabled: boolean) => void;
  setNavLayout: (layout: NavLayout) => void;
  setNavColor: (color: NavColor) => void;
  setPresetColor: (color: PresetColor) => void;
  setPrimaryColor: (color: string) => void;
  setSecondaryColor: (color: string) => void;
  setAccentColor: (color: string) => void;
  resetSettings: () => void;
  hydrateFromDb: (settings: InitialAppearanceSettings) => void;
  loadFromDb: () => Promise<void>;
  saveToDb: () => Promise<boolean>;
}

export interface InitialAppearanceSettings {
  themeMode?: ThemeMode;
  contrast?: boolean;
  rtl?: boolean;
  collapsedSidebar?: boolean;
  navLayout?: NavLayout;
  navColor?: NavColor;
  presetColor?: PresetColor;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  /** Loading placeholders; empty keeps a neutral grey. */
  skeletonColor?: string;
}

const defaultSettings = {
  themeMode: DEFAULT_THEME_MODE,
  contrast: false,
  rtl: false,
  collapsedSidebar: false,
  navLayout: "mini" as NavLayout,
  navColor: "integrate" as NavColor,
  presetColor: DEFAULT_PRESET_COLOR as PresetColor,
  primaryColor: DEFAULT_PRIMARY_COLOR,
  secondaryColor: DEFAULT_SECONDARY_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
  dbHydrated: false,
};

let appSettingsStoreHydrationStarted = false;

function isNavLayout(value: unknown): value is NavLayout {
  return value === "vertical" || value === "horizontal" || value === "mini";
}

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

function normalizeAppearanceSettings(settings?: InitialAppearanceSettings) {
  return {
    // Folds the legacy "system" value (and anything unrecognized) to light —
    // the app never resolves a theme from the OS preference.
    themeMode: normalizeThemeMode(settings?.themeMode),
    contrast:
      typeof settings?.contrast === "boolean"
        ? settings.contrast
        : defaultSettings.contrast,
    rtl:
      typeof settings?.rtl === "boolean" ? settings.rtl : defaultSettings.rtl,
    collapsedSidebar:
      typeof settings?.collapsedSidebar === "boolean"
        ? settings.collapsedSidebar
        : defaultSettings.collapsedSidebar,
    navLayout: isNavLayout(settings?.navLayout)
      ? settings.navLayout
      : defaultSettings.navLayout,
    navColor: isNavColor(settings?.navColor)
      ? settings.navColor
      : defaultSettings.navColor,
    presetColor: isPresetColor(settings?.presetColor)
      ? settings.presetColor
      : defaultSettings.presetColor,
    primaryColor: isValidCssColor(settings?.primaryColor)
      ? settings.primaryColor
      : defaultSettings.primaryColor,
    secondaryColor: isValidCssColor(settings?.secondaryColor)
      ? settings.secondaryColor
      : defaultSettings.secondaryColor,
    accentColor: isValidCssColor(settings?.accentColor)
      ? settings.accentColor
      : defaultSettings.accentColor,
  };
}

export const useAppSettings = create<AppSettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,

      setThemeMode: (mode) => set({ themeMode: mode }),
      setContrast: (enabled) => set({ contrast: enabled }),
      setRtl: (enabled) => set({ rtl: enabled }),
      setCollapsedSidebar: (enabled) => set({ collapsedSidebar: enabled }),
      setNavLayout: (layout) => set({ navLayout: layout }),
      setNavColor: (color) => set({ navColor: color }),
      setPresetColor: (color) => set({ presetColor: color }),
      setPrimaryColor: (color) => set({ primaryColor: color }),
      setSecondaryColor: (color) => set({ secondaryColor: color }),
      setAccentColor: (color) => set({ accentColor: color }),
      resetSettings: () => set(defaultSettings),
      hydrateFromDb: (settings) =>
        set({
          ...normalizeAppearanceSettings(settings),
          dbHydrated: true,
        }),
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
          const a = payload.data.appearance;
          set({
            ...normalizeAppearanceSettings({
              themeMode: normalizeThemeMode(a.theme),
              contrast: typeof a.contrast === "boolean" ? a.contrast : undefined,
              rtl: typeof a.rtl === "boolean" ? a.rtl : undefined,
              collapsedSidebar:
                typeof a.collapsedSidebar === "boolean"
                  ? a.collapsedSidebar
                  : undefined,
              navLayout: isNavLayout(a.navLayout) ? a.navLayout : undefined,
              navColor: isNavColor(a.navColor) ? a.navColor : undefined,
              presetColor: isPresetColor(a.presetColor)
                ? a.presetColor
                : undefined,
              primaryColor: isValidCssColor(a.primaryColor)
                ? a.primaryColor
                : undefined,
              secondaryColor: isValidCssColor(a.secondaryColor)
                ? a.secondaryColor
                : undefined,
              accentColor: isValidCssColor(a.accentColor)
                ? a.accentColor
                : undefined,
            }),
            dbHydrated: true,
          });
        } catch {
          set({ dbHydrated: true });
        }
      },
      saveToDb: async () => {
        // One write path: the API client's error handling (401/429/network)
        // rather than a second hand-rolled fetch of the settings endpoint.
        try {
          const state = get();
          const saved = await apiClient.put<{
            appearance?: Record<string, unknown>;
          }>("/api/admin/settings", {
            section: "appearance",
            data: {
                theme: state.themeMode,
                contrast: state.contrast,
                rtl: state.rtl,
                collapsedSidebar: state.collapsedSidebar,
                navLayout: state.navLayout,
                navColor: state.navColor,
                presetColor: state.presetColor,
                primaryColor: state.primaryColor,
                secondaryColor: state.secondaryColor,
                accentColor: state.accentColor,
            },
          });
          const a = saved?.appearance;
          if (a) {
            set({
              themeMode: normalizeThemeMode(
                typeof a.theme === "string" ? a.theme : state.themeMode,
              ),
              contrast:
                typeof a.contrast === "boolean" ? a.contrast : state.contrast,
              rtl: typeof a.rtl === "boolean" ? a.rtl : state.rtl,
              collapsedSidebar:
                typeof a.collapsedSidebar === "boolean"
                  ? a.collapsedSidebar
                  : state.collapsedSidebar,
              navLayout:
                (typeof a.navLayout === "string"
                  ? a.navLayout
                  : state.navLayout) as NavLayout,
              navColor:
                (typeof a.navColor === "string"
                  ? a.navColor
                  : state.navColor) as NavColor,
              presetColor:
                (typeof a.presetColor === "string"
                  ? a.presetColor
                  : state.presetColor) as PresetColor,
              primaryColor: isValidCssColor(a.primaryColor)
                ? a.primaryColor
                : state.primaryColor,
              secondaryColor: isValidCssColor(a.secondaryColor)
                ? a.secondaryColor
                : state.secondaryColor,
              accentColor: isValidCssColor(a.accentColor)
                ? a.accentColor
                : state.accentColor,
            });
          }
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: "app-settings",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        themeMode: state.themeMode,
        contrast: state.contrast,
        rtl: state.rtl,
        collapsedSidebar: state.collapsedSidebar,
        navLayout: state.navLayout,
        navColor: state.navColor,
        presetColor: state.presetColor,
        primaryColor: state.primaryColor,
        secondaryColor: state.secondaryColor,
        accentColor: state.accentColor,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AppSettingsState> | null;

        return {
          ...currentState,
          // Older persisted blobs can still hold "system"; normalize on rehydrate
          // so it never reaches the applier as an OS-following mode.
          themeMode: normalizeThemeMode(
            persisted?.themeMode ?? currentState.themeMode,
          ),
          contrast: persisted?.contrast ?? currentState.contrast,
          rtl: persisted?.rtl ?? currentState.rtl,
          collapsedSidebar:
            persisted?.collapsedSidebar ?? currentState.collapsedSidebar,
          navLayout: persisted?.navLayout ?? currentState.navLayout,
          navColor: persisted?.navColor ?? currentState.navColor,
          presetColor: persisted?.presetColor ?? currentState.presetColor,
          primaryColor: persisted?.primaryColor ?? currentState.primaryColor,
          secondaryColor:
            persisted?.secondaryColor ?? currentState.secondaryColor,
          accentColor: persisted?.accentColor ?? currentState.accentColor,
          dbHydrated: currentState.dbHydrated,
        };
      },
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
    root.style.setProperty(varName, value);
  }
}
