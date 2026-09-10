/**
 * Share-button configuration.
 *
 * Admins manage these toggles from Admin → Settings → Social / Links
 * ("Share Buttons" card). Product pages and vendor profiles render only the
 * channels that are enabled by their active share config.
 */

export interface CustomShareButton {
  /** Stable id used as a React key and to track edits. */
  id: string;
  /** Display label / accessible name, e.g. "Reddit". */
  label: string;
  /**
   * Share link. Supports the tokens {url}, {title} and {image}, which are
   * URL-encoded and substituted at render time. When no token is present the
   * current page URL is appended as a `url` query param.
   */
  urlTemplate: string;
  enabled: boolean;
  /** Optional uploaded icon URL. Falls back to a generic share glyph. */
  icon?: string;
}

export interface ShareSettings {
  /** Master toggle — when off, no share buttons render on product pages. */
  enabled: boolean;
  /** "Copy link" button. */
  copyLink: boolean;
  facebook: boolean;
  twitter: boolean;
  whatsapp: boolean;
  telegram: boolean;
  pinterest: boolean;
  linkedin: boolean;
  email: boolean;
  /** Custom share platforms. */
  custom: CustomShareButton[];
}

export const DEFAULT_SHARE_SETTINGS: ShareSettings = {
  enabled: true,
  copyLink: true,
  facebook: true,
  twitter: true,
  whatsapp: true,
  telegram: false,
  pinterest: false,
  linkedin: false,
  email: true,
  custom: [],
};

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeCustom(value: unknown): CustomShareButton[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === "object"),
    )
    .map((entry, index) => ({
      id: toString(entry.id) || `custom-${index}`,
      label: toString(entry.label),
      urlTemplate: toString(entry.urlTemplate),
      enabled: toBoolean(entry.enabled, true),
      icon: toString(entry.icon),
    }));
}

/**
 * Normalize a partial/unknown share config into a complete, defaulted object.
 * Safe to call with `undefined`, a Mongoose sub-document, or a plain object.
 */
export function resolveShareSettings(source: unknown): ShareSettings {
  const obj =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};

  return {
    enabled: toBoolean(obj.enabled, DEFAULT_SHARE_SETTINGS.enabled),
    copyLink: toBoolean(obj.copyLink, DEFAULT_SHARE_SETTINGS.copyLink),
    facebook: toBoolean(obj.facebook, DEFAULT_SHARE_SETTINGS.facebook),
    twitter: toBoolean(obj.twitter, DEFAULT_SHARE_SETTINGS.twitter),
    whatsapp: toBoolean(obj.whatsapp, DEFAULT_SHARE_SETTINGS.whatsapp),
    telegram: toBoolean(obj.telegram, DEFAULT_SHARE_SETTINGS.telegram),
    pinterest: toBoolean(obj.pinterest, DEFAULT_SHARE_SETTINGS.pinterest),
    linkedin: toBoolean(obj.linkedin, DEFAULT_SHARE_SETTINGS.linkedin),
    email: toBoolean(obj.email, DEFAULT_SHARE_SETTINGS.email),
    custom: normalizeCustom(obj.custom),
  };
}

/**
 * Build a final share URL for a custom platform by substituting tokens.
 * Falls back to appending the current page URL when the template has no token.
 */
export function buildCustomShareUrl(
  template: string,
  values: { url: string; title: string; image?: string },
): string {
  const trimmed = template.trim();
  if (!trimmed) return "";
  if (/\{(url|title|image)\}/.test(trimmed)) {
    return trimmed
      .replace(/\{url\}/g, encodeURIComponent(values.url))
      .replace(/\{title\}/g, encodeURIComponent(values.title))
      .replace(/\{image\}/g, encodeURIComponent(values.image ?? ""));
  }
  const sep = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${sep}url=${encodeURIComponent(values.url)}`;
}
