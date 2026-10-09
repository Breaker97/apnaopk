import { getStorageConfig } from "@/lib/storage";

/**
 * Validate that a URL is served from this store's own configured storage
 * origin. Guards against SSRF for any server-side fetch of a client-supplied
 * image URL (AI edit source, download proxy), and tells the vendor import a
 * logo it already holds from one it still has to download. Returns the
 * parsed URL.
 *
 * Lives here rather than in the AI studio's media module so a caller that only
 * needs this check does not load the OpenAI client with it.
 */
export async function assertOwnStorageUrl(sourceUrl: string): Promise<URL> {
  const appOrigin = (
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).replace(/\/$/, "");

  let url: URL;
  try {
    // Local storage serves same-site paths ("/uploads/…") when no public/CDN
    // base is set, so resolve those against this app's own origin. A
    // protocol-relative "//host/…" is another origin and is parsed as such, so
    // it still has to clear the allowlist below.
    url =
      sourceUrl.startsWith("/") && !sourceUrl.startsWith("//")
        ? new URL(sourceUrl, appOrigin)
        : new URL(sourceUrl);
  } catch {
    throw new Error("Invalid source image URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Invalid source image URL");
  }

  const config = await getStorageConfig();
  const allowedOrigins = new Set<string>();
  for (const candidate of [config.publicUrl, config.endpoint]) {
    if (!candidate) continue;
    try {
      allowedOrigins.add(new URL(candidate).origin);
    } catch {
      // Ignore a malformed configured URL rather than failing the whole edit.
    }
  }
  // Local storage is served by this app itself, so its own origin *is* the
  // storage origin. Without this, a local-storage store has no allowed origin
  // at all and every edit fails.
  if (config.provider === "local") {
    try {
      allowedOrigins.add(new URL(appOrigin).origin);
    } catch {
      // A malformed NEXT_PUBLIC_APP_URL just means no extra origin is allowed.
    }
  }
  if (config.bucketName && config.region && config.region !== "auto") {
    allowedOrigins.add(
      `https://${config.bucketName}.s3.${config.region}.amazonaws.com`,
    );
    allowedOrigins.add(`https://s3.${config.region}.amazonaws.com`);
  }
  if (!allowedOrigins.has(url.origin)) {
    throw new Error("Source image must be an image uploaded to this store");
  }
  return url;
}
