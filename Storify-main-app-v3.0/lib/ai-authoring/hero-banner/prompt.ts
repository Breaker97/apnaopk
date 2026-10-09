import type { HeroBannerBrief, HeroBannerRequest } from "./types";

export function buildHeroBannerVisualPrompt(
  request: HeroBannerRequest,
  brief: HeroBannerBrief,
): string {
  const hasOverlay = Boolean(
    brief.headline || brief.subheadline || brief.price || brief.cta,
  );
  const editRule =
    request.operation === "edit"
      ? hasOverlay
        ? "Remove existing promotional typography so the deterministic overlay can replace it cleanly."
        : "Preserve existing meaningful typography unless the edit instruction asks to change it."
      : "Create a new coherent campaign visual.";
  return [
    "Create a high-resolution wide ecommerce hero banner composition.",
    "The final crop is an extremely wide 1360:314 ratio; keep important content away from the top, bottom, and outer edges.",
    `Visual direction: ${brief.visualDescription}`,
    brief.style ? `Style: ${brief.style}` : "",
    brief.background ? `Background: ${brief.background}` : "",
    `Place the main subject on the ${brief.subjectPlacement}.`,
    `Leave a clean text-safe region on the ${brief.textPlacement}.`,
    editRule,
    "Do not render any headline, price, CTA, watermark, or extra promotional text; exact text is composited later.",
    "Do not invent product claims, prices, discounts, logos, or unrelated products.",
    "Use an opaque professional ecommerce background with natural lighting and enough horizontal continuation for cropping.",
  ]
    .filter(Boolean)
    .join("\n");
}
