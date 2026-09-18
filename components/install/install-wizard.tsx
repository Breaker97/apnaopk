"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Loader2,
  RefreshCw,
  Store,
  TestTube,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FlagIcon } from "@/components/ui/flag-icon";
import { StorageProviderToggle } from "@/components/admin/storage-provider-toggle";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { apiClient, ApiClientError } from "@/lib/api/client";
import {
  findAppUrlProblem,
  isPreflightBlocking,
  type AppUrlProblem,
} from "@/lib/install/payload";
import type { StorageProvider } from "@/lib/storage/types";
import { cn } from "@/lib/utils";
import { locales, localeConfig, type Locale } from "@/config/i18n.config";

interface TemplateOption {
  id: string;
  name: string;
  description: string;
  accent: string;
  /** Bundled storefront screenshot; the accent gradient is the fallback. */
  preview?: string;
}

interface InstallStatus {
  installed: boolean;
  preflight?: {
    nodeVersion: string;
    nodeOk: boolean;
    databaseOk: boolean;
    authSecretProblem: string | null;
    authUrl: string | null;
  };
  passwordHint?: string;
  /** `.env` already carries a usable credential set — see the storage step. */
  storageFromEnv?: boolean;
}

/** Every language the app ships, by native name; the English name is searchable too. */
const LANGUAGE_OPTIONS = locales.map((code) => {
  const config = localeConfig[code];
  return {
    value: code,
    label: config.nativeName,
    keywords: config.name,
    icon: <FlagIcon countryCode={config.countryCode} size={20} />,
  };
});

type Step = "check" | "admin" | "store" | "storage" | "template" | "done";
const STEPS: Step[] = ["check", "admin", "store", "storage", "template"];

/** Every credential the four backends can ask for, in one flat draft. */
type StorageDraft = Record<StorageField["key"], string> & {
  provider: StorageProvider;
};

interface StorageField {
  key:
    | "accountId"
    | "endpoint"
    | "region"
    | "bucketName"
    | "accessKeyId"
    | "secretAccessKey"
    | "publicUrl";
  /** Suffix under `install.storageField.*`. */
  labelKey: string;
  label: string;
  required: boolean;
  placeholder?: string;
  secret?: boolean;
}

/** Bucket + key pair: every backend is S3-compatible, so these never vary. */
const COMMON_STORAGE_FIELDS: StorageField[] = [
  {
    key: "bucketName",
    labelKey: "bucket",
    label: "Bucket name",
    required: true,
  },
  {
    key: "accessKeyId",
    labelKey: "accessKeyId",
    label: "Access key ID",
    required: true,
  },
  {
    key: "secretAccessKey",
    labelKey: "secretAccessKey",
    label: "Secret access key",
    required: true,
    secret: true,
  },
  {
    key: "publicUrl",
    labelKey: "publicUrl",
    label: "Public URL",
    required: false,
    placeholder: "https://cdn.example.com",
  },
];

/**
 * What each backend needs on top of the common set — the same per-provider
 * split `installStorageSchema` enforces on the server: R2 is located by its
 * account, AWS and Spaces by a region, MinIO by a full endpoint.
 */
const STORAGE_FIELDS: Record<StorageProvider, StorageField[]> = {
  cloudflare_r2: [
    {
      key: "accountId",
      labelKey: "accountId",
      label: "Account ID",
      required: true,
    },
    ...COMMON_STORAGE_FIELDS,
  ],
  s3: [
    {
      key: "region",
      labelKey: "region",
      label: "Region",
      required: true,
      placeholder: "us-east-1",
    },
    ...COMMON_STORAGE_FIELDS,
  ],
  digitalocean: [
    {
      key: "region",
      labelKey: "regionSlug",
      label: "Datacenter region",
      required: true,
      placeholder: "nyc3",
    },
    ...COMMON_STORAGE_FIELDS,
  ],
  minio: [
    {
      key: "endpoint",
      labelKey: "endpoint",
      label: "Endpoint URL",
      required: true,
      placeholder: "https://minio.example.com",
    },
    {
      key: "region",
      labelKey: "region",
      label: "Region",
      required: false,
      placeholder: "us-east-1",
    },
    ...COMMON_STORAGE_FIELDS,
  ],
};

/**
 * The buyer's first five minutes: system check → admin account → store
 * basics → template choice (+ optional sample catalog) → one POST that
 * stands the store up and locks this wizard forever. Runs before any
 * language is chosen, so English fallbacks carry it.
 */
