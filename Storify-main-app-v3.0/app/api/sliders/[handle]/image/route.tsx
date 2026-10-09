import type { CSSProperties } from "react";
import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { getStorefrontSlider } from "@/lib/storefront/sliders";
import { buildRenderSlides } from "@/lib/sliders/render";
import {
  backgroundOverlayCss,
  buildGradientCss,
  ctaVariantChrome,
  focalPositionCss,
  resolveImageLayout,
  resolveSlideElements,
  resolveSlideLayout,
  resolveTextStyle,
  SLIDE_FRAMES,
  stripHighlights,
  type SlideCtaElement,
  type SliderSlide,
} from "@/lib/sliders/types";

/**
 * GET /api/sliders/[handle]/image?slide=<id>&w=1200&h=450
 *
 * A slide as a still picture — for an email, a social card, a chat preview,
 * anywhere HTML cannot run. The PUBLISHED slide is drawn with the same
 * arrangement the storefront draws (landscape band: alignment, gap, inset,
 * sizes scaled from the desktop frame), with its picture, darkening, plate,
 * texts and first button. Type is the renderer's default face; a theme's
 * webfont does not travel into a bitmap.
 *
 * Public and cached: a mail client fetches it without a session.
 */

const MIN = 300;
const MAX = 2000;

function clamp(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(MAX, Math.max(MIN, Math.round(value))) : fallback;
}

/** A hex colour (3, 6 or 8 digits) as rgba(), which the renderer understands. */
function rgba(hex: string, alphaScale = 1): string {
  const digits = hex.replace("#", "");
  const full = digits.length <= 4 ? digits.split("").map((d) => d + d).join("") : digits;
  const n = (at: number) => parseInt(full.slice(at, at + 2), 16) || 0;
  const alpha = full.length === 8 ? n(6) / 255 : 1;
  return `rgba(${n(0)},${n(2)},${n(4)},${(alpha * alphaScale).toFixed(3)})`;
}

/**
 * A style with no undefined entries: the renderer parses shorthands like
 * `border` with string methods, and an undefined value throws inside it.
 */
function clean(style: CSSProperties): CSSProperties {
  return Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== undefined),
  ) as CSSProperties;
}

const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" } as const;
const ALIGN = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

