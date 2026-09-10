"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  DEFAULT_THEME_MODE,
  isThemeMode,
  normalizeThemeMode,
  THEME_MODES,
  type ThemeMode,
} from "@/config/branding.config";

/**
 * Only "light" and "dark" exist. There is no "system" theme: the OS
 * `prefers-color-scheme` preference is never consulted, so a visitor on a
 * dark-mode machine still gets the light storefront unless the admin configured
 * dark or the visitor toggled it themselves.
 */
export type Theme = ThemeMode;

export const THEME_STORAGE_KEY = "minimart-theme";

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  attribute?: "class" | `data-${string}`;
  enableColorScheme?: boolean;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme | ((theme: Theme) => Theme)) => void;
  resolvedTheme: Theme;
  themes: readonly Theme[];
}

const THEME_CHANGE_EVENT = "minimart-theme-change";

const ThemeContext = createContext<ThemeProviderState>({
  theme: DEFAULT_THEME_MODE,
  setTheme: () => undefined,
  resolvedTheme: DEFAULT_THEME_MODE,
  themes: THEME_MODES,
});

function readStoredTheme(storageKey: string, fallbackTheme: Theme): Theme {
  try {
    const storedTheme = localStorage.getItem(storageKey);
    return isThemeMode(storedTheme) ? storedTheme : fallbackTheme;
  } catch {
    return fallbackTheme;
  }
}

/**
 * Drop a stored value this app no longer renders — in practice the legacy
 * `"system"` written before OS-preference mode was removed.
 *
 * Purging matters beyond normalization: `SettingsApplier` treats *any* stored
 * value as "the visitor picked this themselves" and stops applying the admin's
 * configured theme. Leaving a stale `"system"` behind would pin those visitors
 * to light even on a store the admin configured as dark.
 */
function purgeLegacyStoredTheme(storageKey: string) {
  try {
    const storedTheme = localStorage.getItem(storageKey);
    if (storedTheme !== null && !isThemeMode(storedTheme)) {
      localStorage.removeItem(storageKey);
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    }
  } catch {
    // Ignore storage failures in private browsing or restricted contexts.
  }
}

function applyTheme(
  theme: Theme,
  attribute: "class" | `data-${string}`,
  enableColorScheme: boolean,
) {
  const root = document.documentElement;

  if (attribute === "class") {
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  } else {
    root.setAttribute(attribute, theme);
  }

  if (enableColorScheme) {
    // Overrides the `color-scheme: light` <meta> from the root layout viewport
    // so native widgets (scrollbars, form controls) match a chosen dark theme.
    root.style.colorScheme = theme;
  }
}

/**
 * Theme Provider
 * Provides light/dark mode without rendering a client-side script tag.
 */
export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME_MODE,
  storageKey = THEME_STORAGE_KEY,
  attribute = "class",
  enableColorScheme = true,
}: ThemeProviderProps) {
  const subscribeTheme = useCallback(
    (onStoreChange: () => void) => {
      const handleStoreChange = (event: Event) => {
        if (event instanceof StorageEvent && event.key !== storageKey) return;
        onStoreChange();
      };

      window.addEventListener("storage", handleStoreChange);
      window.addEventListener(THEME_CHANGE_EVENT, handleStoreChange);

      return () => {
        window.removeEventListener("storage", handleStoreChange);
        window.removeEventListener(THEME_CHANGE_EVENT, handleStoreChange);
      };
    },
    [storageKey],
  );

  const getThemeSnapshot = useCallback(
    () => readStoredTheme(storageKey, defaultTheme),
    [defaultTheme, storageKey],
  );

  const getServerThemeSnapshot = useCallback(
    () => defaultTheme,
    [defaultTheme],
  );

  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const setTheme = useCallback(
    (value: Theme | ((theme: Theme) => Theme)) => {
      const currentTheme = readStoredTheme(storageKey, defaultTheme);
      const nextTheme = normalizeThemeMode(
        typeof value === "function" ? value(currentTheme) : value,
      );

      try {
        localStorage.setItem(storageKey, nextTheme);
      } catch {
        // Ignore storage failures in private browsing or restricted contexts.
      }

      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    },
    [defaultTheme, storageKey],
  );

  useEffect(() => {
    purgeLegacyStoredTheme(storageKey);
  }, [storageKey]);

  useEffect(() => {
    applyTheme(theme, attribute, enableColorScheme);
  }, [attribute, enableColorScheme, theme]);

  const value = useMemo<ThemeProviderState>(
    () => ({
      theme,
      setTheme,
      // Kept as a distinct field so callers reading `resolvedTheme` keep
      // working; with no system mode it is always the selected theme.
      resolvedTheme: theme,
      themes: THEME_MODES,
    }),
    [setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Hook matching the subset of next-themes used by this app.
 */
export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Hook to access and control the current theme
 */
export function useAppTheme() {
  const { theme, setTheme, resolvedTheme, themes } = useTheme();

  return {
    theme,
    setTheme,
    resolvedTheme,
    themes,
    isDark: resolvedTheme === "dark",
    isLight: resolvedTheme === "light",
    toggleTheme: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
  };
}
