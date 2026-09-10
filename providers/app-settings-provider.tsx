"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  DEFAULT_CURRENCY,
  DEFAULT_LANGUAGE,
  DEFAULT_STORE_NAME,
  resolveFaviconUrl,
} from "@/config/branding.config";
import {
  DEFAULT_SHARE_SETTINGS,
  resolveShareSettings,
  type ShareSettings,
} from "@/lib/site-config/share-config";
import type { InitialAppearanceSettings } from "@/stores/app-settings";
import {
  DEFAULT_COUNTRY_AVAILABILITY,
  normalizeCountryAvailability,
  type CountryAvailability,
} from "@/lib/intl/country-availability";

/**
 * App Settings Context
 * Provides database-driven application settings throughout the app
 * Replaces static environment variables with dynamic settings
 */

interface SocialLinks {
  facebookUrl?: string;
  twitterUrl?: string;
  instagramUrl?: string;
  youtubeUrl?: string;
  linkedinUrl?: string;
  tiktokUrl?: string;
}

interface AppSettingsContextValue {
  isMultiVendor: boolean;
  isLoading: boolean;
  posEnabled: boolean;
  boostingEnabled: boolean;
  /** Paid vendor plans are on, so the vendor billing screen has something to show. */
  vendorPlansEnabled: boolean;
  storeName: string;
  storeDescription?: string;
  storeEmail?: string;
  storePhone?: string;
  storeAddress?: string;
  defaultCurrency: string;
  defaultLanguage: string;
  /** Locale codes the admin enabled for the storefront language picker. */
  supportedLanguages: string[];
  /** Store-wide country options allowed in checkout, onboarding, and forms. */
  countryAvailability: CountryAvailability;
  logoUrl?: string;
  darkModeLogoUrl?: string;
  faviconUrl?: string;
  socialLinks: SocialLinks;
  shareSettings: ShareSettings;
  refreshSettings: () => Promise<void>;
}

export type InitialAppSettings = Partial<
  Omit<AppSettingsContextValue, "refreshSettings">
> & {
  appearance?: InitialAppearanceSettings;
};

function resolveStoreName(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_STORE_NAME;
}

const defaultAppSettings: AppSettingsContextValue = {
  isMultiVendor: false,
  isLoading: true,
  posEnabled: false,
  boostingEnabled: false,
  vendorPlansEnabled: false,
  storeName: DEFAULT_STORE_NAME,
  storeDescription: undefined,
  storeEmail: undefined,
  storePhone: undefined,
  storeAddress: undefined,
  defaultCurrency: DEFAULT_CURRENCY,
  defaultLanguage: DEFAULT_LANGUAGE,
  supportedLanguages: [],
  countryAvailability: { ...DEFAULT_COUNTRY_AVAILABILITY },
  logoUrl: undefined,
  darkModeLogoUrl: undefined,
  faviconUrl: undefined,
  socialLinks: {},
  shareSettings: DEFAULT_SHARE_SETTINGS,
  refreshSettings: async () => {},
};

const AppSettingsContext =
  createContext<AppSettingsContextValue>(defaultAppSettings);

interface AppSettingsProviderProps {
  children: ReactNode;
  initialSettings?: InitialAppSettings;
}

