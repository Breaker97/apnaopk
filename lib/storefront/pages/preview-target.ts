import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import { resolveAdminPageRef } from "@/lib/storefront/pages/handles";
import { SECTION_PREVIEW_SEGMENT } from "@/lib/storefront/pages/section-preview-path";

/** Section and block ids as the builder mints them; anything else is dropped. */
const SAFE_ID = /^[\w.:-]+$/;

/**
 * Where the builder's preview frames go.
 *
 * A whole page previews on `/draft…` under the real storefront chrome, so the
 * merchant sees header, footer and theme tokens exactly as shoppers will. ONE
 * section — the frame at the top of every editor row — goes to the
 * chrome-less `/section-preview…` route instead: the row only needs that
 * section's own render, and framing it inside the full storefront cost a
 * 366 KB document, the header/footer/analytics/cart/session boot and 19
 * requests per frame, repeated on every autosave.
 *
 * Chrome groups (header/footer) have no per-section frames — they preview as
 * a whole page — so a section id on a group falls back to the page preview.
 */
export function buildDraftPreviewPath(input: {
  locale: string;
  handle: string;
  section?: string;
  block?: string;
}): string {
  const localePrefix = `/${isValidLocale(input.locale) ? input.locale : defaultLocale}`;
  const ref = resolveAdminPageRef(input.handle);
  const section = input.section && SAFE_ID.test(input.section) ? input.section : "";
  const block = section && input.block && SAFE_ID.test(input.block) ? input.block : "";

  let suffix = "";
  if (ref?.parsed.kind === "landing") {
    suffix = `/${ref.parsed.handle}`;
  } else if (ref?.parsed.kind === "template" && ref.parsed.templateType !== "home") {
    suffix = `/template/${ref.parsed.templateType}`;
  } else if (ref?.parsed.kind === "group") {
    suffix = `/group/${ref.parsed.group}`;
  }

  if (section && ref?.parsed.kind !== "group") {
    const query = new URLSearchParams({ section });
    if (block) query.set("block", block);
    return `${localePrefix}/${SECTION_PREVIEW_SEGMENT}${suffix}?${query.toString()}`;
  }
  return `${localePrefix}/draft${suffix}`;
}
