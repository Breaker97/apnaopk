"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useSavedColors } from "@/hooks/use-saved-colors";
import {
  formatColor,
  nextColorFormat,
  parseTypedColor,
  rgbaToHex,
  type ColorFormat,
} from "@/lib/theme-colors/color-format";
import { cn } from "@/lib/utils";

/**
 * Custom solid-color picker (the design's Frame 527): saturation/value
 * square, hue rail, opacity rail and a colour field that reads as hex, rgb,
 * hsl or oklch, plus colours kept for next time. The panel is two CSS
 * gradients and pointer math; what it hands back is always a hex.
 */

const HEX_INPUT = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * What was typed as a hex colour, in any spelling the field accepts: hex as
 * typed, or rgb()/hsl()/oklch() converted. Null when it is not a colour.
 */
function resolveTyped(text: string): string | null {
  const hex = typedHex(text);
  if (HEX_INPUT.test(hex)) return hex;
  const color = parseTypedColor(text);
  return color ? rgbaToHex(color) : null;
}

/** What was typed, with the "#" a merchant may leave off. */
function typedHex(text: string): string {
  const trimmed = text.trim();
  return trimmed && !trimmed.startsWith("#") ? `#${trimmed}` : trimmed;
}

/** One spelling per colour (#abc and #AABBCC are the same), or null. */
function canonicalHex(value: string | undefined | null): string | null {
  const hex = typedHex(value ?? "").toLowerCase();
  if (!HEX_INPUT.test(hex)) return null;
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
}

/**
 * The alpha a hex carries, 0–1; a three- or six-digit hex is opaque. Kept
 * apart from the hue maths so the square and rail never see the channel.
 */
function hexAlpha(hex: string): number {
  const match = /^#?[0-9a-f]{6}([0-9a-f]{2})$/i.exec(hex.trim());
  return match ? parseInt(match[1], 16) / 255 : 1;
}

