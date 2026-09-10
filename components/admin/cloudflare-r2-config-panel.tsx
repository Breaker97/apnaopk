"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { AlertTriangle, KeyRound, Globe, HardDrive, User } from "lucide-react";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import type { CredentialEnvSources } from "@/lib/settings/credentials";

interface CloudflareR2ConfigPanelProps {
  accountId?: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl?: string;
  envSources?: CredentialEnvSources["storage"];
  /** Masked previews of the saved credentials, keyed by field. */
  credentialHints?: {
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  onChange: (
    field:
      | "accountId"
      | "bucketName"
      | "accessKeyId"
      | "secretAccessKey"
      | "publicUrl",
    value: string,
  ) => void;
}

export function CloudflareR2ConfigPanel({
  accountId,
  bucketName,
  accessKeyId,
  secretAccessKey,
  publicUrl,
  envSources,
  credentialHints,
  onChange,
}: CloudflareR2ConfigPanelProps) {
  const t = useTranslations();

  return (
    <>
      {/* Account & Bucket */}
      <div className="space-y-1.5">
        <Label
          htmlFor="accountId"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          <User className="h-3 w-3" />
          {t("admin.settings.storage.accountId")}
        </Label>
        <Input
          id="accountId"
          value={accountId || ""}
          onChange={(e) => onChange("accountId", e.target.value)}
          placeholder={
            credentialHints?.accountId ||
            t("admin.settings.storage.placeholder.r2AccountId")
          }
          className="bg-background"
        />
        <p className="text-[11px] text-muted-foreground/70">
          {t("admin.settings.storage.help.r2FindOverview")}
        </p>
        <EnvSourceHint show={Boolean(envSources?.accountId)} />
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="bucketName"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          <HardDrive className="h-3 w-3" />
          {t("admin.settings.storage.bucketName")}
        </Label>
        <Input
          id="bucketName"
          value={bucketName}
          onChange={(e) => onChange("bucketName", e.target.value)}
          placeholder={t("admin.settings.storage.placeholder.bucket")}
          className="bg-background"
        />
        <EnvSourceHint show={Boolean(envSources?.bucketName)} />
      </div>

      {/* Credentials */}
      <div className="md:col-span-2">
        <div className="h-px bg-border my-1" />
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="accessKeyId"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          <KeyRound className="h-3 w-3" />
          {t("admin.settings.storage.accessKeyId")}
        </Label>
        <Input
          id="accessKeyId"
          value={accessKeyId}
          onChange={(e) => onChange("accessKeyId", e.target.value)}
          placeholder={
            credentialHints?.accessKeyId ||
            t("admin.settings.storage.placeholder.r2AccessKeyId")
          }
          className="bg-background font-mono text-sm"
        />
        <EnvSourceHint show={Boolean(envSources?.accessKeyId)} />
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="secretAccessKey"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          <KeyRound className="h-3 w-3" />
          {t("admin.settings.storage.secretAccessKey")}
        </Label>
        <Input
          id="secretAccessKey"
          type="password"
          value={secretAccessKey}
          onChange={(e) => onChange("secretAccessKey", e.target.value)}
          placeholder={
            credentialHints?.secretAccessKey ||
            t("admin.settings.storage.placeholder.r2SecretKey")
          }
          className="bg-background"
        />
        <EnvSourceHint show={Boolean(envSources?.secretAccessKey)} />
      </div>

      {/* Public URL */}
      <div className="md:col-span-2">
        <div className="h-px bg-border my-1" />
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <Label
          htmlFor="publicUrl"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          <Globe className="h-3 w-3" />
          {/* Effectively required for R2: without it, file URLs point at the
              private *.r2.cloudflarestorage.com endpoint and 403 in browsers. */}
          {t("admin.settings.storage.publicUrlR2", {
            defaultMessage: "Public URL / CDN (Required)",
          })}
        </Label>
        <Input
          id="publicUrl"
          value={publicUrl || ""}
          onChange={(e) => onChange("publicUrl", e.target.value)}
          placeholder={t("admin.settings.storage.placeholder.r2Url")}
          className="bg-background"
        />
        <p className="text-[11px] text-muted-foreground/70">
          {t("admin.settings.storage.help.r2Domain")}
        </p>
        <EnvSourceHint show={Boolean(envSources?.publicUrl)} />
        {!publicUrl?.trim() && !envSources?.publicUrl && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs leading-relaxed">
              {t("admin.settings.storage.r2PublicUrlMissing", {
                defaultMessage:
                  "Without a public URL, uploaded files cannot be displayed on your store — image and video URLs will point at the private R2 endpoint and fail to load. In Cloudflare Dashboard → R2 → your bucket → Settings → Public access, enable the R2.dev subdomain (or connect a custom domain) and paste that URL here.",
              })}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
