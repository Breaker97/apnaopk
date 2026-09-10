import { AnnouncementBar } from "@/components/store/sections/announcement-bar";
import { HeaderBar, FooterBar } from "@/components/store/sections/header-chrome";
import { readAnnouncementStyle } from "@/lib/site-config/announcement-style";
import { normalizeBackground } from "@/lib/sliders/types";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

/**
 * The header/footer GROUP sections (P8). The bars are locked cores whose
 * bodies stay with the classic header/footer settings forms — the group
 * document decides what renders AROUND them: the announcement bar above,
 * the top-tags strip below, and whatever joins them later.
 */

export const headerBar: SectionDefinition = {
  type: "header-bar",
  version: 1,
  category: "more",
  zones: ["header"],
  required: true,
  locked: true,
  maxPerPage: 1,
  fields: [],
  Render({ ctx }) {
    return <HeaderBar locale={ctx.locale} />;
  },
};

export const footerBar: SectionDefinition = {
  type: "footer-bar",
  version: 1,
  category: "more",
  zones: ["footer"],
  required: true,
  locked: true,
  maxPerPage: 1,
  fields: [],
  Render({ ctx }) {
    return <FooterBar locale={ctx.locale} />;
  },
};

/**
 * The chrome rows' own shape and type, edited from the Header Studio's
 * "Announcement bar" and "Top tags" rows (and, field by field, on
 * Customize). Flat because the field vocabulary is flat; the studio folds
 * them back into one alignment and one text style.
 */
const CHROME_ALIGN_OPTIONS = ["start", "center", "end"] as const;
const ANNOUNCEMENT_WEIGHT_OPTIONS = [
  "400",
  "500",
  "600",
  "700",
  "800",
] as const;
const ANNOUNCEMENT_TRANSFORM_OPTIONS = [
  "none",
  "uppercase",
  "capitalize",
] as const;

export const announcementBar: SectionDefinition = {
  type: "announcement-bar",
  // v2: `backgroundColor` (a hex) became `background` (solid | gradient |
  // image). v3: the bar gained a height, an alignment and a full text style,
  // and `textColor` (a hex) became `textFill` (solid | gradient). Both
  // migrate steps fold the old key in, so a bar saved before either change
  // keeps its look.
  version: 3,
  category: "promotions",
  zones: ["header"],
  maxPerPage: 1,
  fields: [
    { key: "text", type: "text", translatable: true, default: "" },
    { key: "url", type: "url", default: "" },
    // Unset means the theme's primary scheme — no hardcoded brand color.
    { key: "background", type: "background" },
    // 0 lets the bar size to its text.
    { key: "height", type: "number", default: 0, min: 0, max: 200 },
    {
      key: "alignHorizontal",
      type: "select",
      options: CHROME_ALIGN_OPTIONS,
      default: "center",
    },
    {
      key: "alignVertical",
      type: "select",
      options: CHROME_ALIGN_OPTIONS,
      default: "center",
    },
    // Unset keeps the bar's own foreground.
    { key: "textFill", type: "background" },
    { key: "fontSize", type: "number", default: 13, min: 8, max: 40 },
    {
      key: "fontWeight",
      type: "select",
      options: ANNOUNCEMENT_WEIGHT_OPTIONS,
      default: "500",
    },
    { key: "letterSpacing", type: "number", default: 0, min: -5, max: 20 },
    {
      key: "textTransform",
      type: "select",
      options: ANNOUNCEMENT_TRANSFORM_OPTIONS,
      default: "none",
    },
    { key: "italic", type: "toggle", default: false },
    { key: "underline", type: "toggle", default: false },
  ],
  migrate(instance) {
    const { backgroundColor, textColor, ...settings } = instance.settings;
    const background =
      settings.background && typeof settings.background === "object"
        ? settings.background
        : typeof backgroundColor === "string" && backgroundColor
          ? { type: "solid", color: backgroundColor }
          : { type: "solid" };
    return {
      ...instance,
      settings: {
        ...settings,
        background,
        textFill:
          settings.textFill && typeof settings.textFill === "object"
            ? settings.textFill
            : typeof textColor === "string" && textColor
              ? { type: "solid", color: textColor }
              : { type: "solid" },
      },
    };
  },
  Render({ settings, ctx }) {
    return (
      <AnnouncementBar
        locale={ctx.locale}
        text={lt(
          settings.text as LocalizedText,
          ctx.locale,
          ctx.defaultLanguage,
        )}
        href={(settings.url as string) ?? ""}
        background={normalizeBackground(settings.background)}
        style={readAnnouncementStyle(settings)}
      />
    );
  },
};

/**
 * The strip's own paint and type, edited from the Header Studio's "Top tags"
 * row (and, field by field, on Customize). Kept flat because the field
 * vocabulary is flat; the studio folds the type fields into one text style.
 */
const TOP_TAGS_JUSTIFY_OPTIONS = [
  "start",
  "center",
  "end",
  "between",
  "around",
  "evenly",
] as const;
const TOP_TAGS_WEIGHT_OPTIONS = ["400", "500", "600", "700", "800"] as const;
const TOP_TAGS_TRANSFORM_OPTIONS = ["none", "uppercase", "capitalize"] as const;

export const topTags: SectionDefinition = {
  type: "top-tags",
  // v2: the strip gained an alignment, and `textColor` (a hex) became
  // `textFill` (solid | gradient).
  version: 2,
  category: "content",
  zones: ["header"],
  maxPerPage: 1,
  fields: [
    {
      key: "justify",
      type: "select",
      options: TOP_TAGS_JUSTIFY_OPTIONS,
      default: "start",
    },
    // 0 lets the strip size to its text.
    { key: "height", type: "number", default: 0, min: 0, max: 200 },
    // Unset keeps the header's own background.
    { key: "background", type: "background" },
    // Vertical only: the horizontal axis is `justify`'s.
    {
      key: "alignVertical",
      type: "select",
      options: CHROME_ALIGN_OPTIONS,
      default: "center",
    },
    { key: "textFill", type: "background" },
    { key: "fontSize", type: "number", default: 13, min: 8, max: 40 },
    {
      key: "fontWeight",
      type: "select",
      options: TOP_TAGS_WEIGHT_OPTIONS,
      default: "500",
    },
    { key: "letterSpacing", type: "number", default: 0, min: -5, max: 20 },
    {
      key: "textTransform",
      type: "select",
      options: TOP_TAGS_TRANSFORM_OPTIONS,
      default: "none",
    },
    { key: "italic", type: "toggle", default: false },
    { key: "underline", type: "toggle", default: false },
  ],
  blocks: [
    {
      type: "tag",
      max: 12,
      fields: [
        { key: "label", type: "text", translatable: true, default: "" },
        { key: "url", type: "url", default: "" },
      ],
    },
  ],
  starter: { blocks: [{ type: "tag" }, { type: "tag" }, { type: "tag" }] },
  migrate(instance) {
    const { textColor, ...settings } = instance.settings;
    return {
      ...instance,
      settings: {
        ...settings,
        textFill:
          settings.textFill && typeof settings.textFill === "object"
            ? settings.textFill
            : typeof textColor === "string" && textColor
              ? { type: "solid", color: textColor }
              : { type: "solid" },
      },
    };
  },
  // Retired: the strip is an ordinary row of the header layout tree now —
  // two Nav Links items, tags at the start and utility links at the end —
  // edited in Header Studio with everything else. Documents that still carry
  // an instance keep it (the migration above still runs) but it paints
  // nothing, so a store never shows the row twice.
  Render() {
    return null;
  },
};
