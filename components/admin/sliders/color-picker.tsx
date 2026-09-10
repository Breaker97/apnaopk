"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { cn } from "@/lib/utils";

/**
 * Custom solid-color picker (the design's Frame 527): saturation/value
 * square, hue rail, hex input. No dependency — the panel is two CSS
 * gradients and pointer math, which is all a picker is.
 */

const HEX_INPUT = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

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

export function ColorPickerPanel({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(value || "#f1f1f1"));
  const [alpha, setAlpha] = useState(() => hexAlpha(value || "#f1f1f1"));
  const [hexText, setHexText] = useState(value || "#f1f1f1");
  // Track the last hex WE emitted, so an external value change (another
  // swatch selected) resyncs the panel without fighting the drag loop.
  const emitted = useRef(value);

  useEffect(() => {
    if (value && value !== emitted.current) {
      setHsv(hexToHsv(value));
      setAlpha(hexAlpha(value));
      setHexText(value);
      emitted.current = value;
    }
  }, [value]);

  const emit = useCallback(
    (next: { h: number; s: number; v: number }, nextAlpha: number) => {
      setHsv(next);
      setAlpha(nextAlpha);
      const hex = withAlpha(hsvToHex(next.h, next.s, next.v), nextAlpha);
      setHexText(hex);
      emitted.current = hex;
      onChange(hex);
    },
    [onChange],
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
      <div
        ref={alphaRef}
        onPointerDown={onAlphaPointer}
        className="relative h-3.5 w-full cursor-pointer touch-none rounded-full"
        style={{ background: CHECKERBOARD }}
        aria-label="Opacity"
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
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-foreground">hex</span>
        <Input
          value={hexText}
          onChange={(event) => {
            const next = event.target.value;
            setHexText(next);
            const trimmed = next.trim();
            if (HEX_INPUT.test(trimmed)) {
              setHsv(hexToHsv(trimmed));
              setAlpha(hexAlpha(trimmed));
              emitted.current = trimmed;
              onChange(trimmed);
            }
          }}
          className="h-8 flex-1 text-sm"
          spellCheck={false}
        />
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
          aria-label="Opacity"
        />
        <span className="text-xs text-muted-foreground">%</span>
      </div>
    </div>
  );
}
