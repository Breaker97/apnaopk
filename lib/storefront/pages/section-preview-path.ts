/**
 * The chrome-less per-section preview route (`/{locale}/section-preview/…`),
 * shared by the pieces that must recognise it without importing anything
 * server-side: the root layout (to skip app-wide providers), the client
 * instrumentation (to keep analytics out of preview frames) and the preview
 * redirect that builds its URLs.
 */
export const SECTION_PREVIEW_SEGMENT = "section-preview";

export function isSectionPreviewPath(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  const path = pathname.split("?", 1)[0];
  return new RegExp(`^/[A-Za-z-]+/${SECTION_PREVIEW_SEGMENT}(/|$)`).test(path);
}
