"use client";

import type { Settings } from "./types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/toast-notification";
import {
  useAppSettings as useAppSettingsStore,
  type PresetColor,
} from "@/stores/app-settings";
import { useCurrencyStore } from "@/providers/currency-provider";
import {
  useAppSettings as usePublicAppSettings,
} from "@/providers/app-settings-provider";
import {
  getSectionIdFromPath,
  setNestedValue,
  withCredentialCleared,
} from "./utils";
import { isPlainObject } from "@/lib/utils";
import {
  DEFAULT_CURRENCY,
  DEFAULT_LANGUAGE,
  DEFAULT_STORE_NAME,
} from "@/config/branding.config";
import { normalizeNotificationSettings } from "@/lib/notifications/notification-settings";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { normalizeCountryAvailability } from "@/lib/intl/country-availability";
import type { CarrierProvider } from "@/lib/shipping/carrier-config";
import { useTranslations } from "next-intl";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { getEffectiveDirtySections, keepUnsavedEdits } from "./dirty-sections";
import { useConfirmation } from "@/components/ui/confirmation-dialog";

const REQUIRED_OBJECT_SECTIONS = [
  "general",
  "appearance",
  "payment",
  "email",
  "sms",
  "orders",
  "shipping",
  "seo",
  "social",
  "analytics",
  "maintenance",
  "security",
  "pos",
  "multiVendorMode",
  "vendorConfig",
  "preorder",
  "notifications",
  "storage",
  "aiSalesAgent",
] as const;

const DEFAULT_GENERAL_SETTINGS: Settings["general"] = {
  storeName: DEFAULT_STORE_NAME,
  storeEmail: "store@example.com",
  defaultLanguage: DEFAULT_LANGUAGE,
  defaultCurrency: DEFAULT_CURRENCY,
  supportedLanguages: [DEFAULT_LANGUAGE],
  countryAvailability: normalizeCountryAvailability(undefined),
};

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.filter((item): item is string => typeof item === "string");
  return normalized.length ? normalized : fallback;
}

function normalizeSettingsPayload(value: unknown): Settings | null {
  if (!isPlainObject(value)) return null;

  const normalized: Record<string, unknown> = { ...value };
  for (const section of REQUIRED_OBJECT_SECTIONS) {
    if (!isPlainObject(normalized[section])) {
      normalized[section] = {};
    }
  }

  const general = normalized.general as Record<string, unknown>;
  normalized.general = {
    ...DEFAULT_GENERAL_SETTINGS,
    ...general,
    supportedLanguages: normalizeStringArray(
      general.supportedLanguages,
      DEFAULT_GENERAL_SETTINGS.supportedLanguages,
    ),
    countryAvailability: normalizeCountryAvailability(
      general.countryAvailability,
    ),
  };

  normalized.notifications = normalizeNotificationSettings(
    normalized.notifications,
  );

  return normalized as unknown as Settings;
}

/** Why a carrier action waits, by action (`admin.settings.shipping.carriers.saveFirst`). */
const SAVE_SHIPPING_FIRST = {
  test: "Save shipping settings before testing the connection",
  webhook: "Save shipping settings before generating the webhook URL",
  disconnect: "Save shipping settings before disconnecting the carrier",
  pickupLocations: "Save shipping settings before loading pickup locations",
} as const;

/** What a save request writes: each key it sends, under its section. */
function writtenPaths(section: string, data: unknown): string[] {
  return isPlainObject(data)
    ? Object.keys(data).map((key) => `${section}.${key}`)
    : [section];
}

/**
 * The saved brand colours, into the store that paints them, so the admin sees
 * the new brand without a reload. Only the brand: the dashboard preferences in
 * that store are the viewer's own and never come from the settings.
 */
function applySavedBrand(appearance: Settings["appearance"]) {
  useAppSettingsStore.getState().hydrateFromDb({
    presetColor: appearance.presetColor as PresetColor | undefined,
    primaryColor: appearance.primaryColor,
    secondaryColor: appearance.secondaryColor,
    accentColor: appearance.accentColor,
  });
}

