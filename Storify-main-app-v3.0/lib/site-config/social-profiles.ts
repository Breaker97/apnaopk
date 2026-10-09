/**
 * A vendor's own social profiles, shown under "Online" in the Store information
 * panel on their storefront.
 *
 * A list rather than fixed website/facebook/instagram/twitter columns, because
 * which platforms matter differs per seller — a fashion store lives on Instagram
 * and TikTok, a B2B supplier on LinkedIn. `other` covers anything not listed, so
 * the shape never has to grow for a new network.
 *
 * Distinct from `shareSettings`, which decides which buttons a *shopper* gets
 * when sharing the store. These are the vendor's own destinations.
 */
export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "x",
  "youtube",
  "tiktok",
  "linkedin",
  "pinterest",
  "whatsapp",
  "telegram",
  "other",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type SocialProfile = {
  id: string;
  platform: SocialPlatform;
  /** Required for `other`, ignored otherwise — the platform supplies the name. */
  label?: string;
  url: string;
};

/** Display names for the known platforms. `other` falls back to the label. */
export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X / Twitter",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  other: "Other",
};

/** Placeholder URLs, so the expected format is obvious in the settings form. */
export const SOCIAL_PLATFORM_PLACEHOLDERS: Record<SocialPlatform, string> = {
  facebook: "https://facebook.com/your-page",
  instagram: "https://instagram.com/your-handle",
  x: "https://x.com/your-handle",
  youtube: "https://youtube.com/@your-channel",
  tiktok: "https://tiktok.com/@your-handle",
  linkedin: "https://linkedin.com/company/your-company",
  pinterest: "https://pinterest.com/your-handle",
  whatsapp: "https://wa.me/8801700000000",
  telegram: "https://t.me/your-handle",
  other: "https://…",
};

export const MAX_SOCIAL_PROFILES = 12;

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value as string);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Human-readable name for a profile: the platform's name, or the vendor's own
 * label for `other`. Used as the icon button's accessible name, so it is never
 * empty.
 */
export function socialProfileLabel(profile: SocialProfile): string {
  if (profile.platform === "other") {
    return text(profile.label) || "Link";
  }
  return SOCIAL_PLATFORM_LABELS[profile.platform];
}

/**
 * Coerce stored/submitted data into a clean list.
 *
 * Drops anything without a URL, caps the length, and assigns stable ids so React
 * keys and the settings form's row identity survive a round trip.
 */
export function resolveSocialProfiles(value: unknown): SocialProfile[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((raw, index) => {
      const item = (raw ?? {}) as Partial<SocialProfile>;
      const platform = isSocialPlatform(item.platform) ? item.platform : "other";
      const label = text(item.label);

      return {
        id: text(item.id) || `social-${index + 1}`,
        platform,
        label: platform === "other" ? label || undefined : undefined,
        url: text(item.url),
      };
    })
    .filter((item) => item.url.length > 0)
    .slice(0, MAX_SOCIAL_PROFILES);
}

/**
 * Legacy `socialLinks.facebook/instagram/twitter` promoted to the list shape.
 *
 * Lets vendors who filled the old fixed fields keep their links with no
 * migration: the list is used when present, and this fills in when it is not.
 */
export function socialProfilesFromLegacyLinks(links: {
  facebook?: string;
  instagram?: string;
  twitter?: string;
}): SocialProfile[] {
  const mapping: Array<[SocialPlatform, string | undefined]> = [
    ["facebook", links.facebook],
    ["instagram", links.instagram],
    ["x", links.twitter],
  ];

  return mapping
    .filter(([, url]) => text(url).length > 0)
    .map(([platform, url]) => ({
      id: `legacy-${platform}`,
      platform,
      url: text(url),
    }));
}
