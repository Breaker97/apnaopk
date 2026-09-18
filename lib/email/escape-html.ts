/**
 * Escape text for an HTML email body or attribute. Every email builder that
 * interpolates something a person typed — a shopper's note, a vendor's store
 * name, a return reason — goes through this one copy.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
