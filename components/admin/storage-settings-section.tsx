"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  TestTube,
  Check,
  X,
  CircleCheck,
  CircleX,
  RefreshCw,
  Settings2,
  Upload,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast-notification";
import {
  StorageProviderToggle,
  type StorageProvider,
} from "@/components/admin/storage-provider-toggle";
import { ConfirmDialog } from "@/components/ui/confirmation-dialog";
import {
  S3CompatibleConfigPanel,
  AWS_REGIONS,
  SPACES_REGIONS,
} from "@/components/admin/s3-compatible-config-panel";
import { CloudflareR2ConfigPanel } from "@/components/admin/cloudflare-r2-config-panel";
import { StorageSetupGuide } from "@/components/admin/storage-setup-guide";
import { SettingsTabHeader } from "@/components/admin/settings/sections/settings-tab-header";
import { StickySaveFooter } from "@/components/admin/settings/sections/sticky-save-footer";
import type { CredentialEnvSources } from "@/lib/settings/credentials";
import type { CredentialFieldMeta } from "@/lib/settings/credential-fields";
import { STORAGE_PROVIDER_LABELS } from "@/lib/storage/types";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/** Credentials for one provider. Blocks are independent — see `IStorageSettings`. */
interface ProviderCredentials {
  accountId?: string;
  endpoint?: string;
  region?: string;
  bucketName?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  publicUrl?: string;
}

/** Which credential block each provider owns. */
const BLOCK_OF: Record<StorageProvider, CredentialBlock> = {
  cloudflare_r2: "r2",
  s3: "s3",
  minio: "minio",
  digitalocean: "digitalocean",
};

type CredentialBlock = "r2" | "s3" | "minio" | "digitalocean";

interface StorageSettings {
  /**
   * `"local"` only ever arrives from a pre-v1.5 document. It is not offered,
   * so selecting anything replaces it permanently.
   */
  provider: StorageProvider | "local";
  r2?: ProviderCredentials;
  s3?: ProviderCredentials;
  minio?: ProviderCredentials;
  digitalocean?: ProviderCredentials;
  /** Deprecated pre-v1.5 flat fields; read for display only, never written. */
  endpoint?: string;
  region?: string;
  bucketName?: string;
  publicUrl?: string;
  maxFileSizeMB: number;
  maxImageSizeMB?: number;
  maxVideoSizeMB?: number;
  maxModelSizeMB?: number;
  allowedMimeTypes: string[];
  pathPrefix?: string;
}

/**
 * What the server says about one provider's stored credentials: whether a
 * value exists and its masked preview. The flag matters on its own — the raw
 * values never reach the browser, so "is something saved?" cannot be answered
 * from the draft.
 */
type CredentialHints = Partial<
  Record<"accountId" | "accessKeyId" | "secretAccessKey", CredentialFieldMeta>
>;

interface StorageSettingsSectionProps {
  storage: StorageSettings;
  onUpdate: (storage: StorageSettings) => void;
  onSave: () => void;
  isSaving: boolean;
  envSources?: CredentialEnvSources["storage"];
  credentialHints?: Partial<Record<CredentialBlock, CredentialHints>>;
}

/**
 * Non-secret fields an un-migrated document still keeps at the top level.
 * (The secrets never reach the browser — they are stripped and replaced by
 * masked hints — so they need no display fallback.)
 */
const LEGACY_VISIBLE_FIELDS = [
  "endpoint",
  "region",
  "bucketName",
  "publicUrl",
] as const;

/**
 * The block to render, mirroring the server's read fallback: before
 * `db:migrate storage-credentials` runs, the values still sit in the flat
 * fields, and showing an empty form there reads as "my configuration is gone".
 *
 * Only the block matching the stored provider inherits them — the flat set can
 * only ever have belonged to whichever provider was active when it was written.
 */
