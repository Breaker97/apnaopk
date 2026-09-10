"use client";

import { type ReactNode } from "react";
import { DEFAULT_THEME_MODE } from "@/config/branding.config";
import { ThemeProvider, type Theme } from "./theme-provider";
import { ToastProvider } from "@/components/ui/toast-notification";
import { ConfirmationProvider } from "@/components/ui/confirmation-dialog";
import { SettingsApplier } from "@/components/settings-applier";
import {
  AppSettingsProvider,
  type InitialAppSettings,
} from "./app-settings-provider";
import { AuthProvider, StaticAuthProvider } from "./auth-provider";
import { CurrencyApplier } from "@/components/currency/currency-applier";
import { PwaLifecycle } from "@/components/pwa/pwa-lifecycle";

interface AppProvidersProps {
  children: ReactNode;
  defaultTheme?: Theme;
  initialSettings?: InitialAppSettings;
  /**
   * A builder section-preview frame (`/section-preview/…`): keeps the
   * session subscription and the PWA lifecycle out of a document that only
   * exists to draw one section inside the admin.
   */
  sectionPreview?: boolean;
}

/**
 * App Providers
 * Wraps the application with all necessary providers
 * Add this to your root layout
 */
export function AppProviders({
  children,
  defaultTheme = DEFAULT_THEME_MODE,
  initialSettings,
  sectionPreview = false,
}: AppProvidersProps) {
  const Auth = sectionPreview ? StaticAuthProvider : AuthProvider;
  return (
    <ThemeProvider defaultTheme={defaultTheme}>
      <AppSettingsProvider initialSettings={initialSettings}>
        <Auth>
          <ConfirmationProvider>
            <SettingsApplier
              initialAppearanceSettings={initialSettings?.appearance}
            />
            <CurrencyApplier />
            {sectionPreview ? null : <PwaLifecycle />}
            {children}
            <ToastProvider />
          </ConfirmationProvider>
        </Auth>
      </AppSettingsProvider>
    </ThemeProvider>
  );
}
