"use client";

import { type ReactNode } from "react";
import { DEFAULT_THEME_MODE } from "@/config/branding.config";
import { ThemeProvider } from "./theme-provider";
import { ToastProvider } from "@/components/ui/toast-notification";
import { ConfirmationProvider } from "@/components/ui/confirmation-dialog";
import { SettingsApplier } from "@/components/settings-applier";
import {
  AppSettingsProvider,
  type InitialAppSettings,
} from "./app-settings-provider";
import { CurrencyApplier } from "@/components/currency/currency-applier";
import { PwaLifecycle } from "@/components/pwa/pwa-lifecycle";

interface AppProvidersProps {
  children: ReactNode;
  initialSettings?: InitialAppSettings;
}

/**
 * App Providers
 * Wraps the application with all necessary providers
 * Add this to your root layout
 */
export function AppProviders({
  children,
  initialSettings,
}: AppProvidersProps) {
  return (
    // The store's default light/dark (Online Store → Themes → Branding) is
    // what a visitor sees until they pick their own. It is never written into
    // their browser, so a later change to the default still reaches them.
    <ThemeProvider
      defaultTheme={
        initialSettings?.appearance?.themeMode ?? DEFAULT_THEME_MODE
      }
    >
      <AppSettingsProvider initialSettings={initialSettings}>
        <ConfirmationProvider>
          <SettingsApplier
            initialAppearanceSettings={initialSettings?.appearance}
          />
          <CurrencyApplier />
          <PwaLifecycle />
          {children}
          <ToastProvider />
        </ConfirmationProvider>
      </AppSettingsProvider>
    </ThemeProvider>
  );
}