export function AppSettingsProvider({
  children,
  initialSettings,
}: AppSettingsProviderProps) {
  const initialAppSettings = { ...(initialSettings ?? {}) };
  delete initialAppSettings.appearance;
  const [settings, setSettings] = useState<AppSettingsContextValue>({
    ...defaultAppSettings,
    ...initialAppSettings,
    storeName: resolveStoreName(initialSettings?.storeName),
    defaultCurrency: initialSettings?.defaultCurrency || DEFAULT_CURRENCY,
    defaultLanguage: initialSettings?.defaultLanguage || DEFAULT_LANGUAGE,
    supportedLanguages: initialSettings?.supportedLanguages ?? [],
    countryAvailability: normalizeCountryAvailability(
      initialSettings?.countryAvailability,
    ),
    faviconUrl: resolveFaviconUrl(initialSettings?.faviconUrl),
    socialLinks: initialSettings?.socialLinks ?? {},
    shareSettings: resolveShareSettings(initialSettings?.shareSettings),
    isLoading: !initialSettings,
  });

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/public");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSettings({
            isMultiVendor:
              Boolean(
                data.data.multiVendorMode?.enabled ??
                  data.data.multiVendorEnabled,
              ),
            isLoading: false,
            posEnabled: data.data.pos?.enabled ?? false,
            boostingEnabled: data.data.boosting?.enabled ?? false,
            vendorPlansEnabled: data.data.vendorPlans?.enabled ?? false,
            storeName: resolveStoreName(data.data.storeName),
            storeDescription: data.data.storeDescription,
            storeEmail: data.data.storeEmail,
            storePhone: data.data.storePhone,
            storeAddress: data.data.storeAddress,
            defaultCurrency: data.data.defaultCurrency || DEFAULT_CURRENCY,
            defaultLanguage: data.data.defaultLanguage || DEFAULT_LANGUAGE,
            supportedLanguages: Array.isArray(data.data.supportedLanguages)
              ? data.data.supportedLanguages
              : [],
            countryAvailability: normalizeCountryAvailability(
              data.data.countryAvailability,
            ),
            logoUrl: data.data.logoUrl,
            darkModeLogoUrl: data.data.darkModeLogoUrl,
            faviconUrl: resolveFaviconUrl(data.data.faviconUrl),
            socialLinks: {
              facebookUrl: data.data.social?.facebookUrl,
              twitterUrl: data.data.social?.twitterUrl,
              instagramUrl: data.data.social?.instagramUrl,
              youtubeUrl: data.data.social?.youtubeUrl,
              linkedinUrl: data.data.social?.linkedinUrl,
              tiktokUrl: data.data.social?.tiktokUrl,
            },
            shareSettings: resolveShareSettings(data.data.share),
            refreshSettings: fetchSettings,
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch app settings:", error);
      setSettings((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    // Only fetch if we don't have initial settings
    if (!initialSettings) {
      fetchSettings();
    }
  }, [fetchSettings, initialSettings]);

  // The state above is seeded once, by `useState`. When the root layout
  // re-renders with a fresh server payload — which is what happens after an
  // admin saves and the `settings` cache tag is busted — a seeded provider
  // would otherwise keep serving the values it was born with until a full
  // reload. Keyed on the serialized payload so an identical re-render is free.
  // Memoized on the prop identity: React hands the same object back on every
  // client re-render, so serializing the whole payload each time would be pure
  // waste in the provider that wraps the entire app.
  const initialSettingsKey = useMemo(
    () => (initialSettings ? JSON.stringify(initialSettings) : null),
    [initialSettings],
  );
  const isFirstSeed = useRef(true);
  useEffect(() => {
    if (!initialSettingsKey) return;
    if (isFirstSeed.current) {
      isFirstSeed.current = false;
      return;
    }
    void fetchSettings();
  }, [initialSettingsKey, fetchSettings]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const faviconHref = resolveFaviconUrl(settings.faviconUrl);
    const rels = ["icon", "shortcut icon", "apple-touch-icon"];

    rels.forEach((rel) => {
      const existing = document.querySelectorAll<HTMLLinkElement>(
        `link[rel='${rel}']`,
      );

      // No favicon configured → strip the tags instead of pointing them at a
      // placeholder. A broken icon href makes browsers request `/favicon.ico`,
      // and the app deliberately serves nothing there.
      if (!faviconHref) {
        existing.forEach((link) => link.remove());
        return;
      }

      const link = existing[0] ?? document.createElement("link");
      link.rel = rel;
      link.href = faviconHref;
      if (!link.isConnected) document.head.appendChild(link);
    });
  }, [settings.faviconUrl]);

  // Memoized because roughly two dozen components read this context — header,
  // footer, sidebar, checkout, share buttons — and a fresh object literal on
  // every render re-rendered all of them whenever the provider ran.
  const value = useMemo(
    () => ({ ...settings, refreshSettings: fetchSettings }),
    [settings, fetchSettings],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}

/**
 * Hook to access app settings context
 */
export function useAppSettings(): AppSettingsContextValue {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error(
      "useAppSettings must be used within an AppSettingsProvider",
    );
  }
  return context;
}

/**
 * Hook specifically for multi-vendor mode check
 */
export function useMultiVendorMode(): {
  isMultiVendor: boolean;
  isLoading: boolean;
  refreshSettings: () => Promise<void>;
} {
  const { isMultiVendor, isLoading, refreshSettings } = useAppSettings();
  return { isMultiVendor, isLoading, refreshSettings };
}

