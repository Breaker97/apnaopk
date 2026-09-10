/**
 * External product videos (Shopify's ExternalVideo equivalent).
 *
 * A product media item of type "external_video" stores the canonical watch
 * URL plus a parsed { provider, embedId } pair, so the storefront never has
 * to re-parse arbitrary URLs at render time and the embed iframe src is
 * always constructed server-agnostically from known-safe templates below —
 * a stored URL can never smuggle a foreign origin into an iframe.
 *
 * Mirrors Shopify's model: only YouTube and Vimeo are supported; anything
 * else must be uploaded as a hosted video instead.
 */

export type ExternalVideoProvider = "youtube" | "vimeo";

interface ParsedExternalVideo {
  provider: ExternalVideoProvider;
  embedId: string;
  /** Canonical watch URL (what we store as media.url). */
  url: string;
  /** Best-effort thumbnail; Vimeo needs an oEmbed lookup so it may be absent. */
  thumbnailUrl?: string;
}

// YouTube video IDs are exactly 11 URL-safe base64 chars.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
// Vimeo IDs are numeric; unlisted videos append a privacy hash we keep as
// part of the embed path ("<id>/<hash>" → player URL "<id>?h=<hash>").
const VIMEO_ID = /^\d+$/;
const VIMEO_HASH = /^[a-f0-9]+$/i;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/**
 * Parse a user-pasted YouTube/Vimeo URL into a validated external video.
 * Returns null for anything that isn't recognizably one of the two.
 */
export function parseExternalVideoUrl(
  input: string,
): ParsedExternalVideo | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    // Tolerate a missing scheme ("youtu.be/xyz") — admins paste those.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  // --- YouTube ---
  let youtubeId: string | null = null;
  if (host === "youtu.be") {
    youtubeId = segments[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === "watch") {
      youtubeId = url.searchParams.get("v");
    } else if (["shorts", "embed", "live", "v"].includes(segments[0] ?? "")) {
      youtubeId = segments[1] ?? null;
    }
  }
  if (youtubeId && YOUTUBE_ID.test(youtubeId)) {
    return {
      provider: "youtube",
      embedId: youtubeId,
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  }

  // --- Vimeo ---
  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    // vimeo.com/<id>[/<hash>], vimeo.com/video/<id>, player.vimeo.com/video/<id>
    const parts = segments[0] === "video" ? segments.slice(1) : segments;
    const id = parts[0];
    const hash =
      parts[1] && VIMEO_HASH.test(parts[1])
        ? parts[1]
        : url.searchParams.get("h") || undefined;
    if (id && VIMEO_ID.test(id)) {
      return {
        provider: "vimeo",
        embedId: hash ? `${id}/${hash}` : id,
        url: hash ? `https://vimeo.com/${id}/${hash}` : `https://vimeo.com/${id}`,
      };
    }
  }

  return null;
}

/**
 * Build the iframe src for a stored external video. Only ever called with the
 * validated { provider, embedId } pair from parseExternalVideoUrl, so the
 * origin is always one of the two hardcoded players (privacy-enhanced
 * youtube-nocookie for YouTube).
 */
export function getExternalVideoEmbedUrl(
  provider: ExternalVideoProvider,
  embedId: string,
  { autoplay = false }: { autoplay?: boolean } = {},
): string {
  if (provider === "youtube") {
    const params = new URLSearchParams({ rel: "0", playsinline: "1" });
    if (autoplay) params.set("autoplay", "1");
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(embedId)}?${params}`;
  }
  const [id, hash] = embedId.split("/");
  const params = new URLSearchParams({ dnt: "1", playsinline: "1" });
  if (hash) params.set("h", hash);
  if (autoplay) params.set("autoplay", "1");
  return `https://player.vimeo.com/video/${encodeURIComponent(id ?? embedId)}?${params}`;
}

/**
 * Resolve a Vimeo thumbnail via their public oEmbed endpoint (CORS-enabled,
 * no API key). Returns null on any failure — an external video without a
 * thumbnail still renders, just with a generic play tile.
 */
export async function fetchVimeoThumbnailUrl(
  videoUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoUrl)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { thumbnail_url?: string };
    return typeof data.thumbnail_url === "string" ? data.thumbnail_url : null;
  } catch {
    return null;
  }
}
