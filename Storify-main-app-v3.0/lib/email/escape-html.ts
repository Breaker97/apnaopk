/**
 * Escape text for an HTML email body or attribute. Every email builder that
 * interpolates something a person typed — a shopper's note, a vendor's store
 * name, a return reason — goes through this one copy. A missing value is "".
 */
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A link someone typed, ready for an email's `href`: an http(s) URL, escaped,
 * or nothing — a `javascript:` or `data:` link is left out rather than sent.
 */
export function emailLinkHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? escapeHtml(url.toString())
      : undefined;
  } catch {
    return undefined;
  }
}
