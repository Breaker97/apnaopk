import type { SocialExportSize, SocialExportSizeKey } from "./types";

/**
 * The fixed platform dimensions we export to. Values are the current
 * recommended upload sizes for each surface; keep the keys stable because the
 * UI localizes labels by key (`aiStudio.export.sizes.<key>`).
 */
export const SOCIAL_EXPORT_SIZES: SocialExportSize[] = [
  { key: "og", label: "Link / OG image", width: 1200, height: 630, ratio: "1.91:1" },
  { key: "square", label: "Square post", width: 1080, height: 1080, ratio: "1:1" },
  { key: "portrait", label: "Portrait post", width: 1080, height: 1350, ratio: "4:5" },
  { key: "story", label: "Story / Reel", width: 1080, height: 1920, ratio: "9:16" },
  { key: "twitter", label: "Landscape / X", width: 1600, height: 900, ratio: "16:9" },
];

export const SOCIAL_EXPORT_SIZE_MAP: Record<SocialExportSizeKey, SocialExportSize> =
  Object.fromEntries(
    SOCIAL_EXPORT_SIZES.map((size) => [size.key, size]),
  ) as Record<SocialExportSizeKey, SocialExportSize>;

export function findSocialExportSize(
  key: unknown,
): SocialExportSize | undefined {
  return typeof key === "string"
    ? SOCIAL_EXPORT_SIZE_MAP[key as SocialExportSizeKey]
    : undefined;
}
