"use client";

import { useTranslations } from "next-intl";

/**
 * All user-facing studio chrome strings in one place, resolved through
 * next-intl with the shipped English as the guaranteed fallback (locales
 * other than en fall back automatically via message merging; this guard also
 * covers a missing key in en itself). Add the keys under `aiStudio.*`.
 */
export function useStudioStrings() {
  const t = useTranslations();
  /**
   * `values` must be passed for any key whose message carries ICU
   * placeholders — next-intl reports a FORMATTING_ERROR (and returns the key)
   * when one is missing, so the fallback would win on every render. The same
   * values are interpolated into `fallback`, which uses the identical
   * `{name}` placeholders.
   */
  const tSafe = (
    key: string,
    fallback: string,
    values?: Record<string, string | number>,
  ) => {
    const filled = values
      ? Object.entries(values).reduce(
          (acc, [name, value]) => acc.split(`{${name}}`).join(String(value)),
          fallback,
        )
      : fallback;
    try {
      const translate = t as unknown as (
        k: string,
        v?: Record<string, string | number>,
      ) => string;
      const res = translate(key, values);
      return typeof res === "string" && res !== key ? res : filled;
    } catch {
      return filled;
    }
  };

  return {
    breadcrumbTitle: tSafe("aiStudio.breadcrumbTitle", "AI Image Studio"),
    mediaTitle: tSafe("aiStudio.mediaTitle", "Media"),
    quickPromptTitle: tSafe("aiStudio.quickPromptTitle", "Quick Prompt"),
    uploadImage: tSafe("aiStudio.uploadImage", "Upload Image"),
    badgeAi: tSafe("aiStudio.badgeAi", "AI"),
    badgeEdited: tSafe("aiStudio.badgeEdited", "Edited"),
    tabQuickPrompt: tSafe("aiStudio.tabQuickPrompt", "Quick Prompt"),
    tabEffects: tSafe("aiStudio.tabEffects", "Effects"),
    categoryPlaceholder: tSafe("aiStudio.categoryPlaceholder", "Category"),
    removeBackground: tSafe("aiStudio.removeBackground", "Remove Background"),
    enhance: tSafe("aiStudio.enhance", "Enhance"),
    upscale: tSafe("aiStudio.upscale", "Upscale"),
    eraseObject: tSafe("aiStudio.eraseObject", "Erase Object"),
    resize: tSafe("aiStudio.resize", "Resize"),
    expand: tSafe("aiStudio.expand", "Expand"),
    fit: tSafe("aiStudio.fit", "Fit"),
    compare: tSafe("aiStudio.compare", "Compare"),
    zoomIn: tSafe("aiStudio.zoomIn", "Zoom in"),
    zoomOut: tSafe("aiStudio.zoomOut", "Zoom out"),
    holdToViewOriginal: tSafe(
      "aiStudio.holdToViewOriginal",
      "Hold to view the original",
    ),
    previewAsCard: tSafe(
      "aiStudio.previewAsCard",
      "Preview as storefront card",
    ),
    exitPreview: tSafe("aiStudio.exitPreview", "Exit storefront preview"),
    previewCardHint: tSafe(
      "aiStudio.previewCardHint",
      "Preview mode — see exactly how this image looks on your live product card.",
    ),
    deleteImage: tSafe("aiStudio.deleteImage", "Delete this image"),
    openMediaPanel: tSafe("aiStudio.openMediaPanel", "Open media panel"),
    openQuickPrompts: tSafe(
      "aiStudio.openQuickPrompts",
      "Open quick prompts panel",
    ),
    cancel: tSafe("aiStudio.cancel", "Cancel"),
    noImageTitle: tSafe("aiStudio.noImageTitle", "No image selected"),
    noImageBody: tSafe(
      "aiStudio.noImageBody",
      "Pick an image from Media, upload one, or describe an image in the prompt below and let AI generate it.",
    ),
    uploadImageAction: tSafe("aiStudio.uploadImageAction", "Upload image"),
    before: tSafe("aiStudio.before", "Before"),
    after: tSafe("aiStudio.after", "After"),
    original: tSafe("aiStudio.original", "Original"),
    busyHint: tSafe("aiStudio.busyHint", "This usually takes 10–30 seconds"),
    discardTitle: tSafe("aiStudio.discardTitle", "Discard changes?"),
    discardBody: tSafe(
      "aiStudio.discardBody",
      "Your edited images haven't been saved yet. If you leave now, they'll be lost.",
    ),
    keepEditing: tSafe("aiStudio.keepEditing", "Keep editing"),
    discard: tSafe("aiStudio.discard", "Discard"),
    restoredDraft: tSafe(
      "aiStudio.restoredDraft",
      "Restored your unsaved changes",
    ),
    placeholderErase: tSafe(
      "aiStudio.placeholderErase",
      "Describe what to erase, e.g. the shadow on the left. Everything else stays unchanged.",
    ),
    placeholderGenerate: tSafe(
      "aiStudio.placeholderGenerate",
      "Describe the image you want and AI will generate it.",
    ),
    /** Template — caller substitutes the subject noun. */
    placeholderEdit: (subject: string) =>
      tSafe(
        "aiStudio.placeholderEdit",
        "Describe the result you want. Your {subject} stays unchanged.",
        { subject },
      ),
    applyEdit: tSafe("aiStudio.applyEdit", "Apply edit"),
    generateImage: tSafe("aiStudio.generateImage", "Generate image"),
    autoGenerate: tSafe("aiStudio.autoGenerate", "Auto Generate"),
    toneLabel: tSafe("aiStudio.toneLabel", "Tone"),
    defaultTone: tSafe("aiStudio.defaultTone", "Default tone"),
    /**
     * Data-driven preset/size labels. The English label shipped in
     * `studio-presets.ts` is the fallback and is what the model prompt uses;
     * these keys only localize what the user sees. A new preset works with no
     * i18n key at all (falls back to its English label).
     */
    sizeLabel: (key: string, fallback: string) =>
      tSafe(`aiStudio.sizes.${key}`, fallback),
    presetCategoryLabel: (key: string, fallback: string) =>
      tSafe(`aiStudio.presets.categories.${key}`, fallback),
    presetLabel: (key: string, fallback: string) =>
      tSafe(`aiStudio.presets.labels.${key}`, fallback),
    exportButton: tSafe("aiStudio.export.button", "Export"),
    exportIncludeLogo: tSafe("aiStudio.export.includeLogo", "Include brand logo"),
    exportFill: tSafe("aiStudio.export.fill", "Fill frame"),
    exportFit: tSafe("aiStudio.export.fit", "Fit on brand color"),
    exportSizeLabel: (key: string, fallback: string) =>
      tSafe(`aiStudio.export.sizes.${key}`, fallback),
  };
}

