import sharp from "sharp";

import { resolveHeroBannerFont } from "./fonts";
import {
  HERO_BANNER_HEIGHT,
  HERO_BANNER_WIDTH,
  type HeroBannerBrief,
  type HeroBannerPlacement,
} from "./types";

type RenderedHeroBanner = {
  buffer: Buffer;
  width: typeof HERO_BANNER_WIDTH;
  height: typeof HERO_BANNER_HEIGHT;
  textApplied: boolean;
  warning?: string;
};

const PANEL_WIDTH = 560;
const PANEL_HEIGHT = 250;
const EDGE = 64;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_FINAL_BYTES = 10 * 1024 * 1024;

function escapePango(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function heroCropPosition(
  value: HeroBannerPlacement,
): "left" | "centre" | "right" {
  return value === "center" ? "centre" : value;
}

async function textLayer(
  value: string,
  fontfile: string,
  weight: 400 | 700,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp({
    text: {
      text: `<span foreground="#111827" weight="${weight}">${escapePango(value)}</span>`,
      fontfile,
      width,
      height,
      rgba: true,
      wrap: "word-char",
    },
  })
    .png()
    .toBuffer();
}

async function verifiedResult(
  buffer: Buffer,
  textApplied: boolean,
  warning?: string,
): Promise<RenderedHeroBanner> {
  const metadata = await sharp(buffer).metadata();
  if (
    metadata.width !== HERO_BANNER_WIDTH ||
    metadata.height !== HERO_BANNER_HEIGHT
  ) {
    throw new Error("Hero banner processor returned invalid dimensions");
  }
  if (buffer.length > MAX_FINAL_BYTES) {
    throw new Error("Processed hero banner exceeds the file-size limit");
  }
  return {
    buffer,
    width: HERO_BANNER_WIDTH,
    height: HERO_BANNER_HEIGHT,
    textApplied,
    ...(warning ? { warning } : {}),
  };
}

export async function renderHeroBanner(
  input: Buffer,
  brief: HeroBannerBrief,
): Promise<RenderedHeroBanner> {
  if (input.length > MAX_INPUT_BYTES) {
    throw new Error("Hero banner image is too large to process");
  }
  const base = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({
      width: HERO_BANNER_WIDTH,
      height: HERO_BANNER_HEIGHT,
      fit: "cover",
      position: heroCropPosition(brief.subjectPlacement),
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const requestedFields = [
    "headline",
    "subheadline",
    "price",
    "cta",
  ] as const;
  const hasRequestedText = requestedFields.some((field) => Boolean(brief[field]));
  if (!hasRequestedText) return verifiedResult(base, false);
  const fieldFonts = {
    headline: brief.headline
      ? resolveHeroBannerFont(brief.headline)
      : undefined,
    subheadline: brief.subheadline
      ? resolveHeroBannerFont(brief.subheadline)
      : undefined,
    price: brief.price ? resolveHeroBannerFont(brief.price) : undefined,
    cta: brief.cta ? resolveHeroBannerFont(brief.cta) : undefined,
  };
  if (
    requestedFields.some(
      (field) => Boolean(brief[field]) && !fieldFonts[field],
    )
  ) {
    return verifiedResult(
      base,
      false,
      "The selected font does not support every requested character; text was not applied.",
    );
  }

  const panelX =
    brief.textPlacement === "right"
      ? HERO_BANNER_WIDTH - EDGE - PANEL_WIDTH
      : brief.textPlacement === "center"
        ? Math.round((HERO_BANNER_WIDTH - PANEL_WIDTH) / 2)
        : EDGE;
  const composites: Array<{ input: Buffer; left: number; top: number }> = [
    {
      input: await sharp({
        create: {
          width: PANEL_WIDTH,
          height: PANEL_HEIGHT,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0.76 },
        },
      })
        .png()
        .toBuffer(),
      left: panelX,
      top: 32,
    },
  ];
  let top = 48;
  if (brief.headline) {
    composites.push({
      input: await textLayer(
        brief.headline,
        fieldFonts.headline!.bold,
        700,
        500,
        78,
      ),
      left: panelX + 30,
      top,
    });
    top += 78;
  }
  if (brief.subheadline) {
    composites.push({
      input: await textLayer(
        brief.subheadline,
        fieldFonts.subheadline!.regular,
        400,
        500,
        48,
      ),
      left: panelX + 30,
      top,
    });
    top += 48;
  }
  if (brief.price) {
    composites.push({
      input: await textLayer(
        brief.price,
        fieldFonts.price!.bold,
        700,
        220,
        38,
      ),
      left: panelX + 30,
      top,
    });
    top += 42;
  }
  if (brief.cta) {
    const ctaBg = Buffer.from(
      '<svg width="180" height="42" xmlns="http://www.w3.org/2000/svg"><rect width="180" height="42" rx="21" fill="#111827"/></svg>',
    );
    composites.push({ input: ctaBg, left: panelX + 30, top });
    const ctaText = await sharp({
      text: {
        text: `<span foreground="#ffffff" weight="700">${escapePango(brief.cta)}</span>`,
        fontfile: fieldFonts.cta!.bold,
        width: 150,
        height: 28,
        align: "center",
        rgba: true,
      },
    })
      .png()
      .toBuffer();
    composites.push({ input: ctaText, left: panelX + 45, top: top + 7 });
  }

  const output = await sharp(base)
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return verifiedResult(output, true);
}