export function useAdminSettings(initialData?: unknown) {
  const t = useTranslations();
  const tSafe = useFallbackTranslator(t);
  const { confirm } = useConfirmation();
  const { refreshSettings } = usePublicAppSettings();
  // Server-seeded settings (from the admin settings layout) let us skip the
  // on-mount client fetch and its skeleton flash entirely. Normalized once so
  // the initial render already has real data.
  const seededSettings = useMemo(
    () => normalizeSettingsPayload(initialData),
    // initialData is a stable server prop for the life of the layout; seeding
    // once is intentional (refetch() handles refreshes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [settings, setSettings] = useState<Settings | null>(seededSettings);
  const [initialSettings, setInitialSettings] = useState<Settings | null>(
    seededSettings,
  );
  const [isLoading, setIsLoading] = useState(!seededSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [isTestingSms, setIsTestingSms] = useState(false);
  const [isTestingPayment, setIsTestingPayment] = useState(false);
  const [isTestingOAuth, setIsTestingOAuth] = useState(false);
  const [isRegisteringPesapalIpn, setIsRegisteringPesapalIpn] = useState(false);
  const [isCarrierBusy, setIsCarrierBusy] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testSmsTo, setTestSmsTo] = useState("");
  // The pages an edit has touched, each compared with the saved copy below. A
  // save leaves them be: what it wrote compares clean, and a page it did not
  // write keeps its edits (keepUnsavedEdits).
  const [dirtySectionHints, setDirtySectionHints] = useState<Set<string>>(
    () => new Set(),
  );
  // Unsaved edits held outside the settings document, by the settings section
  // of the panel holding them (useReportUnsavedPanel).
  const [unsavedPanels, setUnsavedPanels] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const setPanelUnsaved = useCallback((sectionId: string, unsaved: boolean) => {
    setUnsavedPanels((prev) => {
      if (prev.has(sectionId) === unsaved) return prev;
      const next = new Set(prev);
      if (unsaved) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  }, []);
  const dirtySections = useMemo(
    () =>
      getEffectiveDirtySections(
        settings,
        initialSettings,
        dirtySectionHints,
      ),
    [settings, initialSettings, dirtySectionHints],
  );
  const isDemoMode = Boolean(settings?._meta?.demoMode?.enabled);
  const demoModeMessage =
    settings?._meta?.demoMode?.message ||
    tSafe(
      "admin.settings.demoModeMessage",
      "Demo mode is enabled. Settings changes are disabled on this demo site.",
    );

  const notifyDemoMode = () => {
    toast.error(demoModeMessage);
  };

  /**
   * Loads the settings afresh, dropping every unsaved edit. `keepEdits` keeps
   * them instead (keepUnsavedEdits), apart from those under `serverWins`:
   * for the reload after a server-side action (the Pesapal IPN, a carrier),
   * or after a conflict, where only the page that clashed takes what the
   * server holds.
   */
  const fetchSettings = async (keepEdits?: {
    serverWins: readonly string[];
  }) => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/admin/settings", {
        method: "GET",
        cache: "no-store",
      });
      const json = (await res.json()) as unknown;
      const data = isPlainObject(json) ? json : {};
      if (data.success === true && "data" in data) {
        const loaded = normalizeSettingsPayload(data.data);
        if (!loaded) {
          toast.error(tSafe("admin.settings.toasts.loadFailed", "Failed to load settings"));
          setSettings(null);
          setInitialSettings(null);
          return;
        }
        setSettings((draft) =>
          keepEdits && draft && initialSettings
            ? keepUnsavedEdits(loaded, draft, initialSettings, keepEdits.serverWins)
            : loaded,
        );
        setInitialSettings(loaded);
        if (!keepEdits) setDirtySectionHints(new Set());
      } else {
        toast.error(tSafe("admin.settings.toasts.loadFailed", "Failed to load settings"));
        setSettings(null);
        setInitialSettings(null);
        setDirtySectionHints(new Set());
      }
    } catch {
      toast.error(tSafe("admin.settings.toasts.loadFailed", "Failed to load settings"));
      setSettings(null);
      setInitialSettings(null);
      setDirtySectionHints(new Set());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Already hydrated from the server-rendered layout — no client fetch needed.
    if (seededSettings) return;
    const timer = window.setTimeout(() => {
      void fetchSettings();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markSectionDirty = (sectionId: string) => {
    if (isDemoMode) {
      notifyDemoMode();
      return;
    }
    setDirtySectionHints((prev) => {
      const next = new Set(prev);
      next.add(sectionId);
      return next;
    });
  };

  const updateNestedField = (path: string, value: unknown) => {
    if (isDemoMode) {
      notifyDemoMode();
      return;
    }
    const sectionId = getSectionIdFromPath(path);
    if (sectionId) markSectionDirty(String(sectionId));
    setSettings((prev) => {
      if (!prev) return prev;
      const next = setNestedValue(
        prev as unknown as Record<string, unknown>,
        path,
        value,
      ) as unknown as Settings;
      return value === null ? withCredentialCleared(next, path) : next;
    });
  };

  const updateFieldInSection = (section: string, path: string, value: unknown) => {
    if (isDemoMode) {
      notifyDemoMode();
      return;
    }
    const resolvedPath = path.includes(".") ? path : `${section}.${path}`;
    markSectionDirty(section);
    setSettings((prev) => {
      if (!prev) return prev;
      const next = setNestedValue(
        prev as unknown as Record<string, unknown>,
        resolvedPath,
        value,
      ) as unknown as Settings;
      return value === null
        ? withCredentialCleared(next, resolvedPath)
        : next;
    });
  };

  /** The fingerprints the form loaded for these API sections, if it has them. */
  const expectedVersionsFor = (apiSections: string[]) => {
    const versions = settings?._meta?.sectionVersions;
    if (!versions) return undefined;
    const picked: Record<string, string> = {};
    for (const apiSection of apiSections) {
      const version = versions[apiSection];
      if (typeof version === "string") picked[apiSection] = version;
    }
    return Object.keys(picked).length > 0 ? picked : undefined;
  };

  const isSettingsConflict = (error: unknown): error is ApiClientError =>
    error instanceof ApiClientError &&
    error.status === 409 &&
    error.code === "SETTINGS_CONFLICT";

  /**
   * Someone else saved this section first. Ask whether to overwrite their
   * version or reload; resolves true when the admin chose to overwrite. A
   * reload replaces only what the refused request sent (`written`); edits
   * on other pages stay.
   */
  const resolveConflict = async (
    error: ApiClientError,
    written: readonly string[],
  ) => {
    const overwrite = await confirm({
      type: "warning",
      title: tSafe("admin.settings.conflict.title", "Settings changed elsewhere"),
      description:
        error.message ||
        tSafe(
          "admin.settings.conflict.description",
          "These settings were changed by someone else since you opened them. Reload to see the latest, or save again to overwrite.",
        ),
      confirmText: tSafe("admin.settings.conflict.overwrite", "Save anyway"),
      cancelText: tSafe("admin.settings.conflict.reload", "Reload"),
    });
    if (!overwrite) await fetchSettings({ serverWins: written });
    return overwrite;
  };

  const saveSection = async (
    section: string,
    data: unknown,
    options: { force?: boolean } = {},
  ): Promise<boolean> => {
    if (isDemoMode) {
      notifyDemoMode();
      return false;
    }
    const apiSection =
      // `marketplace` is the shell's id for the multi-vendor screen — the
      // dirty-check and the nav already map it that way. Sending it to
      // "general" would have written marketplace data into the wrong section
      // the first time anything called this with that id.
      section === "marketplace"
        ? "multiVendorMode"
        : section === "twoFactor" ||
            section === "oauth" ||
            section === "emailVerification"
          ? "security"
          : section;
    const written = writtenPaths(apiSection, data);
    try {
      setIsSaving(true);
      // The payload is sent as the caller built it. There used to be a
      // hard-coded key list here that rebuilt the "general" object, which was a
      // second copy of the server's SECTION_ALLOWED_KEYS — and it silently
      // drifted: `general.appIconUrl` was added to the schema, the API and the
      // Branding tab, but never here, so uploading an app icon reported "saved"
      // and stored nothing. The API is the single authority; it drops unknown
      // keys rather than rejecting the request (see validateSectionUpdate).
      const saved = await apiClient.put<unknown>("/api/admin/settings", {
        section: apiSection,
        data,
        // The fingerprints this form loaded; the API answers 409 when the
        // section moved in between. `force` is the dialog's "save anyway".
        ...(options.force
          ? { force: true }
          : { expectedVersions: expectedVersionsFor([apiSection]) }),
      });
      {
        const nextSettings = normalizeSettingsPayload(saved);
        if (!nextSettings) {
          toast.error(tSafe("admin.settings.toasts.saveFailed", "Failed to save settings"));
          return false;
        }
        setSettings((draft) =>
          draft && initialSettings
            ? keepUnsavedEdits(nextSettings, draft, initialSettings, written)
            : nextSettings,
        );
        setInitialSettings(nextSettings);
        if (apiSection === "appearance" && nextSettings.appearance) {
          applySavedBrand(nextSettings.appearance);
        }
        if (apiSection === "general" && nextSettings.general) {
          const newCurrency = nextSettings.general.defaultCurrency || DEFAULT_CURRENCY;
          const currentCurrency = useCurrencyStore.getState().currency.code;
          if (newCurrency.toUpperCase() !== currentCurrency.toUpperCase()) {
            useCurrencyStore.getState().setCurrency(newCurrency);
          }
        }
        // Every section, not just "general". The public payload also carries the
        // multi-vendor, POS, boosting, social, share, appearance and maintenance
        // values that the sidebar and storefront read through
        // `AppSettingsProvider` — refreshing only after "general" is why
        // switching POS on left the admin looking at a nav that had not changed
        // and reasonably concluding the toggle was broken. One cached GET.
        await refreshSettings();
        toast.success(tSafe("admin.settings.toasts.saved", "Settings saved"));
        return true;
      }
    } catch (error) {
      if (isSettingsConflict(error)) {
        setIsSaving(false);
        const overwrite = await resolveConflict(error, written);
        return overwrite ? saveSection(section, data, { force: true }) : false;
      }
      toast.error(
        error instanceof ApiClientError && error.message
          ? error.message
          : tSafe("admin.settings.toasts.saveFailed", "Failed to save settings"),
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const saveSections = async (
    data: Record<string, unknown>,
    options: { force?: boolean } = {},
  ): Promise<boolean> => {
    if (isDemoMode) {
      notifyDemoMode();
      return false;
    }
    const written = Object.entries(data).flatMap(([section, payload]) =>
      writtenPaths(section, payload),
    );
    try {
      setIsSaving(true);
      const saved = await apiClient.put<unknown>("/api/admin/settings", {
        data,
        ...(options.force
          ? { force: true }
          : { expectedVersions: expectedVersionsFor(Object.keys(data)) }),
      });
      {
        const nextSettings = normalizeSettingsPayload(saved);
        if (!nextSettings) {
          toast.error(tSafe("admin.settings.toasts.saveFailed", "Failed to save settings"));
          return false;
        }
        setSettings((draft) =>
          draft && initialSettings
            ? keepUnsavedEdits(nextSettings, draft, initialSettings, written)
            : nextSettings,
        );
        setInitialSettings(nextSettings);
        if (nextSettings.appearance) {
          applySavedBrand(nextSettings.appearance);
        }
        await refreshSettings();
        toast.success(tSafe("admin.settings.toasts.saved", "Settings saved"));
        return true;
      }
    } catch (error) {
      if (isSettingsConflict(error)) {
        setIsSaving(false);
        const overwrite = await resolveConflict(error, written);
        return overwrite ? saveSections(data, { force: true }) : false;
      }
      toast.error(
        error instanceof ApiClientError && error.message
          ? error.message
          : tSafe("admin.settings.toasts.saveFailed", "Failed to save settings"),
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Sends through the saved SMTP settings, like the SMS test: the password
   * never comes back to the browser, so an unsaved host or login would be
   * tested against the old one and a pass would vouch for the wrong server.
   */
  const testSmtp = async () => {
    if (isDemoMode) {
      notifyDemoMode();
      return;
    }
    if (dirtySections.has("email")) {
      toast.error(
        tSafe(
          "admin.settings.toasts.saveEmailFirst",
          "Save the email settings before sending a test email",
        ),
      );
      return;
    }
    try {
      setIsTestingEmail(true);
      const result = await apiClient.request<unknown>(
        "POST",
        "/api/admin/settings/test-email",
        { testEmail },
      );
      toast.success(
        result.message ||
          tSafe("admin.settings.email.test.success", "Test email sent successfully!"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe("admin.settings.email.test.error", "Failed to send test email"),
      );
    } finally {
      setIsTestingEmail(false);
    }
  };

  /**
   * Send one real text through the saved Twilio settings. Gated on a saved
   * section like the carrier and OAuth checks: the credentials never come back
   * to the browser, so an unsaved edit would be tested against the old ones.
   */
  const testSms = async () => {
    if (isDemoMode) {
      notifyDemoMode();
      return;
    }
    if (dirtySections.has("sms")) {
      toast.error(
        tSafe(
          "admin.settings.toasts.saveSmsFirst",
          "Save the SMS settings before sending a test message",
        ),
      );
      return;
    }
    try {
      setIsTestingSms(true);
      const result = await apiClient.request<unknown>(
        "POST",
        "/api/admin/settings/test-sms",
        { to: testSmsTo },
      );
      toast.success(
        result.message || tSafe("admin.settings.sms.testSent", "Test SMS sent"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe("admin.settings.sms.testFailed", "Failed to send test SMS"),
      );
    } finally {
      setIsTestingSms(false);
    }
  };

  const testPaymentConnection = async (
    provider:
      | "stripe"
      | "paypal"
      | "razorpay"
      | "paystack"
      | "pesapal"
      | "iotec"
      | "orange_money"
      | "mtn_momo",
  ) => {
    if (isDemoMode) {
      notifyDemoMode();
      return;
    }
    // The gateway is checked with the stored keys; with new keys still in the
    // form, "Connected" would describe the old ones.
    if (dirtySections.has("payment")) {
      toast.error(
        tSafe(
          "admin.settings.toasts.savePaymentBeforeTest",
          "Save payment settings before testing the connection",
        ),
      );
      return;
    }
    try {
      setIsTestingPayment(true);
      const result = await apiClient.request<unknown>(
        "POST",
        "/api/admin/settings/test-payment",
        { provider },
      );
      toast.success(
        result.message || tSafe("admin.settings.toasts.connected", "Connected"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe("admin.settings.toasts.connectionFailed", "Connection failed"),
      );
    } finally {
      setIsTestingPayment(false);
    }
  };

  /**
   * Verify a social-login provider's stored credentials.
   *
   * Gated on a saved section for the same reason the carrier actions are: the
   * secrets never come back to the browser, so the server can only test what is
   * already persisted — testing with unsaved edits in the form would report on
   * the *previous* credentials and read as a false pass.
   */
  const testOAuthConnection = async (provider: "google" | "facebook") => {
    if (isDemoMode) {
      notifyDemoMode();
      return;
    }
    if (dirtySections.has("oauth")) {
      toast.error(
        tSafe(
          "admin.settings.toasts.saveOauthFirst",
          "Save the OAuth settings before verifying the credentials",
        ),
      );
      return;
    }
    try {
      setIsTestingOAuth(true);
      const result = await apiClient.request<unknown>(
        "POST",
        "/api/admin/settings/test-oauth",
        { provider },
      );
      toast.success(
        result.message ||
          tSafe("admin.settings.oauth.verified", "Credentials verified"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe("admin.settings.oauth.verifyFailed", "Verification failed"),
      );
    } finally {
      setIsTestingOAuth(false);
    }
  };

  const registerPesapalIpn = async () => {
    if (isDemoMode) {
      notifyDemoMode();
      return;
    }
    if (dirtySections.has("payment")) {
      toast.error(
        tSafe(
          "admin.settings.toasts.savePaymentFirst",
          "Save payment settings before registering the Pesapal IPN URL",
        ),
      );
      return;
    }

    try {
      setIsRegisteringPesapalIpn(true);
      const result = await apiClient.request<{ ipnId: string; url: string }>(
        "POST",
        "/api/admin/settings/pesapal/register-ipn",
      );
      toast.success(
        result.message ||
          tSafe("admin.settings.payment.pesapal.ipnRegistered", "Pesapal IPN registered"),
      );
      await fetchSettings({ serverWins: [] });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe(
              "admin.settings.payment.pesapal.ipnFailed",
              "Failed to register Pesapal IPN",
            ),
      );
    } finally {
      setIsRegisteringPesapalIpn(false);
    }
  };

  /**
   * Carrier actions all share one busy flag and one guard: they reach a live
   * carrier account, so an unsaved credential in the form would be tested
   * against the previously stored one and report a misleading result.
   */
  const requireSavedShipping = (
    action: keyof typeof SAVE_SHIPPING_FIRST,
  ): boolean => {
    if (isDemoMode) {
      notifyDemoMode();
      return false;
    }
    if (dirtySections.has("shipping")) {
      toast.error(
        tSafe(
          `admin.settings.shipping.carriers.saveFirst.${action}`,
          SAVE_SHIPPING_FIRST[action],
        ),
      );
      return false;
    }
    return true;
  };

  const testCarrierConnection = async (provider: CarrierProvider) => {
    if (!requireSavedShipping("test")) return;
    try {
      setIsCarrierBusy(true);
      const result = await apiClient.request<{ account?: string; mode?: string }>(
        "POST",
        "/api/admin/settings/test-carrier",
        { provider },
      );
      toast.success(
        result.message || tSafe("admin.settings.toasts.connected", "Connected"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe("admin.settings.toasts.connectionFailed", "Connection failed"),
      );
    } finally {
      setIsCarrierBusy(false);
    }
  };

  const registerCarrierWebhook = async (provider: CarrierProvider) => {
    if (!requireSavedShipping("webhook")) return;
    try {
      setIsCarrierBusy(true);
      const result = await apiClient.request<{ url: string }>(
        "POST",
        `/api/admin/settings/carriers/${provider}/register-webhook`,
      );
      toast.success(
        result.message ||
          tSafe("admin.settings.shipping.carriers.webhookGenerated", "Webhook URL generated"),
      );
      await fetchSettings({ serverWins: [] });
      return result.data?.url;
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe(
              "admin.settings.shipping.carriers.webhookFailed",
              "Failed to generate the webhook URL",
            ),
      );
    } finally {
      setIsCarrierBusy(false);
    }
  };

  const disconnectCarrier = async (provider: CarrierProvider) => {
    // The reload below keeps unsaved edits, and shipping edits kept on top of
    // a disconnect would save the carrier back, or read as someone else's
    // change (409). Saved first, like the other carrier actions.
    if (!requireSavedShipping("disconnect")) return;
    try {
      setIsCarrierBusy(true);
      const result = await apiClient.request<unknown>(
        "POST",
        "/api/admin/settings/carriers/disconnect",
        { provider },
      );
      toast.success(
        result.message ||
          tSafe("admin.settings.shipping.carriers.disconnected", "Carrier disconnected"),
      );
      await fetchSettings({ serverWins: [] });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe(
              "admin.settings.shipping.carriers.disconnectFailed",
              "Failed to disconnect the carrier",
            ),
      );
    } finally {
      setIsCarrierBusy(false);
    }
  };

  const fetchShiprocketPickupLocations = async (): Promise<string[]> => {
    if (!requireSavedShipping("pickupLocations")) return [];
    try {
      setIsCarrierBusy(true);
      const result = await apiClient.request<{ locations: string[] }>(
        "GET",
        "/api/admin/settings/carriers/shiprocket/pickup-locations",
      );
      return result.data?.locations ?? [];
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe(
              "admin.settings.shipping.carriers.pickupLocationsFailed",
              "Failed to load pickup locations",
            ),
      );
      return [];
    } finally {
      setIsCarrierBusy(false);
    }
  };

  const hasUnsaved = (): boolean => {
    return dirtySections.size > 0 || unsavedPanels.size > 0;
  };

  /** Back to the saved copy: every unsaved edit to the settings goes. */
  const discardEdits = () => {
    setSettings(initialSettings);
    setDirtySectionHints(new Set());
  };

  return {
    settings,
    setSettings,
    isLoading,
    isSaving,
    isTestingEmail,
    isTestingSms,
    isTestingPayment,
    isTestingOAuth,
    isRegisteringPesapalIpn,
    testEmail,
    setTestEmail,
    testSmsTo,
    setTestSmsTo,
    dirtySections,
    markSectionDirty,
    updateNestedField,
    updateFieldInSection,
    saveSection,
    saveSections,
    testSmtp,
    testSms,
    testPaymentConnection,
    testOAuthConnection,
    registerPesapalIpn,
    isCarrierBusy,
    testCarrierConnection,
    registerCarrierWebhook,
    disconnectCarrier,
    fetchShiprocketPickupLocations,
    refetch: () => fetchSettings(),
    hasUnsaved,
    discardEdits,
    unsavedPanels,
    setPanelUnsaved,
    isDemoMode,
    demoModeMessage,
  };
}
