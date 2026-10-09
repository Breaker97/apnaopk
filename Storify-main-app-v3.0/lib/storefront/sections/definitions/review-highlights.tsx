import { ReviewHighlights } from "@/components/store/sections/review-highlights";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { TileRowSkeleton } from "@/components/store/sections/section-skeletons";
import {
  REVIEW_HIGHLIGHT_SORTS,
  REVIEW_HIGHLIGHT_SOURCES,
  type ReviewHighlightSort,
} from "@/lib/vendors/vendor-review-highlights";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

/**
 * Review Highlights — a vendor's landing page only. Quotes the store's own
 * approved reviews; the vendor picks the rule and the count, or the reviews
 * themselves, never the words (there is no free-text testimonial a store
 * could invent).
 */
export const reviewHighlights: SectionDefinition = {
  type: "review-highlights",
  version: 1,
  category: "content",
  vendorOnly: true,
  fields: [
    { key: "title", type: "text", translatable: true, default: "What our customers say" },
    // Absent on pages saved before hand-picking existed, so they read as the
    // rule they were built with.
    {
      key: "source",
      type: "select",
      options: REVIEW_HIGHLIGHT_SOURCES,
      default: "auto",
      hint: "By a rule, or the reviews you pick.",
    },
    {
      key: "reviewOrder",
      type: "select",
      options: REVIEW_HIGHLIGHT_SORTS,
      default: "bestRated",
      hint: "Best rated first, or the newest first.",
      showWhen: { key: "source", values: ["auto"] },
    },
    {
      key: "minRating",
      type: "number",
      default: 4,
      min: 1,
      max: 5,
      hint: "Only reviews with at least this many stars.",
      showWhen: { key: "source", values: ["auto"] },
    },
    {
      key: "limit",
      type: "number",
      default: 6,
      min: 1,
      max: 12,
      showWhen: { key: "source", values: ["auto"] },
    },
    {
      key: "reviewIds",
      type: "reviewList",
      max: 12,
      hint: "Drag to set the order they appear in.",
      showWhen: { key: "source", values: ["manual"] },
    },
    { key: "showProduct", type: "toggle", default: true },
  ],
  // Hand-picked with nothing picked: nothing to quote.
  isEmpty: ({ settings }) =>
    settings.source === "manual" &&
    !(Array.isArray(settings.reviewIds) && settings.reviewIds.some(Boolean)),
  Render({ settings, ctx }) {
    if (!ctx.vendor) return null;
    const manual = settings.source === "manual";
    return (
      <ReviewHighlights
        locale={ctx.locale}
        vendorId={ctx.vendor.id}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        sort={settings.reviewOrder as ReviewHighlightSort}
        minRating={settings.minRating as number}
        limit={settings.limit as number}
        reviewIds={manual ? (settings.reviewIds as string[]) : undefined}
        showProduct={settings.showProduct !== false}
        emptyState={sectionEmptyState(ctx, {
          title: "Review highlights",
          hint: manual
            ? "Pick the reviews to show. Only approved reviews of your products can be picked."
            : "No reviews match yet. They appear here once buyers review your products — lower the minimum stars to show more.",
        })}
      />
    );
  },
  Skeleton: () => <TileRowSkeleton tiles={3} />,
};