function visibleBlock(
  storage: StorageSettings,
  target: CredentialBlock,
): ProviderCredentials {
  const block: ProviderCredentials = { ...(storage[target] ?? {}) };
  const ownsLegacy =
    storage.provider !== "local" && BLOCK_OF[storage.provider] === target;
  if (!ownsLegacy) return block;

  for (const field of LEGACY_VISIBLE_FIELDS) {
    if (!block[field] && storage[field]) block[field] = storage[field];
  }
  return block;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function StorageSettingsSection({
  storage,
  onUpdate,
  onSave,
  isSaving,
  envSources,
  credentialHints,
}: StorageSettingsSectionProps) {
  const t = useTranslations();
  const [isTesting, setIsTesting] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusSuccess, setStatusSuccess] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingProvider, setPendingProvider] =
    useState<StorageProvider>("cloudflare_r2");
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const updateField = <K extends keyof StorageSettings>(
    field: K,
    value: StorageSettings[K],
  ) => {
    onUpdate({ ...storage, [field]: value });
    setTestResult(null);
  };

  /**
   * Write into one provider's block. The panels used to share a single set of
   * top-level fields, so typing S3 credentials silently overwrote the R2 ones
   * that were still serving the store.
   */
  const updateCredential = (
    block: CredentialBlock,
    field: keyof ProviderCredentials,
    value: string,
  ) => {
    onUpdate({
      ...storage,
      [block]: { ...(storage[block] ?? {}), [field]: value },
    });
    setTestResult(null);
  };

  // A pre-v1.5 document can still say "local", which is no longer offered.
  // Landing on the default provider makes the form ask for the one thing that
  // install now has to supply, instead of rendering a card that isn't there.
  const isLegacyLocal = storage.provider === "local";
  const activeProvider: StorageProvider =
    storage.provider && storage.provider !== "local"
      ? storage.provider
      : "cloudflare_r2";

  const testConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/admin/settings/test-storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The provider being configured, not the one still stored: a legacy
        // "local" document renders the R2 panel, and posting the draft's own
        // value tested the retired provider and failed credentials that were
        // in fact correct.
        body: JSON.stringify({ ...storage, provider: activeProvider }),
      });

      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.message,
      });

      if (data.success) {
        toast.success(data.message || "Storage connection successful!");
      } else {
        toast.error(data.message || "Connection failed");
      }
    } catch (error: unknown) {
      setTestResult({
        success: false,
        message: getErrorMessage(error, "Failed to test connection"),
      });
      toast.error("Failed to test connection");
    } finally {
      setIsTesting(false);
    }
  };

  const blocks: Record<CredentialBlock, ProviderCredentials> = {
    r2: visibleBlock(storage, "r2"),
    s3: visibleBlock(storage, "s3"),
    minio: visibleBlock(storage, "minio"),
    digitalocean: visibleBlock(storage, "digitalocean"),
  };
  const activeBlock = blocks[BLOCK_OF[activeProvider]];

  /** Placeholder previews for one panel — the panels only render the mask. */
  const placeholders = (block: CredentialBlock) => {
    const hints = credentialHints?.[block];
    return {
      accountId: hints?.accountId?.hint,
      accessKeyId: hints?.accessKeyId?.hint,
      secretAccessKey: hints?.secretAccessKey?.hint,
    };
  };

  // A credential counts as available if it is typed in the draft *or* already
  // stored. Without the second half "Test connection" was dead on every saved
  // configuration: secrets are stripped from the settings payload, so the
  // draft is blank until an admin retypes both keys — which is exactly what
  // they should not have to do to test what is already live. The route itself
  // has always fallen back to the stored values.
  const activeHints = credentialHints?.[BLOCK_OF[activeProvider]];
  const canTest =
    Boolean(activeBlock.bucketName) &&
    Boolean(activeBlock.accessKeyId || activeHints?.accessKeyId?.set) &&
    Boolean(activeBlock.secretAccessKey || activeHints?.secretAccessKey?.set);

  const loadStatus = useCallback(() => {
    const request = async () => {
      const res = await fetch("/api/admin/storage/status");
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || "Failed to check storage status");
      }
      return json?.data?.connection as
        | { success?: boolean; message?: string }
        | undefined;
    };
    return request()
      .then((connection) => {
        const isConnected = connection?.success;
        const msg =
          connection?.message ||
          (isConnected
            ? t("admin.settings.storage.connected")
            : t("admin.settings.storage.notConnected"));
        setStatusMessage(msg);
        setStatusSuccess(isConnected ?? null);
      })
      .catch((error: unknown) => {
        setStatusMessage(getErrorMessage(error, "Failed to check storage status"));
        setStatusSuccess(false);
      })
      .finally(() => setIsCheckingStatus(false));
  }, [t]);
  // The button's refresh shows the checking state; the effect below sets it
  // during render instead.
  const refreshStatus = useCallback(() => {
    setIsCheckingStatus(true);
    setStatusSuccess(null);
    return loadStatus();
  }, [loadStatus]);

  useApplyOnChange([activeProvider, loadStatus], () => {
    setIsCheckingStatus(true);
    setStatusSuccess(null);
  });
  useEffect(() => {
    void loadStatus();
  }, [activeProvider, loadStatus]);

  // Refresh the status chip after a save completes so it reflects the newly
  // persisted provider/credentials.
  const wasSaving = useRef(isSaving);
  useEffect(() => {
    if (wasSaving.current && !isSaving) {
      void refreshStatus();
    }
    wasSaving.current = isSaving;
  }, [isSaving, refreshStatus]);

  // Selecting a provider only updates the draft: the config panel appears
  // immediately so credentials can be entered and tested, and the switch
  // takes effect when the section is saved. (The previous flow activated the
  // provider via an API that required a passing connection test against the
  // *saved* settings — making it impossible to ever enter credentials for a
  // not-yet-configured provider.)
  const selectProvider = (next: StorageProvider) => {
    updateField("provider", next);
    setConfirmOpen(false);
  };

  const requestProviderChange = (next: StorageProvider) => {
    if (next === activeProvider) return;
    setPendingProvider(next);
    setConfirmOpen(true);
  };

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("admin.settings.storage.title")}
        description={t("admin.settings.storage.description")}
        meta={
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
              statusSuccess === true
                ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                : statusSuccess === false
                  ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {isCheckingStatus ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : statusSuccess === true ? (
              <CircleCheck className="h-3 w-3" />
            ) : statusSuccess === false ? (
              <CircleX className="h-3 w-3" />
            ) : null}
            {isCheckingStatus
              ? t("admin.settings.storage.checking")
              : statusMessage || "—"}
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-6">
        {/* An install still on the retired local provider. Say plainly what
            happens to the files already on disk, because "your storage option
            is gone" is otherwise read as "my media is gone". */}
        {isLegacyLocal && (
          <div className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <div className="space-y-1 text-amber-900 dark:text-amber-200">
              <p className="font-medium">
                {t("admin.settings.storage.localRetired.title")}
              </p>
              <p className="text-xs leading-relaxed text-amber-800/90 dark:text-amber-200/80">
                {t("admin.settings.storage.localRetired.body")}
              </p>
            </div>
          </div>
        )}

        {/* Provider Selection Cards */}
        <StorageProviderToggle
          value={activeProvider}
          onChange={requestProviderChange}
          disabled={isSaving}
        />

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          type="warning"
          title={t("admin.settings.storage.switchDialog.title")}
          description={t("admin.settings.storage.switchDialog.description")}
          confirmText={t("admin.settings.storage.switchDialog.confirm")}
          cancelText={t("admin.settings.storage.switchDialog.cancel")}
          onConfirm={() => selectProvider(pendingProvider)}
        />

        {/* Provider Configuration */}
        <div className="rounded-xl border bg-muted/30 p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">
              {t("admin.settings.storage.providerConfig", {
                provider: STORAGE_PROVIDER_LABELS[activeProvider],
              })}
            </h4>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {activeProvider === "cloudflare_r2" ? (
              <CloudflareR2ConfigPanel
                accountId={blocks.r2.accountId}
                bucketName={blocks.r2.bucketName || ""}
                accessKeyId={blocks.r2.accessKeyId || ""}
                secretAccessKey={blocks.r2.secretAccessKey || ""}
                publicUrl={blocks.r2.publicUrl}
                envSources={envSources}
                credentialHints={placeholders("r2")}
                onChange={(field, value) =>
                  updateCredential("r2", field, value)
                }
              />
            ) : activeProvider === "s3" ? (
              <S3CompatibleConfigPanel
                region={blocks.s3.region || ""}
                bucketName={blocks.s3.bucketName || ""}
                accessKeyId={blocks.s3.accessKeyId || ""}
                secretAccessKey={blocks.s3.secretAccessKey || ""}
                publicUrl={blocks.s3.publicUrl}
                regions={AWS_REGIONS}
                envSources={envSources}
                credentialHints={placeholders("s3")}
                onChange={(field, value) =>
                  updateCredential("s3", field, value)
                }
              />
            ) : activeProvider === "minio" ? (
              <S3CompatibleConfigPanel
                endpoint={blocks.minio.endpoint}
                region={blocks.minio.region || ""}
                bucketName={blocks.minio.bucketName || ""}
                accessKeyId={blocks.minio.accessKeyId || ""}
                secretAccessKey={blocks.minio.secretAccessKey || ""}
                publicUrl={blocks.minio.publicUrl}
                showEndpoint
                endpointPlaceholder="https://minio.example.com"
                endpointHelp={t("admin.settings.storage.minioEndpointHelp")}
                publicUrlHelp={t("admin.settings.storage.minioPublicUrlHelp")}
                envSources={envSources}
                credentialHints={placeholders("minio")}
                onChange={(field, value) =>
                  updateCredential("minio", field, value)
                }
              />
            ) : (
              <S3CompatibleConfigPanel
                region={blocks.digitalocean.region || ""}
                bucketName={blocks.digitalocean.bucketName || ""}
                accessKeyId={blocks.digitalocean.accessKeyId || ""}
                secretAccessKey={blocks.digitalocean.secretAccessKey || ""}
                publicUrl={blocks.digitalocean.publicUrl}
                regions={SPACES_REGIONS}
                publicUrlHelp={t("admin.settings.storage.spacesPublicUrlHelp")}
                envSources={envSources}
                credentialHints={placeholders("digitalocean")}
                onChange={(field, value) =>
                  updateCredential("digitalocean", field, value)
                }
              />
            )}
          </div>

          {/* Test result banner */}
          {testResult && (
            <div
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${
                testResult.success
                  ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                  : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
              }`}
            >
              {testResult.success ? (
                <Check className="h-4 w-4 shrink-0" />
              ) : (
                <X className="h-4 w-4 shrink-0" />
              )}
              <span className="text-xs font-medium">{testResult.message}</span>
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={testConnection}
              disabled={isTesting || !canTest}
              className="gap-2"
            >
              {isTesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <TestTube className="h-3.5 w-3.5" />
              )}
              {t("admin.settings.storage.testConnection")}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={refreshStatus}
              disabled={isCheckingStatus}
              className="gap-2"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isCheckingStatus ? "animate-spin" : ""}`}
              />
              {t("admin.settings.storage.refresh")}
            </Button>
          </div>
        </div>

        {/* Directly under the fields its steps talk about, and carrying the
            local-storage migration the retired-provider notice points at. */}
        <StorageSetupGuide
          provider={activeProvider}
          configured={canTest}
          legacyLocal={isLegacyLocal}
        />

        {/* Upload Settings */}
        <div className="rounded-xl border bg-muted/30 p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">
              {t("admin.settings.storage.uploadSettings")}
            </h4>
          </div>

          {/* Per-media-type size limits — Shopify pattern. Each type has its
              own ceiling so admins can be permissive with videos/3D without
              also allowing huge images. */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="maxImageSizeMB"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                Max Image Size (MB)
              </Label>
              <NumberInput
                id="maxImageSizeMB"
                min={1}
                max={2048}
                step={1}
                value={storage.maxImageSizeMB ?? 20}
                whenEmpty="keep"
                normalize={Math.trunc}
                onValueChange={(next) => updateField("maxImageSizeMB", next ?? 20)}
                className="bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="maxVideoSizeMB"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                Max Video Size (MB)
              </Label>
              <NumberInput
                id="maxVideoSizeMB"
                min={1}
                max={2048}
                step={1}
                value={storage.maxVideoSizeMB ?? 1024}
                whenEmpty="keep"
                normalize={Math.trunc}
                onValueChange={(next) => updateField("maxVideoSizeMB", next ?? 1024)}
                className="bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="maxModelSizeMB"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                Max 3D Model Size (MB)
              </Label>
              <NumberInput
                id="maxModelSizeMB"
                min={1}
                max={2048}
                step={1}
                value={storage.maxModelSizeMB ?? 500}
                whenEmpty="keep"
                normalize={Math.trunc}
                onValueChange={(next) => updateField("maxModelSizeMB", next ?? 500)}
                className="bg-background"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="pathPrefix"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                {t("admin.settings.storage.pathPrefix")}
              </Label>
              <Input
                id="pathPrefix"
                value={storage.pathPrefix || "uploads/"}
                onChange={(e) => updateField("pathPrefix", e.target.value)}
                placeholder="uploads/"
                className="bg-background"
              />
            </div>
          </div>
        </div>

          <StickySaveFooter
            label={t("admin.settings.storage.save")}
            isSaving={isSaving}
            onSave={onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
