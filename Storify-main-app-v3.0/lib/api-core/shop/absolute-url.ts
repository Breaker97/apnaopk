import { appBaseUrl } from "@/lib/app-url";

/**
 * A stored URL as the app can load it: an upload kept as a path on this
 * store's own address is made absolute; anything that is not http(s) is left
 * out. For what is not a picture to resize (a picture goes through
 * `imageSet`).
 */
export function absoluteUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, `${appBaseUrl()}/`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
