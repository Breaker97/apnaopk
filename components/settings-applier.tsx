"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { THEME_STORAGE_KEY, useTheme } from "@/providers/theme-provider";
import {
  type InitialAppearanceSettings,
  useAppSettings,
  useHydrateAppSettingsStore,
  applyCustomColors,
} from "@/stores/app-settings";
import { getLocaleDirection, isValidLocale } from "@/config/i18n.config";

/**
 * SettingsApplier
 * This component applies global settings to the DOM.
 * It should be rendered once at the root of the application.
 */
export function SettingsApplier({
  initialAppearanceSettings,
}: {
  initialAppearanceSettings?: InitialAppearanceSettings;
}) {
  const hasHydratedAppSettings = useHydrateAppSettingsStore();
  const {
    contrast,
    primaryColor,
    secondaryColor,
    accentColor,
    rtl,
    themeMode,
    hydrateFromDb,
    loadFromDb,
  } = useAppSettings();
  const { setTheme, theme } = useTheme();
  const params = useParams();
  const localeParamRaw = (
    params as Record<string, string | string[] | undefined>
  )?.locale;
  const localeParam = Array.isArray(localeParamRaw)
    ? localeParamRaw[0]
    : localeParamRaw;

  useEffect(() => {
    if (!hasHydratedAppSettings) return;
    if (initialAppearanceSettings) {
      hydrateFromDb(initialAppearanceSettings);
      return;
    }
    void loadFromDb();
  }, [
    hasHydratedAppSettings,
    hydrateFromDb,
    initialAppearanceSettings,
    loadFromDb,
  ]);

  // Seed the admin-configured theme, but only for visitors who have not picked
  // one themselves. `themeMode` is already normalized to light/dark by the
  // store — nothing here can resolve a theme from the OS preference.
  useEffect(() => {
    const userThemePreference = localStorage.getItem(THEME_STORAGE_KEY);
    if (userThemePreference) return;
    if (theme && theme === themeMode) return;
    setTheme(themeMode);
  }, [setTheme, themeMode, theme]);

  // Apply RTL mode (right-to-left direction)
  useEffect(() => {
    const docLang = document.documentElement.getAttribute("lang");

    const autoLocale =
      (typeof docLang === "string" && isValidLocale(docLang) && docLang) ||
      (typeof localeParam === "string" &&
        isValidLocale(localeParam) &&
        localeParam) ||
      null;

    const autoDirection = autoLocale ? getLocaleDirection(autoLocale) : "ltr";
    document.documentElement.setAttribute("dir", rtl ? "rtl" : autoDirection);
  }, [rtl, localeParam]);

  // Apply Contrast mode (high contrast)
  useEffect(() => {
    if (contrast) {
      document.documentElement.classList.add("high-contrast");
    } else {
      document.documentElement.classList.remove("high-contrast");
    }
  }, [contrast]);

  // Apply custom brand colors (primary / secondary / accent) to CSS variables.
  useEffect(() => {
    applyCustomColors({
      primary: primaryColor,
      secondary: secondaryColor,
      accent: accentColor,
    });
  }, [primaryColor, secondaryColor, accentColor]);

  return null;
}
