"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Cloud, Server, HardDrive, Droplet, Check } from "lucide-react";

export type StorageProvider =
  | "cloudflare_r2"
  | "s3"
  | "minio"
  | "digitalocean";

interface StorageProviderToggleProps {
  value: StorageProvider;
  onChange: (next: StorageProvider) => void;
  disabled?: boolean;
  /**
   * Grid override for the host's width. The default goes four-across only at
   * xl; the install wizard's 2xl card never reaches that breakpoint, so it
   * passes `lg:grid-cols-4` to get the same single row.
   */
  className?: string;
}

const PROVIDERS: {
  value: StorageProvider;
  labelKey: string;
  descKey: string;
  defaultLabel: string;
  defaultDesc: string;
  icon: typeof Cloud;
}[] = [
  {
    value: "cloudflare_r2",
    labelKey: "admin.settings.storage.cloudflareR2",
    descKey: "admin.settings.storage.cloudflareR2Desc",
    defaultLabel: "Cloudflare R2",
    defaultDesc: "S3-compatible storage with no egress fees",
    icon: Cloud,
  },
  {
    value: "s3",
    labelKey: "admin.settings.storage.awsS3",
    descKey: "admin.settings.storage.awsS3Desc",
    defaultLabel: "AWS S3",
    defaultDesc: "Amazon S3 object storage",
    icon: Server,
  },
  {
    value: "minio",
    labelKey: "admin.settings.storage.minio",
    descKey: "admin.settings.storage.minioDesc",
    defaultLabel: "MinIO",
    defaultDesc: "Self-hosted S3 on your own server — no cloud account needed",
    icon: HardDrive,
  },
  {
    value: "digitalocean",
    labelKey: "admin.settings.storage.digitalocean",
    descKey: "admin.settings.storage.digitaloceanDesc",
    defaultLabel: "DigitalOcean Spaces",
    defaultDesc: "Spaces object storage with a built-in CDN",
    icon: Droplet,
  },
];

export function StorageProviderToggle({
  value,
  onChange,
  disabled = false,
  className,
}: StorageProviderToggleProps) {
  const t = useTranslations();

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {PROVIDERS.map(
        ({ value: pv, labelKey, descKey, defaultLabel, defaultDesc, icon: Icon }) => {
          const isActive = value === pv;
          return (
            <button
              key={pv}
              type="button"
              disabled={disabled}
              onClick={() => onChange(pv)}
              className={cn(
                "relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all",
                isActive
                  ? "border-primary ring-1 ring-primary/20 bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30 hover:bg-muted/50",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {isActive && (
                <div className="absolute top-2.5 right-2.5">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <Check className="h-3 w-3 text-primary-foreground" />
                  </div>
                </div>
              )}
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg",
                  isActive
                    ? "text-primary bg-background shadow-sm"
                    : "text-muted-foreground bg-muted",
                )}
              >
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div className="space-y-0.5 pr-5">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {t(labelKey, { defaultMessage: defaultLabel })}
                </p>
                <p
                  className={cn(
                    "text-[11px] leading-snug",
                    isActive
                      ? "text-muted-foreground"
                      : "text-muted-foreground/70",
                  )}
                >
                  {t(descKey, { defaultMessage: defaultDesc })}
                </p>
              </div>
            </button>
          );
        },
      )}
    </div>
  );
}
