import {
  clampAutoplaySeconds,
  MAX_SLIDER_HISTORY,
  normalizeSliderControls,
  normalizeSlides,
  type SliderContent,
  type SliderDocument,
  type SliderHistoryEntry,
} from "./types";

/**
 * What the API does to a slider document — publish, restore, read a draft
 * off the wire — as pure functions, so the routes stay thin and the rules
 * (what goes into history, how long it is, what a restore produces) are
 * unit-tested rather than trusted.
 */

/** Content as the editor sends it, read through the same normalizers as storage. */
export function sliderContentFromInput(raw: unknown): SliderContent {
  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    transition: source.transition === "fade" ? "fade" : "slide",
    autoplaySeconds: clampAutoplaySeconds(source.autoplaySeconds),
    controls: normalizeSliderControls(source.controls),
    slides: normalizeSlides(source.slides),
  };
}

/** The live content of a document, without its name, handle or bookkeeping. */
export function liveContent(doc: SliderDocument): SliderContent {
  return {
    transition: doc.transition,
    autoplaySeconds: doc.autoplaySeconds,
    controls: doc.controls,
    slides: doc.slides,
  };
}

/**
 * Publishing: the draft becomes the live content, and what WAS live goes to
 * the head of the history — stamped with the moment it had gone live, so a
 * restore list reads as dates a version was on the shop, not dates it was
 * replaced. The history holds the last `MAX_SLIDER_HISTORY` versions. With
 * no draft there is nothing to do, and the document comes back as it is.
 */
export function publishSlider(
  doc: SliderDocument,
  now: Date,
): { content: SliderContent; history: SliderHistoryEntry[]; publishedAt: string } | null {
  if (!doc.draft) return null;
  const previous: SliderHistoryEntry = {
    ...liveContent(doc),
    publishedAt:
      doc.publishedAt ??
      (typeof doc.updatedAt === "string"
        ? doc.updatedAt
        : doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : now.toISOString()),
  };
  return {
    content: liveContent({ ...doc, ...doc.draft }),
    history: [previous, ...(doc.history ?? [])].slice(0, MAX_SLIDER_HISTORY),
    publishedAt: now.toISOString(),
  };
}

/**
 * Restoring: a past version becomes the DRAFT, never the live content — the
 * merchant looks at it, and publishes when it is what they meant. Null for
 * an index there is no version at.
 */
export function restoreSliderVersion(
  doc: SliderDocument,
  index: number,
): SliderContent | null {
  const entry = doc.history?.[index];
  if (!entry) return null;
  return {
    transition: entry.transition,
    autoplaySeconds: entry.autoplaySeconds,
    controls: entry.controls,
    slides: entry.slides,
  };
}

/** Whether a draft differs from what is live — what "unpublished changes" means. */
export function sliderHasUnpublishedChanges(doc: SliderDocument): boolean {
  if (!doc.draft) return false;
  const strip = (content: SliderContent) => JSON.stringify(liveContent({ ...doc, ...content }));
  return strip(doc.draft) !== strip(doc);
}
