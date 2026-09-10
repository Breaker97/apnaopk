"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { HardDrive, Images } from "lucide-react";
import { cn } from "@/lib/utils";
import { StorageSettingsSection } from "@/components/admin/storage-settings-section";
import { MediaLibrarySection } from "@/components/admin/media-library-section";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import { credentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import type { Settings } from "@/components/admin/settings/types";
import type { CredentialFieldMeta } from "@/lib/settings/credential-fields";

type StorageTab = "storage" | "library";

function StorageTabs({
  tab,
  onChange,
}: {
  tab: StorageTab;
  onChange: (tab: StorageTab) => void;
}) {
  const t = useTranslations();
  const tabs: { value: StorageTab; label: string; icon: typeof HardDrive }[] = [
    {
      value: "storage",
      label: t("admin.media.tabStorage"),
      icon: HardDrive,
    },
    {
      value: "library",
      label: t("admin.media.tabLibrary"),
      icon: Images,
    },
  ];

  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-muted/40 p-1">
      {tabs.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
            tab === value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * What the server published about each stored credential — the "is set" flag
 * and its masked preview — grouped per provider.
 *
 * Falls back to the deprecated flat paths so an install that has not run
 * `db:migrate storage-credentials` yet still reports "a value is stored"
 * instead of showing an empty field. Only the block matching the active
 * provider inherits them: the flat set can only have belonged to whichever
 * provider was live when it was written, and surfacing an R2 key under the S3
 * form would claim S3 is configured when it is not.
 */
function storageCredentialHints(settings: Settings) {
  const provider = settings.storage?.provider;

  const resolve = (
    blockPath: string,
    legacyPath: string,
    owner: string,
  ): CredentialFieldMeta => {
    const own = credentialMeta(settings, blockPath);
    if (own.set) return own;
    return provider === owner
      ? credentialMeta(settings, legacyPath)
      : { set: false };
  };

  const block = (name: string, owner: string) => ({
    accessKeyId: resolve(
      `storage.${name}.accessKeyId`,
      "storage.accessKeyId",
      owner,
    ),
    secretAccessKey: resolve(
      `storage.${name}.secretAccessKey`,
      "storage.secretAccessKey",
      owner,
    ),
  });

  return {
    r2: {
      ...block("r2", "cloudflare_r2"),
      accountId: resolve(
        "storage.r2.accountId",
        "storage.accountId",
        "cloudflare_r2",
      ),
    },
    s3: block("s3", "s3"),
    minio: block("minio", "minio"),
    digitalocean: block("digitalocean", "digitalocean"),
  };
}

export default function Page() {
  const {
    isSaving,
    updateNestedField,
    saveSection,
    refetch,
    hasUnsaved,
    isDemoMode,
    demoModeMessage,
  } = useAdminSettingsContext();
  const [tab, setTab] = useState<StorageTab>("storage");

  // The settings draft is fetched once when the settings shell mounts, so
  // values changed elsewhere (another tab, env fallback, a direct DB edit)
  // go stale — and saving a stale draft would overwrite them. Re-sync when
  // entering this page unless there are unsaved edits to protect.
  useEffect(() => {
    if (!hasUnsaved()) void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SectionLoader>
      {(loadedSettings) => (
        <div className="space-y-4">
          {tab === "library" ? (
            <MediaLibrarySection
              tabBar={<StorageTabs tab={tab} onChange={setTab} />}
              isDemoMode={isDemoMode}
              demoModeMessage={demoModeMessage}
            />
          ) : (
            <>
              <StorageTabs tab={tab} onChange={setTab} />
              {/* The tab switcher above stays interactive so the Media Library
                  is always reachable in demo; the storage config form itself is
                  locked read-only. */}
              <fieldset
                disabled={isDemoMode}
                className={cn(
                  "m-0 min-w-0 border-0 p-0",
                  isDemoMode && "opacity-75",
                )}
              >
              <StorageSettingsSection
                storage={
                  loadedSettings.storage || {
                    provider: "cloudflare_r2",
                    r2: {},
                    s3: {},
                    minio: {},
                    digitalocean: {},
                    maxFileSizeMB: 20,
                    maxImageSizeMB: 20,
                    maxVideoSizeMB: 1024,
                    maxModelSizeMB: 500,
                    allowedMimeTypes: [
                      "image/jpeg",
                      "image/png",
                      "image/gif",
                      "image/webp",
                    ],
                    pathPrefix: "uploads/",
                  }
                }
                onUpdate={(newStorage) => {
                  updateNestedField("storage", newStorage);
                }}
                onSave={() => saveSection("storage", loadedSettings.storage)}
                isSaving={isSaving}
                envSources={loadedSettings._meta?.envSources?.storage}
                credentialHints={storageCredentialHints(loadedSettings)}
              />
              </fieldset>
            </>
          )}
        </div>
      )}
    </SectionLoader>
  );
}
