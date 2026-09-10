"use client";

import type { Settings } from "@/components/admin/settings/types";
import { BrandAssetCard } from "./brand-asset-card";

/**
 * The four brand assets, rendered identically wherever they are edited — the
 * Branding tab (Settings → Branding) and the Brand assets drill page both mount
 * this. Keeping one copy is what stops their size/format rules from drifting
 * apart, since those rules are now enforced rather than only printed.
 */
export function BrandAssetFields(props: {
  general: Settings["general"] | undefined;
  updateNestedField: (path: string, value: unknown) => void;
}) {
  const general = props.general;

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <BrandAssetCard
          label="Light Theme Logo"
          value={general?.logoUrl ?? ""}
          onChange={(v) => props.updateNestedField("general.logoUrl", v)}
          alt="Light theme logo"
          replaceText="Replace light logo"
          maxSizeMB={5}
          formats={["png", "jpg", "jpeg", "svg", "webp"]}
          recommended="400x120px"
        />
        <BrandAssetCard
          label="Dark Theme Logo"
          value={general?.darkModeLogoUrl ?? ""}
          onChange={(v) => props.updateNestedField("general.darkModeLogoUrl", v)}
          alt="Dark theme logo"
          replaceText="Replace dark logo"
          maxSizeMB={5}
          formats={["png", "jpg", "jpeg", "svg", "webp"]}
          recommended="400x120px"
          darkPreview
        />
        <BrandAssetCard
          label="Favicon"
          value={general?.faviconUrl ?? ""}
          onChange={(v) => props.updateNestedField("general.faviconUrl", v)}
          alt="Store favicon"
          replaceText="Replace favicon"
          maxSizeMB={1}
          formats={["png", "ico", "svg", "jpg", "jpeg", "webp"]}
          recommended="32x32px"
        />
        <BrandAssetCard
          label="App Icon"
          value={general?.appIconUrl ?? ""}
          onChange={(v) => props.updateNestedField("general.appIconUrl", v)}
          alt="Installed app icon"
          replaceText="Replace app icon"
          maxSizeMB={2}
          formats={["png", "svg", "webp"]}
          recommended="512x512px square"
          recommendedDimension={512}
        />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        The app icon is what browsers show when someone installs your store to
        their device. It is rendered at 512x512px, so a smaller image still
        works — it just looks softer. Leave it empty and the favicon is used as
        a fallback.
      </p>
    </>
  );
}