/** `#rrggbb`, with `aa` appended only when the colour is not fully opaque. */
function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})(?:[0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return { h: 0, s: 0, v: 1 };
  let value = match[1];
  if (value.length === 3) {
    value = value
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

const HUE_RAIL =
  "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)";

/** The chequerboard a transparent colour is judged against. */
export const CHECKERBOARD =
  "repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%) 0 0 / 12px 12px";

function useDragArea(
  onPoint: (xRatio: number, yRatio: number) => void,
) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const handlePointer = useCallback(
    (event: React.PointerEvent) => {
      const area = areaRef.current;
      if (!area) return;
      const apply = (clientX: number, clientY: number) => {
        const rect = area.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
        onPoint(x, y);
      };
      apply(event.clientX, event.clientY);
      const move = (moveEvent: PointerEvent) =>
        apply(moveEvent.clientX, moveEvent.clientY);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onPoint],
  );
  return { areaRef, handlePointer };
}

const FORMAT_NAMES: Record<ColorFormat, string> = {
  hex: "HEX",
  rgb: "RGB",
  hsl: "HSL",
  oklch: "OKLCH",
};

export function ColorPickerPanel({
  value,
  onChange,
  alpha: withOpacity = true,
  className,
}: {
  value: string;
  onChange: (hex: string) => void;
  /**
   * The opacity rail and % field. Off where the stored value must stay a
   * plain `#rrggbb` (a variant swatch, a theme token).
   */
  alpha?: boolean;
  className?: string;
}) {
  const tSafe = useFallbackTranslator(useTranslations());
  const [hsv, setHsv] = useState(() => hexToHsv(value || "#f1f1f1"));
  const [alpha, setAlpha] = useState(() => hexAlpha(value || "#f1f1f1"));
  const [format, setFormat] = useState<ColorFormat>("hex");
  const [fieldText, setFieldText] = useState(value || "#f1f1f1");
  // Track the last hex WE emitted, so an external value change (another
  // swatch selected) resyncs the panel without fighting the drag loop.
  const emitted = useRef(value);
  const { colors: savedColors, save: saveColor, remove: removeColor } = useSavedColors();

  useEffect(() => {
    if (value && value !== emitted.current) {
      // The parent handing back the colour just typed, in its own spelling
      // (#abc → #aabbcc), is not a new colour: rewriting the field then
      // would mangle the rest of what is being typed.
      const echo = canonicalHex(value);
      if (echo && echo === canonicalHex(emitted.current)) {
        emitted.current = value;
        return;
      }
      setHsv(hexToHsv(value));
      setAlpha(hexAlpha(value));
      setFieldText(formatColor(value, format));
      emitted.current = value;
    }
  }, [value, format]);

  const emit = useCallback(
    (next: { h: number; s: number; v: number }, requestedAlpha: number) => {
      const nextAlpha = withOpacity ? requestedAlpha : 1;
      setHsv(next);
      setAlpha(nextAlpha);
      const hex = withAlpha(hsvToHex(next.h, next.s, next.v), nextAlpha);
      setFieldText(formatColor(hex, format));
      emitted.current = hex;
      onChange(hex);
    },
    [onChange, withOpacity, format],
  );

  const { areaRef: squareRef, handlePointer: onSquarePointer } = useDragArea(
    (x, y) => emit({ h: hsv.h, s: x, v: 1 - y }, alpha),
  );
  const { areaRef: railRef, handlePointer: onRailPointer } = useDragArea((x) =>
    emit({ ...hsv, h: x * 359.99 }, alpha),
  );
  const { areaRef: alphaRef, handlePointer: onAlphaPointer } = useDragArea(
    (x) => emit(hsv, Math.round(x * 100) / 100),
  );

  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);
  const currentValue = withAlpha(currentHex, alpha).toLowerCase();

  /** The hex the parent holds now, in the spelling it was given. */
  const heldHex = () => (canonicalHex(emitted.current) ? emitted.current : currentValue);

  const cycleFormat = () => {
    const next = nextColorFormat(format);
    setFormat(next);
    setFieldText(formatColor(heldHex(), next));
  };

  /** Make a kept colour the current one. */
  const applySaved = (saved: string) => {
    // A swatch kept with opacity must not put an alpha into a field that
    // stores plain #rrggbb.
    const hex = withOpacity ? saved : saved.slice(0, 7);
    setHsv(hexToHsv(hex));
    setAlpha(hexAlpha(hex));
    setFieldText(formatColor(hex, format));
    emitted.current = hex;
    onChange(hex);
  };

  const acceptsTyped = (hex: string | null): hex is string =>
    hex !== null && (withOpacity || hex.length !== 9);

  const formatLabel = `${tSafe("admin.colorPicker.format", "Color format")}: ${FORMAT_NAMES[format]}`;
  const opacityLabel = tSafe("admin.colorPicker.opacity", "Opacity");
  const saveLabel = tSafe("admin.colorPicker.save", "Save this color");
  const isSaved = savedColors.includes(currentValue);

  return (
    <div className={cn("space-y-3", className)}>
      <div
        ref={squareRef}
        onPointerDown={onSquarePointer}
        className="relative h-44 w-full cursor-crosshair touch-none rounded-[8px]"
        style={{
          backgroundColor: `hsl(${hsv.h} 100% 50%)`,
          backgroundImage:
            "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
        }}
      >
        <div
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.35)]"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: currentHex,
          }}
        />
      </div>
      <div
        ref={railRef}
        onPointerDown={onRailPointer}
        className="relative h-3.5 w-full cursor-pointer touch-none rounded-full"
        style={{ background: HUE_RAIL }}
      >
        <div
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-500 shadow"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            height: "18px",
            width: "18px",
          }}
        />
      </div>
      {/* Opacity, on the same kind of rail as the hue: the colour fades
          into a chequerboard so a half-transparent white is not a rail of
          nothing. The value rides in the hex as its last two digits. */}
      {withOpacity ? (
        <div className="flex items-center gap-3">
          <div
            ref={alphaRef}
            onPointerDown={onAlphaPointer}
            className="relative h-3.5 min-w-0 flex-1 cursor-pointer touch-none rounded-full"
            style={{ background: CHECKERBOARD }}
            aria-label={opacityLabel}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `linear-gradient(to right, transparent, ${currentHex})`,
              }}
            />
            <div
              className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{
                left: `${alpha * 100}%`,
                height: "18px",
                width: "18px",
                background: `linear-gradient(${withAlpha(currentHex, alpha)}, ${withAlpha(currentHex, alpha)}), ${CHECKERBOARD}`,
              }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <NumberInput
              min={0}
              max={100}
              step={1}
              value={Math.round(alpha * 100)}
              whenEmpty="keep"
              normalize={Math.round}
              onValueChange={(next) => {
                if (next !== undefined) emit(hsv, next / 100);
              }}
              className="h-8 w-[4.5rem] text-sm"
              aria-label={opacityLabel}
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={cycleFormat}
          aria-label={formatLabel}
          title={formatLabel}
          className="h-8 min-w-[3.25rem] shrink-0 rounded-md border border-input bg-background px-2 text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {FORMAT_NAMES[format]}
        </button>
        <Input
          aria-label={tSafe("admin.colorPicker.value", "Color value")}
          value={fieldText}
          onChange={(event) => {
            const next = event.target.value;
            setFieldText(next);
            const hex = resolveTyped(next);
            if (acceptsTyped(hex)) {
              setHsv(hexToHsv(hex));
              setAlpha(hexAlpha(hex));
              emitted.current = hex;
              onChange(hex);
            }
          }}
          // Text that never became a colour goes back to the one in use,
          // rather than sitting there looking applied.
          onBlur={() => {
            if (!acceptsTyped(resolveTyped(fieldText))) {
              setFieldText(formatColor(emitted.current || value || "#f1f1f1", format));
            }
          }}
          className="h-8 min-w-0 flex-1 text-sm"
          // Colour codes read left to right, whatever the page's direction.
          dir="ltr"
          spellCheck={false}
        />
      </div>
      {/* Colours kept for next time (this browser). Delete or Backspace on a
          focused swatch drops it, as does its × — shown on hover or focus. */}
      <div
        role="group"
        aria-label={tSafe("admin.colorPicker.saved", "Saved colors")}
        className="flex flex-wrap items-center gap-1"
      >
        <button
          type="button"
          onClick={() => saveColor(currentValue)}
          disabled={isSaved}
          aria-label={saveLabel}
          title={saveLabel}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Plus className="h-3 w-3" />
        </button>
        {savedColors.map((saved) => (
          <div key={saved} className="group/saved relative">
            <button
              type="button"
              onClick={() => applySaved(saved)}
              onKeyDown={(event) => {
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  removeColor(saved);
                }
              }}
              aria-label={tSafe("admin.colorPicker.use", "Use {color}", { color: saved })}
              aria-pressed={saved === currentValue}
              title={saved}
              className={cn(
                "relative block h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-border transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                saved === currentValue && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
              )}
              style={{ background: CHECKERBOARD }}
            >
              <span className="absolute inset-0" style={{ backgroundColor: saved }} />
            </button>
            <button
              type="button"
              onClick={() => removeColor(saved)}
              aria-label={tSafe("admin.colorPicker.remove", "Remove {color}", { color: saved })}
              className="absolute -end-1 -top-1 hidden h-3.5 w-3.5 place-items-center rounded-full bg-foreground text-background group-focus-within/saved:grid group-hover/saved:grid"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
