"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { usePathname } from "@/hooks/use-locale-navigation";
import {
  type InitialAppearanceSettings,
  useAppSettings,
  useHydrateAppSettingsStore,
  applyCustomColors,
} from "@/stores/app-settings";
import { getLocaleDirection, isValidLocale } from "@/config/i18n.config";
import { isDashboardPath } from "@/lib/access/role-dashboard";

/**
 * SettingsApplier
 * Applies the store's brand colours everywhere, and the viewer's own
 * dashboard preferences (contrast, right-to-left) on the dashboards only.
 * It should be rendered once at the root of the application.
 *
 * Light/dark is not handled here: the ThemeProvider takes the store's default
 * as its own and keeps a visitor's choice once they make one.
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
    hydrateFromDb,
    loadFromDb,
  } = useAppSettings();
  const onDashboard = isDashboardPath(usePathname());
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

  // The page's direction is its language's. The viewer's right-to-left
  // preference turns a dashboard around, never the storefront: shoppers read
  // the store in the direction of the language they browse in.
  useEffect(() => {
    const docLang = document.documentElement.getAttribute("lang");

    const autoLocale =
      (typeof docLang === "string" && isValidLocale(docLang) && docLang) ||
      (typeof localeParam === "string" &&
        isValidLocale(localeParam) &&
        localeParam) ||
      null;

    const autoDirection = autoLocale ? getLocaleDirection(autoLocale) : "ltr";
    const direction = rtl && onDashboard ? "rtl" : autoDirection;
    // Setting the same value still re-styles the page; the root layout already
    // rendered the locale's direction.
    if (document.documentElement.getAttribute("dir") !== direction) {
      document.documentElement.setAttribute("dir", direction);
    }
  }, [rtl, localeParam, onDashboard]);

  // High contrast is the viewer's preference, on the dashboards only.
  useEffect(() => {
    const highContrast = contrast && onDashboard;
    const classes = document.documentElement.classList;
    if (classes.contains("high-contrast") !== highContrast) {
      classes.toggle("high-contrast", highContrast);
    }
  }, [contrast, onDashboard]);

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
