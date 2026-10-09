/**
 * Social export: turn any AI Studio image into a ready-to-post asset at an
 * exact platform size. This is a deterministic sharp render (like the
 * hero-banner pipeline) — no AI/token cost — so it never touches the OpenAI
 * key or the usage caps.
 */

export type SocialExportSizeKey =
  | "og"
  | "square"
  | "portrait"
  | "story"
  | "twitter";

/** How the source image is fitted into the target frame. */
export type SocialExportMode = "cover" | "pad";

export type SocialExportFormat = "png" | "jpeg";

export type SocialExportSize = {
  key: SocialExportSizeKey;
  /** English label; the UI localizes via `aiStudio.export.sizes.<key>`. */
  label: string;
  width: number;
  height: number;
  ratio: string;
};

export type SocialExportOptions = {
  size: SocialExportSize;
  /** cover = fill the frame (may crop); pad = contain on a solid background. */
  mode: SocialExportMode;
  format: SocialExportFormat;
  /** Background for pad mode + the flatten color when exporting jpeg. */
  padColor?: string;
  /** Optional logo lockup composited into the bottom-right corner. */
  logo?: Buffer;
};

export type RenderedSocialExport = {
  buffer: Buffer;
  width: number;
  height: number;
  format: SocialExportFormat;
  contentType: string;
};

/** A validated client request, before settings-derived values are applied. */
export type SocialExportRequest = {
  sourceUrl: string;
  sizeKey: SocialExportSizeKey;
  mode: SocialExportMode;
  format: SocialExportFormat;
  /** Composite the store's brand logo (if one is configured) onto the export. */
  useLogo: boolean;
};

export type SocialExportResponse = {
  media: {
    _id: string;
    url: string;
    type: "image";
    mimeType: string;
    filename: string;
    size: number;
    width: number;
    height: number;
    alt?: string;
  };
  size: { key: SocialExportSizeKey; width: number; height: number };
};