export function InstallWizard({
  locale,
  currencies,
  templates,
}: {
  locale: string;
  /** Every currency the install API accepts, built on the server. */
  currencies: { value: string; label: string; keywords: string }[];
  templates: TemplateOption[];
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);

  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [step, setStep] = useState<Step>("check");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [admin, setAdmin] = useState({ name: "", email: "", password: "" });
  const [store, setStore] = useState({
    name: "",
    language: locale,
    currency: "USD",
    multiVendor: true,
    pos: false,
  });
  const [storage, setStorage] = useState<StorageDraft>({
    provider: "cloudflare_r2",
    accountId: "",
    endpoint: "",
    region: "",
    bucketName: "",
    accessKeyId: "",
    secretAccessKey: "",
    publicUrl: "",
  });
  const [skipStorage, setSkipStorage] = useState(false);
  const [storageTest, setStorageTest] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [testingStorage, setTestingStorage] = useState(false);
  const [template, setTemplate] = useState(templates[0]?.id ?? "");
  const [sampleData, setSampleData] = useState(true);

  const storageFields = STORAGE_FIELDS[storage.provider];
  const storageReady = storageFields.every(
    (field) => !field.required || storage[field.key].trim().length > 0,
  );

  /**
   * The draft as the server's discriminated union wants it: this provider's
   * fields only, so a value typed for one backend and then abandoned for
   * another is never submitted.
   */
  const buildStorage = () =>
    storageFields.reduce<Record<string, string>>(
      (payload, field) => {
        payload[field.key] = storage[field.key].trim();
        return payload;
      },
      { provider: storage.provider },
    );

  const setStorageField = (key: StorageField["key"], value: string) => {
    // Any edit invalidates a verdict about the previous values.
    setStorageTest(null);
    setStorage((current) => ({ ...current, [key]: value }));
  };

  const testStorage = async () => {
    setTestingStorage(true);
    setStorageTest(null);
    try {
      const result = await apiClient.post<{ ok: boolean; message: string }>(
        "/api/install/test-storage",
        buildStorage(),
      );
      setStorageTest(result);
    } catch (err) {
      setStorageTest({
        ok: false,
        message:
          err instanceof ApiClientError
            ? err.message
            : tSafe(
                "install.storageTestFailed",
                "The connection test could not be completed",
              ),
      });
    } finally {
      setTestingStorage(false);
    }
  };

  /**
   * Re-runnable on purpose: the checks below BLOCK the install, and every
   * one of them is fixed in `.env` or the database — outside the browser.
   * Without a re-check the buyer's only way forward is a full page reload.
   */
  const loadStatus = useCallback(() => {
    apiClient
      .get<InstallStatus>("/api/install/status")
      .then((next) => {
        setStatus(next);
        // Nothing to type: with the database blank, the credential resolver
        // falls through to `.env` and media already works.
        if (next.storageFromEnv) setSkipStorage(true);
      })
      // The wizard cannot reach its own API. No preflight at all: the
      // blocking rule stops the run, the database row reports the failure it
      // almost always is, and every other row says it went unchecked — this
      // used to invent green ticks for checks that never ran.
      .catch(() => setStatus({ installed: false }));
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiClient.post<{ ok: boolean; warnings: string[] }>(
        "/api/install/complete",
        {
          admin,
          store,
          storage: skipStorage ? null : buildStorage(),
          template,
          sampleData,
        },
      );
      setWarnings(result.warnings ?? []);
      setStep("done");
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : tSafe("install.failed", "Installation failed — please try again"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = STEPS.indexOf(step);
  const preflight = status?.preflight;
  const blocked = isPreflightBlocking(preflight);
  // Status only ever loads in the browser, so `window` is there whenever a
  // preflight is. The public URL is read here, not from the server: it is
  // the value inlined into this bundle, the one the sign-in form will call.
  const appUrlProblem = preflight
    ? findAppUrlProblem({
        publicUrl: process.env.NEXT_PUBLIC_APP_URL,
        authUrl: preflight.authUrl,
        pageOrigin: window.location.origin,
      })
    : null;
  const notChecked = tSafe(
    "install.notChecked",
    "Not checked — the installer could not reach its database",
  );

  const describeAppUrlProblem = (problem: AppUrlProblem) => {
    switch (problem.kind) {
      case "missing":
        return tSafe(
          "install.appUrlMissing",
          "NEXT_PUBLIC_APP_URL is not set, so signing in calls http://localhost:3000 instead of {origin}. Set it in .env, then rebuild and restart.",
          { origin: problem.pageOrigin },
        );
      case "invalid":
        return tSafe(
          "install.appUrlInvalid",
          "{variable} is “{value}”, which is not a full URL. Use the form https://your-store.com in .env, then rebuild and restart.",
          { variable: problem.variable, value: problem.value },
        );
      case "mismatch":
        return problem.variable === "BETTER_AUTH_URL"
          ? tSafe(
              "install.authUrlMismatch",
              "BETTER_AUTH_URL is {value}, but this installer is open on {origin}. Sign-in emails and social login would send people there. Make them match, then restart.",
              { value: problem.value, origin: problem.pageOrigin },
            )
          : tSafe(
              "install.appUrlMismatch",
              "NEXT_PUBLIC_APP_URL is {value}, but this installer is open on {origin}, so signing in here would fail. Make them match, then rebuild and restart.",
              { value: problem.value, origin: problem.pageOrigin },
            );
    }
  };

  const canContinue =
    step === "check"
      ? Boolean(status && !status.installed && !blocked)
      : step === "admin"
        ? admin.name.trim().length > 0 &&
          /.+@.+\..+/.test(admin.email) &&
          admin.password.length >= 8
        : step === "store"
          ? store.name.trim().length > 0
          : step === "storage"
            ? skipStorage || storageReady
            : Boolean(template);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Store className="h-5 w-5" />
          </span>
          <div>
            <p className="text-lg font-bold leading-tight">
              {tSafe("install.title", "Set up your store")}
            </p>
            <p className="text-xs text-muted-foreground">
              {tSafe("install.subtitle", "A few steps and you are selling")}
            </p>
          </div>
        </div>

        {step !== "done" ? (
          <div className="flex justify-center gap-2" aria-hidden>
            {STEPS.map((name, index) => (
              <span
                key={name}
                className={cn(
                  "h-1.5 w-10 rounded-full transition-colors",
                  index <= stepIndex ? "bg-primary" : "bg-border",
                )}
              />
            ))}
          </div>
        ) : null}

        <Card>
          <CardContent className="space-y-5 p-6">
            {step === "check" ? (
              !status ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tSafe("install.checking", "Checking your environment…")}
                </div>
              ) : (
                <div className="space-y-3">
                  <h2 className="text-base font-semibold">
                    {tSafe("install.checkTitle", "System check")}
                  </h2>
                  <CheckRow
                    state={checkState(preflight?.nodeOk)}
                    label={`Node.js ${preflight?.nodeVersion ?? ""}`.trim()}
                    detail={
                      !preflight
                        ? notChecked
                        : preflight.nodeOk
                          ? ""
                          : tSafe(
                              "install.nodeTooOld",
                              "Node.js 22.12 or newer is required",
                            )
                    }
                  />
                  <CheckRow
                    state={preflight?.databaseOk ? "ok" : "problem"}
                    label={tSafe("install.database", "MongoDB connection")}
                    detail={
                      preflight?.databaseOk
                        ? ""
                        : tSafe(
                            "install.databaseHint",
                            "Check MONGODB_URI and MONGODB_DB_NAME in .env, and that the database accepts connections from this server",
                          )
                    }
                  />
                  <CheckRow
                    state={checkState(preflight && !preflight.authSecretProblem)}
                    label={tSafe("install.authSecret", "Authentication secret")}
                    detail={
                      preflight ? (preflight.authSecretProblem ?? "") : notChecked
                    }
                  />
                  <CheckRow
                    state={checkState(preflight && !appUrlProblem)}
                    label={tSafe("install.appUrl", "Application URL")}
                    detail={
                      !preflight
                        ? notChecked
                        : appUrlProblem
                          ? describeAppUrlProblem(appUrlProblem)
                          : ""
                    }
                  />
                  {blocked ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                      <p className="text-xs text-muted-foreground">
                        {tSafe(
                          "install.blockedHint",
                          "Fix the items above — restart the app after editing .env — then check again. Installation cannot continue until they pass.",
                        )}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={loadStatus}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {tSafe("install.retry", "Check again")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )
            ) : null}

            {step === "admin" ? (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">
                  {tSafe("install.adminTitle", "Create your admin account")}
                </h2>
                <div className="space-y-1.5">
                  <Label htmlFor="install-name">
                    {tSafe("install.adminName", "Your name")}
                  </Label>
                  <Input
                    id="install-name"
                    value={admin.name}
                    onChange={(event) =>
                      setAdmin((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="install-email">
                    {tSafe("install.adminEmail", "Email")}
                  </Label>
                  <Input
                    id="install-email"
                    type="email"
                    value={admin.email}
                    onChange={(event) =>
                      setAdmin((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="install-password">
                    {tSafe("install.adminPassword", "Password")}
                  </Label>
                  <Input
                    id="install-password"
                    type="password"
                    value={admin.password}
                    onChange={(event) =>
                      setAdmin((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                  />
                  {status?.passwordHint ? (
                    <p className="text-xs text-muted-foreground">
                      {status.passwordHint}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === "store" ? (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">
                  {tSafe("install.storeTitle", "Store basics")}
                </h2>
                <div className="space-y-1.5">
                  <Label htmlFor="install-store-name">
                    {tSafe("install.storeName", "Store name")}
                  </Label>
                  <Input
                    id="install-store-name"
                    value={store.name}
                    onChange={(event) =>
                      setStore((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="install-language">
                      {tSafe("install.language", "Default language")}
                    </Label>
                    <SearchableSelect
                      id="install-language"
                      value={store.language}
                      onValueChange={(language) =>
                        setStore((current) => ({ ...current, language }))
                      }
                      options={LANGUAGE_OPTIONS}
                      icon={
                        <FlagIcon
                          countryCode={
                            localeConfig[store.language as Locale]?.countryCode ?? ""
                          }
                          size={20}
                        />
                      }
                      searchPlaceholder={tSafe(
                        "install.searchLanguage",
                        "Search language…",
                      )}
                      emptyText={tSafe("common.noResults", "No results found")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="install-currency">
                      {tSafe("install.currency", "Currency")}
                    </Label>
                    <SearchableSelect
                      id="install-currency"
                      value={store.currency}
                      onValueChange={(currency) =>
                        setStore((current) => ({ ...current, currency }))
                      }
                      options={currencies}
                      searchPlaceholder={tSafe(
                        "install.searchCurrency",
                        "Search currency…",
                      )}
                      emptyText={tSafe("common.noResults", "No results found")}
                    />
                  </div>
                </div>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3">
                  <Checkbox
                    checked={store.multiVendor}
                    onCheckedChange={(value) =>
                      setStore((current) => ({
                        ...current,
                        multiVendor: value === true,
                      }))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {tSafe("install.multiVendor", "Multi-vendor marketplace")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {tSafe(
                        "install.multiVendorHint",
                        "Let other sellers open stores. You can change this later in Settings.",
                      )}
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3">
                  <Checkbox
                    checked={store.pos}
                    onCheckedChange={(value) =>
                      setStore((current) => ({ ...current, pos: value === true }))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {tSafe("install.pos", "Point of sale")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {tSafe(
                        "install.posHint",
                        "Sell in person and take payments at the counter. You can change this later in Settings.",
                      )}
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            {step === "storage" ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold">
                    {tSafe("install.storageTitle", "Where media is stored")}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {tSafe(
                      "install.storageSubtitle",
                      "Product images, videos and downloads all live in your own object storage bucket. Create one with any provider below, then paste its keys.",
                    )}
                  </p>
                </div>

                {status?.storageFromEnv ? (
                  <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
                    {tSafe(
                      "install.storageFromEnv",
                      "Storage credentials were found in your .env file — you can leave this step alone. Filling it in stores them in the database instead, which then takes priority.",
                    )}
                  </p>
                ) : null}

                {!skipStorage ? (
                  <>
                    <div className="space-y-1.5">
                      {/* Not a <Label>: the picker is a row of buttons, not
                          a form control to point at. */}
                      <p className="text-sm font-medium leading-none">
                        {tSafe("install.storageProvider", "Storage provider")}
                      </p>
                      {/* The admin Storage tab's own picker — same cards, same
                          copy, so the wizard is not a second description of
                          the four backends that can drift from it. */}
                      <StorageProviderToggle
                        value={storage.provider}
                        onChange={(provider) => {
                          setStorageTest(null);
                          setStorage((current) => ({ ...current, provider }));
                        }}
                        className="lg:grid-cols-4"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {storageFields.map((field) => (
                        <div key={field.key} className="space-y-1.5">
                          <Label htmlFor={`install-storage-${field.key}`}>
                            {tSafe(
                              `install.storageField.${field.labelKey}`,
                              field.label,
                            )}
                          </Label>
                          <Input
                            id={`install-storage-${field.key}`}
                            type={field.secret ? "password" : "text"}
                            autoComplete="off"
                            placeholder={field.placeholder}
                            value={storage[field.key]}
                            onChange={(event) =>
                              setStorageField(field.key, event.target.value)
                            }
                          />
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={!storageReady || testingStorage}
                        onClick={() => void testStorage()}
                      >
                        {testingStorage ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <TestTube className="h-3.5 w-3.5" />
                        )}
                        {tSafe("install.storageTest", "Test connection")}
                      </Button>
                      {storageTest ? (
                        <p
                          className={cn(
                            "flex items-start gap-1.5 text-xs",
                            storageTest.ok
                              ? "text-green-600 dark:text-green-400"
                              : "text-destructive",
                          )}
                        >
                          {storageTest.ok ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          )}
                          {storageTest.message}
                        </p>
                      ) : null}
                    </div>
                  </>
                ) : null}

                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3">
                  <Checkbox
                    checked={skipStorage}
                    onCheckedChange={(value) => {
                      setSkipStorage(value === true);
                      setStorageTest(null);
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {tSafe("install.storageLater", "Set storage up later")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {tSafe(
                        "install.storageLaterHint",
                        "Finish the install now and add your bucket under Settings → Storage. Uploads stay unavailable until you do.",
                      )}
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            {step === "template" ? (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">
                  {tSafe("install.templateTitle", "Choose your storefront template")}
                </h2>
                {/* Columns follow the roster, so two templates split the row
                    instead of leaving a third-card gap. */}
                <div
                  className={cn(
                    "grid gap-3",
                    templates.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
                  )}
                >
                  {templates.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setTemplate(option.id)}
                      className={cn(
                        "rounded-lg border p-2 text-left transition-colors",
                        template === option.id
                          ? "border-primary ring-1 ring-primary"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      {option.preview ? (
                        <span className="relative block aspect-[4/3] overflow-hidden rounded-md border border-border">
                          <Image
                            src={option.preview}
                            alt={option.name}
                            fill
                            unoptimized
                            sizes={
                              templates.length >= 3
                                ? "(min-width: 640px) 33vw, 100vw"
                                : "(min-width: 640px) 50vw, 100vw"
                            }
                            className="object-cover object-top"
                          />
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "block h-16 rounded-md bg-gradient-to-br",
                            option.accent,
                          )}
                        />
                      )}
                      <span className="mt-2 block text-sm font-semibold">
                        {option.name}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </button>
                  ))}
                </div>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3">
                  <Checkbox
                    checked={sampleData}
                    onCheckedChange={(value) => setSampleData(value === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {tSafe(
                        "install.sampleData",
                        "Import this {template} template's demo store data",
                        {
                          template:
                            templates.find((option) => option.id === template)?.name ?? "",
                        },
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {tSafe(
                        "install.sampleDataHint",
                        "Its catalog, collections and storefront, owned by your store. No demo logins or orders are created. Skip to start empty.",
                      )}
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            {step === "done" ? (
              <div className="space-y-4 py-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">
                    {tSafe("install.doneTitle", "Your store is ready")}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {tSafe(
                      "install.doneSubtitle",
                      "Sign in with the admin account you just created.",
                    )}
                  </p>
                </div>
                {warnings.length > 0 ? (
                  <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-3 text-left">
                    {warnings.map((warning) => (
                      <p
                        key={warning}
                        className="flex items-start gap-2 text-xs text-muted-foreground"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                        {warning}
                      </p>
                    ))}
                  </div>
                ) : null}
                <Button asChild className="gap-1.5">
                  <Link href={`/${locale}/login`}>
                    {tSafe("install.goToLogin", "Go to sign in")}
                    <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                  </Link>
                </Button>
              </div>
            ) : null}

            {error ? (
              <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            ) : null}

            {step !== "done" ? (
              <div className="flex items-center justify-between border-t border-border pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-1.5"
                  disabled={stepIndex === 0 || submitting}
                  onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)])}
                >
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                  {tSafe("install.back", "Back")}
                </Button>
                {step === "template" ? (
                  <Button
                    type="button"
                    className="gap-1.5"
                    disabled={!canContinue || submitting}
                    onClick={() => void submit()}
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {tSafe("install.finish", "Install")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="gap-1.5"
                    disabled={!canContinue}
                    onClick={() => setStep(STEPS[stepIndex + 1])}
                  >
                    {tSafe("install.continue", "Continue")}
                    <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                  </Button>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type CheckState = "ok" | "problem" | "unchecked";

/** No preflight = the check never ran, which is neither a pass nor a fail. */
function checkState(passed: boolean | undefined): CheckState {
  if (passed === undefined) return "unchecked";
  return passed ? "ok" : "problem";
}

function CheckRow({
  state,
  label,
  detail,
}: {
  state: CheckState;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-border p-3">
      {state === "ok" ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
      ) : state === "problem" ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      ) : (
        <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {detail ? (
          <span className="block text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
    </div>
  );
}
