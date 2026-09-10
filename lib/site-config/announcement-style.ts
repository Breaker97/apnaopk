import type { CSSProperties } from "react";
import { normalizeBackground } from "@/lib/sliders/types";
import {
  HEADER_ALIGNMENTS,
  HEADER_TEXT_TRANSFORMS,
  inheritFill,
  type HeaderAlignment,
  type HeaderFill,
  type HeaderTextStyle,
} from "@/lib/site-config/header-layout";
import {
  alignItemsValue,
  fillTextCss,
  justifyContentValue,
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
  };
}

/** The message's type, its colour included (a gradient clips to the glyphs). */
export function announcementTextCss(style: AnnouncementStyle): CSSProperties {
  return {
    ...textStyleCss(style.textStyle),
    ...fillTextCss(style.textStyle.fill),
  };
}