export const GET = withApi<{ handle: string }>(
  { auth: "optional", rateLimit: { action: "sliders:image", preset: "lenient" } },
  async ({ request, params }) => {
    const slider = await getStorefrontSlider(params.handle);
    if (!slider) return new NextResponse(null, { status: 404 });
    const slides = buildRenderSlides(slider.slides, new Map());
    const wanted = request.nextUrl.searchParams.get("slide");
    const slide: SliderSlide | undefined = slides.find((entry) => entry.id === wanted) ?? slides[0];
    if (!slide) return new NextResponse(null, { status: 404 });

    const width = clamp(Number(request.nextUrl.searchParams.get("w")), 1200);
    const height = clamp(
      Number(request.nextUrl.searchParams.get("h")),
      Math.round((width * SLIDE_FRAMES.landscape.height) / SLIDE_FRAMES.landscape.width),
    );
    const origin = request.nextUrl.origin;
    const absolute = (src: string) => (/^https?:\/\//i.test(src) ? src : `${origin}${src.startsWith("/") ? "" : "/"}${src}`);
    // Every length is px on the 1248-wide desktop frame; the picture scales from it.
    const scale = width / SLIDE_FRAMES.landscape.width;
    const layout = resolveSlideLayout(slide, "landscape");
    const elements = resolveSlideElements(slide, "landscape");
    const art = resolveImageLayout(slide, "landscape");
    const { background } = slide;
    const artwork = background.type === "image" || background.type === "video";
    const ink = artwork ? "#ffffff" : "#1f2937";
    const overlay = backgroundOverlayCss(background);

    const fontSizeOf = (element: "tagline" | "heading" | "description" | SlideCtaElement) =>
      Math.max(
        10,
        Math.round((resolveTextStyle(slide, element, "landscape").size * scale * layout.scale) / 100),
      );
    const textStyle = (element: "tagline" | "heading" | "description" | SlideCtaElement) => {
      const style = resolveTextStyle(slide, element, "landscape");
      return clean({
        fontSize: fontSizeOf(element),
        fontWeight: Number(style.weight ?? (element === "heading" ? 700 : element === "cta" || element === "cta2" ? 500 : 400)),
        fontStyle: style.style ?? "normal",
        color: style.color ?? ink,
        letterSpacing: style.letterSpacing !== undefined ? `${style.letterSpacing / 100}em` : element === "tagline" ? "0.2em" : undefined,
        textTransform: (style.transform ?? (element === "tagline" ? "uppercase" : "none")) as "none" | "uppercase" | "capitalize",
        lineHeight: (style.lineHeight ?? 120) / 100,
        width: style.width > 0 ? `${style.width}%` : undefined,
      });
    };

    const nodes = slide.order.flatMap((element) => {
      if (!elements[element]) return [];
      switch (element) {
        case "tagline":
        case "heading":
        case "description": {
          const text = stripHighlights(slide.texts[element]);
          if (!text) return [];
          return [
            <div key={element} style={clean({ display: "flex", ...textStyle(element) })}>
              {text}
            </div>,
          ];
        }
        case "cta":
        case "cta2": {
          const text = slide.texts[element];
          if (!text) return [];
          const style = resolveTextStyle(slide, element, "landscape");
          const chrome = ctaVariantChrome(element === "cta2" ? slide.cta2Variant : slide.ctaVariant, style);
          const type = textStyle(element);
          const size = fontSizeOf(element);
          return [
            <div
              key={element}
              style={clean({
                display: "flex",
                ...type,
                color: style.color ?? chrome.textColor,
                backgroundColor: chrome.background === "transparent" ? "transparent" : chrome.background,
                border: chrome.border === "none" ? undefined : `${(style.borderWidth ?? 1) * scale}px solid ${style.color ?? chrome.textColor}`,
                borderRadius: (style.radius ?? 6) * scale,
                padding: `${(style.paddingY ?? size * 0.7) * (style.paddingY ? scale : 1)}px ${(style.paddingX ?? size * 1.6) * (style.paddingX ? scale : 1)}px`,
              })}
            >
              {text}
            </div>,
          ];
        }
        default:
          return [];
      }
    });

    const plate = slide.plate;
    const picture = artwork ? background.image : undefined;

    return new ImageResponse(
      (
        <div
          style={clean({
            width,
            height,
            display: "flex",
            position: "relative",
            overflow: "hidden",
            backgroundColor:
              background.type === "solid" && background.color ? background.color : "#f1f1f1",
            backgroundImage:
              background.type === "gradient" && background.gradient
                ? buildGradientCss(background.gradient)
                : undefined,
          })}
        >
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={absolute(picture)}
              alt=""
              width={width}
              height={height}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width,
                height,
                objectFit: "cover",
                objectPosition: focalPositionCss(background),
              }}
            />
          ) : null}
          {overlay ? (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width,
                height,
                display: "flex",
                ...(overlay.backgroundColor ? { backgroundColor: String(overlay.backgroundColor) } : {}),
                ...(overlay.backgroundImage ? { backgroundImage: String(overlay.backgroundImage) } : {}),
              }}
            />
          ) : null}
          {slide.productImage ? (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width,
                height,
                display: "flex",
                justifyContent: JUSTIFY[art.h],
                alignItems: ALIGN[art.v],
                padding: 24 * scale,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={absolute(slide.productImage)}
                alt=""
                style={{ width: `${art.scale}%`, objectFit: "contain" }}
              />
            </div>
          ) : null}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width,
              height,
              display: "flex",
              justifyContent: JUSTIFY[layout.h],
              alignItems: ALIGN[layout.v],
              padding: layout.padding * scale,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: JUSTIFY[layout.h],
                textAlign: layout.h,
                gap: (layout.gap * scale * layout.scale) / 100,
                maxWidth: "100%",
                ...(plate
                  ? {
                      backgroundColor: rgba(plate.color),
                      padding: plate.padding * scale,
                      borderRadius: plate.radius,
                    }
                  : {}),
              }}
            >
              {nodes}
            </div>
          </div>
        </div>
      ),
      {
        width,
        height,
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  },
);
