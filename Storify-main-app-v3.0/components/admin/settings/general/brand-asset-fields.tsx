"use client";

import { useTranslations } from "next-intl";
import type { Settings } from "@/components/admin/settings/types";
import { BrandAssetCard } from "./brand-asset-card";

/**
 * The four brand assets, as the Branding tab (Online Store → Themes →
 * Branding) edits them. Their size and format rules are enforced here, not
 * only printed.
 */
export function BrandAssetFields(props: {
  general: Settings["general"] | undefined;
  updateNestedField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.brandAssets");
  const general = props.general;

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <BrandAssetCard
          label={t("lightLogo.label")}
          value={general?.logoUrl ?? ""}
          onChange={(v) => props.updateNestedField("general.logoUrl", v)}
          alt={t("lightLogo.alt")}
          uploadText={t("lightLogo.upload")}
          replaceText={t("lightLogo.replace")}
          maxSizeMB={5}
          formats={["png", "jpg", "jpeg", "svg", "webp"]}
          recommended="400x120px"
          keepVector
        />
        <BrandAssetCard
          label={t("darkLogo.label")}
          value={general?.darkModeLogoUrl ?? ""}
          onChange={(v) => props.updateNestedField("general.darkModeLogoUrl", v)}
          alt={t("darkLogo.alt")}
          uploadText={t("darkLogo.upload")}
          replaceText={t("darkLogo.replace")}
          maxSizeMB={5}
          formats={["png", "jpg", "jpeg", "svg", "webp"]}
          recommended="400x120px"
          keepVector
          darkPreview
        />
        <BrandAssetCard
          label={t("favicon.label")}
          value={general?.faviconUrl ?? ""}
          onChange={(v) => props.updateNestedField("general.faviconUrl", v)}
          alt={t("favicon.alt")}
          uploadText={t("favicon.upload")}
          replaceText={t("favicon.replace")}
          maxSizeMB={1}
          formats={["png", "ico", "svg", "jpg", "jpeg", "webp"]}
          recommended="32x32px"
        />
        <BrandAssetCard
          label={t("appIcon.label")}
          value={general?.appIconUrl ?? ""}
          onChange={(v) => props.updateNestedField("general.appIconUrl", v)}
          alt={t("appIcon.alt")}
          uploadText={t("appIcon.upload")}
          replaceText={t("appIcon.replace")}
          maxSizeMB={2}
          formats={["png", "svg", "webp"]}
          recommended={t("appIcon.recommended")}
          recommendedDimension={512}
        />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {t("appIcon.note")}
      </p>
    </>
  );
}
