/**
 * Client-side, real-time photo adjustments for the AI Image Studio "Effects"
 * tab (brightness, exposure, contrast, … — the classic light/color sliders).
 *
 * These are deterministic pixel adjustments, so they run entirely in the
 * browser: a CSS `filter` string drives the live canvas preview, and the exact
 * same string is replayed onto a `<canvas>` via `ctx.filter` to bake the result
 * before it is uploaded through the normal media pipeline. No AI round-trip.
 *
 * The bake loads the source image through the same-origin download proxy so the
 * canvas is never tainted by a cross-origin storage host.
 */

const EFFECT_KEYS = [
  "brightness",
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "vignette",
  "saturation",
  "warmth",
  "tint",
  "sharpness",
] as const;

export type EffectKey = (typeof EFFECT_KEYS)[number];
export type EffectValues = Record<EffectKey, number>;

/** Every slider is bipolar, -100…100, neutral at 0 (centered). */
export const NEUTRAL_EFFECTS: EffectValues = {
  brightness: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  vignette: 0,
  saturation: 0,
  warmth: 0,
  tint: 0,
  sharpness: 0,
};

export function hasActiveEffects(e: EffectValues): boolean {
  return EFFECT_KEYS.some((k) => e[k] !== 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Build the CSS `filter` string for a set of effect values. Used both for the
 * live preview (element `style.filter`) and the bake (`ctx.filter`).
 *
 * `sharpen`/`vignette` are NOT expressed here — sharpen is a convolution and
 * vignette is a gradient overlay; both are handled separately (an SVG filter
 * for the live sharpen preview, canvas passes for the bake).
 */
export function buildEffectFilter(
  e: EffectValues,
  opts: { includeSharpen?: boolean } = {},
): string {
  const parts: string[] = [];

  // Brightness folds in exposure and the coarse shadow-lift / highlight-pull.
  const brightness =
    1 +
    (e.brightness * 0.4 + e.exposure * 0.5 + e.shadows * 0.2 - e.highlights * 0.1) /
      100;
  if (Math.abs(brightness - 1) > 0.001) {
    parts.push(`brightness(${clamp(brightness, 0, 3).toFixed(3)})`);
  }

  const contrast =
    1 + (e.contrast * 0.5 + e.highlights * 0.2 - e.shadows * 0.2) / 100;
  if (Math.abs(contrast - 1) > 0.001) {
    parts.push(`contrast(${clamp(contrast, 0, 3).toFixed(3)})`);
  }

  const saturate = 1 + e.saturation / 100;
  if (Math.abs(saturate - 1) > 0.001) {
    parts.push(`saturate(${clamp(saturate, 0, 3).toFixed(3)})`);
  }

  // Warmth: positive warms via sepia; cool nudges hue toward blue.
  if (e.warmth > 0) {
    parts.push(`sepia(${((e.warmth / 100) * 0.55).toFixed(3)})`);
  }
  const hue = (e.warmth < 0 ? e.warmth * 0.15 : 0) + e.tint * 0.35;
  if (Math.abs(hue) > 0.05) {
    parts.push(`hue-rotate(${hue.toFixed(1)}deg)`);
  }

  // Negative sharpness = softening (blur). Positive sharpen is convolution:
  // the live preview references the SVG filter, the bake runs it manually.
  if (e.sharpness < 0) {
    parts.push(`blur(${((-e.sharpness / 100) * 1.5).toFixed(2)}px)`);
  } else if (e.sharpness > 0 && opts.includeSharpen) {
    parts.push(`url(#${SHARPEN_FILTER_ID})`);
  }

  return parts.length ? parts.join(" ") : "none";
}

export const SHARPEN_FILTER_ID = "studio-effect-sharpen";

/** feConvolveMatrix kernel value for a sharpen amount (0…100). */
export function sharpenAmount(sharpness: number): number {
  return (Math.max(0, sharpness) / 100) * 1.1;
}

/** CSS background for the vignette overlay, or undefined when neutral. */
export function vignetteBackground(vignette: number): string | undefined {
  if (!vignette) return undefined;
  const a = vignette / 100;
  const color =
    a >= 0
      ? `rgba(0,0,0,${(a * 0.7).toFixed(3)})`
      : `rgba(255,255,255,${(-a * 0.7).toFixed(3)})`;
  return `radial-gradient(circle at 50% 50%, transparent 45%, ${color} 100%)`;
}

function drawVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  vignette: number,
) {
  const a = vignette / 100;
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.hypot(cx, cy);
  const gradient = ctx.createRadialGradient(
    cx,
    cy,
    outer * 0.45,
    cx,
    cy,
    outer,
  );
  if (a >= 0) {
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, `rgba(0,0,0,${(a * 0.7).toFixed(3)})`);
  } else {
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(1, `rgba(255,255,255,${(-a * 0.7).toFixed(3)})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

/** 3×3 unsharp-mask convolution matching the SVG preview kernel. */
function sharpenCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sharpness: number,
) {
  const a = sharpenAmount(sharpness);
  if (a <= 0) return;
  const kernel = [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0];
  const src = ctx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  const s = src.data;
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let ki = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const px = clamp(x + kx, 0, w - 1);
            const py = clamp(y + ky, 0, h - 1);
            sum += s[(py * w + px) * 4 + c] * kernel[ki++];
          }
        }
        d[idx + c] = clamp(sum, 0, 255);
      }
      d[idx + 3] = s[idx + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
}

/**
 * Load an image the canvas can export: fetch it through the same-origin
 * download proxy (SSRF-guarded to this store's storage) so the resulting
 * canvas is never tainted by the cross-origin storage host.
 */
async function loadImageForBake(
  sourceUrl: string,
): Promise<{ image: HTMLImageElement; revoke: () => void }> {
  const response = await fetch(
    `/api/ai-authoring/download?url=${encodeURIComponent(sourceUrl)}`,
  );
  if (!response.ok) {
    throw new Error("Could not load the image to apply effects");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return { image, revoke: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

/**
 * Bake the effect values onto the source image and return a PNG blob, ready to
 * upload through the normal /api/upload path.
 */
export async function renderEffectsToBlob(
  sourceUrl: string,
  effects: EffectValues,
): Promise<Blob> {
  const { image, revoke } = await loadImageForBake(sourceUrl);
  try {
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    if (!w || !h) throw new Error("The image has no dimensions");

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser");

    ctx.filter = buildEffectFilter(effects, { includeSharpen: false });
    ctx.drawImage(image, 0, 0, w, h);
    ctx.filter = "none";

    if (effects.sharpness > 0) sharpenCanvas(ctx, w, h, effects.sharpness);
    if (effects.vignette !== 0) drawVignette(ctx, w, h, effects.vignette);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("Could not export the edited image");
    return blob;
  } finally {
    revoke();
  }
}

/**
 * Center-crop the source image to an exact target aspect ratio and return a PNG
 * blob, ready to upload through the normal media pipeline. Used to lock a
 * surface's output to a ratio the image model can't emit natively (e.g. a blog
 * featured image: generated at 3:2, then trimmed to 16:9). The crop keeps the
 * full width or full height — whichever the ratio allows — and trims the other
 * axis evenly from both edges, so a centered subject stays centered.
 */
export async function cropToRatioBlob(
  sourceUrl: string,
  ratioW: number,
  ratioH: number,
): Promise<Blob> {
  if (!ratioW || !ratioH) throw new Error("Invalid crop ratio");

  const { image, revoke } = await loadImageForBake(sourceUrl);
  try {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih) throw new Error("The image has no dimensions");

    const targetRatio = ratioW / ratioH;
    // The largest ratioW:ratioH box that fits inside the source, centered.
    let cropW = iw;
    let cropH = Math.round(iw / targetRatio);
    if (cropH > ih) {
      cropH = ih;
      cropW = Math.round(ih * targetRatio);
    }
    const sx = Math.round((iw - cropW) / 2);
    const sy = Math.round((ih - cropH) / 2);

    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser");

    ctx.drawImage(image, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("Could not export the cropped image");
    return blob;
  } finally {
    revoke();
  }
}

/**
 * Build the outpaint source for the Expand tool. The current image is drawn,
 * scaled down and centered, onto a larger transparent canvas at the target
 * aspect ratio, leaving empty margins on every side. That transparent border is
 * what the edit model fills in — a genuine "zoom out" expansion that preserves
 * the product's own pixels, unlike Resize which re-renders the whole frame.
 *
 * `zoom` is the fraction of the contain-fit size the image occupies; the
 * remainder becomes the margin the model paints into.
 */
export async function renderExpandCompositeToBlob(
  sourceUrl: string,
  size: string,
  zoom = 0.72,
): Promise<Blob> {
  const [targetW, targetH] = size
    .split("x")
    .map((part) => Number.parseInt(part, 10));
  if (!targetW || !targetH) throw new Error("Invalid expand canvas size");

  const { image, revoke } = await loadImageForBake(sourceUrl);
  try {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih) throw new Error("The image has no dimensions");

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser");

    const scale = Math.min(targetW / iw, targetH / ih) * zoom;
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(image, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("Could not export the expand canvas");
    return blob;
  } finally {
    revoke();
  }
}
