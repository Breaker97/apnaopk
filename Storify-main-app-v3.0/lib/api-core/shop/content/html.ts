import { sanitizeHtml } from "@/lib/sanitize";
import { absoluteUrl } from "../absolute-url";

/**
 * A picture's `src` as sanitize-html writes it (double quotes, always), when
 * it is a path on the store's own address: `/uploads/a.png`. Not `//host`,
 * which the sanitizer has already dropped.
 */
const OWN_PICTURE = /(<img\b[^>]*?\ssrc=")(\/(?!\/)[^"]*)(")/gi;

/**
 * The merchant's rich text as the app is sent it: sanitized with the website's
 * own allow-list (lib/sanitize.ts), and with each picture uploaded to the
 * store at an absolute address, since the app has no page address to read a
 * path against. Links stay as written: a path is a page of the store, which
 * the app opens by its link table.
 */
export function appHtml(content: string | null | undefined): string {
  return sanitizeHtml(content).replace(OWN_PICTURE, (match, before: string, path: string, after: string) => {
    const url = absoluteUrl(path);
    return url ? `${before}${url}${after}` : match;
  });
}
