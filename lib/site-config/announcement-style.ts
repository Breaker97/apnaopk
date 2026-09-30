import type { CSSProperties } from "react";
import { normalizeBackground } from "@/lib/sliders/background";
import {
  HEADER_ALIGNMENTS,
  HEADER_TEXT_TRANSFORMS,
  inheritFill,
  MAX_HEADER_ROW_PADDING,
  type HeaderAlignment,
  type HeaderFill,
  type HeaderPadding,
  type HeaderTextStyle,
} from "@/lib/site-config/header-layout";
import {
  alignItemsValue,
  fillTextCss,
  justifyContentValue,
  paddingStyle,
  textAlignValue,
  textStyleCss,
} from "@/lib/site-config/header-layout-style";
import {
  readNumber,
  readOneOf,
} from "@/lib/site-config/normalize-primitives";

/**
 * The announcement bar's shape and type, as one object. The bar is a
 * horizontal row like any other in the
 * header, so it carries the same three settings a row does: a height, the
 * alignment matrix that seats its message inside that height, and one text
 * style (its colour included) for the message.
 *
 * The section stores these as flat fields, because the field vocabulary is
 * flat; this is the shape the storefront bar, the studio preview and the
 * property panel all consume.
 */
export interface AnnouncementStyle {
  /** 0 lets the bar size to its text. */
  height: number;
  align: HeaderAlignment;
  textStyle: HeaderTextStyle;
  /**
   * The bar's own inset. It used to be a `px-4 py-2` in the component, so
   * the strip's thickness could only be pushed UP with a height and never
   * closed in — and the 8px under the message read as a gap before the nav
   * that nothing could reach.
   */
  padding: HeaderPadding;
  /**
   * Clear space between the bar and the header under it, px. Stated on the
   * bar for the same reason a header row states its own: the thing above
   * owns the edge beneath it.
   */
  spaceBelow: number;
}

export function defaultAnnouncementStyle(): AnnouncementStyle {
  return {
    height: 0,
    // Centred is what the bar has always painted, so a bar saved before it
    // had an alignment keeps its look.
    align: { horizontal: "center", vertical: "center" },
    textStyle: {
      fontSize: 13,
      fontWeight: 500,
      letterSpacing: 0,
      transform: "none",
      italic: false,
      underline: false,
      fill: inheritFill(),
    },
    // Exactly the `px-4 py-2` the component used to hard-code, so a bar
    // saved before it had a padding draws what it always drew.
    padding: { top: 8, right: 16, bottom: 8, left: 16 },
    spaceBelow: 0,
  };
}

/**
 * The message's fill, from either shape a stored bar may carry: the
 * `textFill` object, or the `textColor` hex the bar stored before its colour
 * could be a gradient.
 */
function readTextFill(settings: Record<string, unknown>): HeaderFill {
  if (settings.textFill && typeof settings.textFill === "object") {
    return normalizeBackground(settings.textFill);
  }
  return typeof settings.textColor === "string" && settings.textColor
    ? normalizeBackground({ type: "solid", color: settings.textColor })
    : inheritFill();
}

export function readAnnouncementStyle(
  settings: Record<string, unknown>,
): AnnouncementStyle {
  const base = defaultAnnouncementStyle();
  const transform = settings.textTransform;
  return {
    height: readNumber(settings.height, base.height, 0, 200),
    align: {
      horizontal: readOneOf(settings.alignHorizontal, HEADER_ALIGNMENTS, base.align.horizontal),
      vertical: readOneOf(settings.alignVertical, HEADER_ALIGNMENTS, base.align.vertical),
    },
    textStyle: {
      fontSize: readNumber(settings.fontSize, base.textStyle.fontSize, 8, 40),
      fontWeight: readNumber(settings.fontWeight, base.textStyle.fontWeight, 100, 900),
      letterSpacing: readNumber(
        settings.letterSpacing,
        base.textStyle.letterSpacing,
        -5,
        20,
      ),
      transform: HEADER_TEXT_TRANSFORMS.includes(
        transform as HeaderTextStyle["transform"],
      )
        ? (transform as HeaderTextStyle["transform"])
        : base.textStyle.transform,
      italic: settings.italic === true,
      underline: settings.underline === true,
      fill: readTextFill(settings),
    },
    padding: {
      top: readNumber(settings.paddingTop, base.padding.top, 0, MAX_HEADER_ROW_PADDING),
      right: readNumber(settings.paddingRight, base.padding.right, 0, MAX_HEADER_ROW_PADDING),
      bottom: readNumber(settings.paddingBottom, base.padding.bottom, 0, MAX_HEADER_ROW_PADDING),
      left: readNumber(settings.paddingLeft, base.padding.left, 0, MAX_HEADER_ROW_PADDING),
    },
    spaceBelow: readNumber(settings.spaceBelow, base.spaceBelow, 0, MAX_HEADER_ROW_PADDING),
  };
}

export function writeAnnouncementStyle(
  style: AnnouncementStyle,
): Record<string, unknown> {
  return {
    height: Math.round(style.height),
    alignHorizontal: style.align.horizontal,
    alignVertical: style.align.vertical,
    textFill: style.textStyle.fill,
    fontSize: Math.round(style.textStyle.fontSize),
    // Stored as a select option, so it must be one of the listed weights.
    fontWeight: String(
      Math.min(
        800,
        Math.max(400, Math.round(style.textStyle.fontWeight / 100) * 100),
      ),
    ),
    letterSpacing: Math.round(style.textStyle.letterSpacing),
    textTransform: style.textStyle.transform,
    italic: style.textStyle.italic,
    underline: style.textStyle.underline,
    paddingTop: Math.round(style.padding.top),
    paddingRight: Math.round(style.padding.right),
    paddingBottom: Math.round(style.padding.bottom),
    paddingLeft: Math.round(style.padding.left),
    spaceBelow: Math.round(style.spaceBelow),
  };
}

/** The bar itself: its height, and where the message sits inside it. */
export function announcementBarCss(style: AnnouncementStyle): CSSProperties {
  return {
    display: "flex",
    minHeight: style.height || undefined,
    justifyContent: justifyContentValue(style.align.horizontal),
    alignItems: alignItemsValue(style.align.vertical),
    textAlign: textAlignValue(style.align.horizontal),
    ...paddingStyle(style.padding),
    ...(style.spaceBelow ? { marginBottom: style.spaceBelow } : {}),
  };
}

/** The message's type, its colour included (a gradient clips to the glyphs). */
export function announcementTextCss(style: AnnouncementStyle): CSSProperties {
  return {
    ...textStyleCss(style.textStyle),
    ...fillTextCss(style.textStyle.fill),
  };
}
