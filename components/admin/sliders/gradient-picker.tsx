"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Circle,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildGradientCss,
  type SlideGradient,
} from "@/lib/sliders/types";
import { ColorPickerPanel } from "./color-picker";

/**
 * Multi-stop gradient picker (the design's Frame 575, extended Figma-style):
 * a preview bar carrying draggable stop markers — click the bar to add a
 * stop, drag to move, select to edit its color below — plus the 8-direction
 * pad whose centre dot switches to a radial gradient.
 */

export const DEFAULT_GRADIENT: SlideGradient = {
  type: "linear",
  angle: 0,
  stops: [
    { color: "#ef4444", at: 0 },
    { color: "#ec4899", at: 100 },
  ],
};

const DIRECTIONS: {
  angle: number | "radial";
  Icon: typeof ArrowUp;
}[] = [
  { angle: 315, Icon: ArrowUpLeft },
  { angle: 0, Icon: ArrowUp },
  { angle: 45, Icon: ArrowUpRight },
  { angle: 270, Icon: ArrowLeft },
  { angle: "radial", Icon: Circle },
  { angle: 90, Icon: ArrowRight },
  { angle: 225, Icon: ArrowDownLeft },
  { angle: 180, Icon: ArrowDown },
  { angle: 135, Icon: ArrowDownRight },
];

const MAX_STOPS = 6;

export function GradientPickerPanel({
  value,
  onChange,
  directionLabel,
}: {
  value: SlideGradient | undefined;
  onChange: (gradient: SlideGradient) => void;
  directionLabel: string;
}) {
  const gradient = value ?? DEFAULT_GRADIENT;
  const [selectedStop, setSelectedStop] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const sorted = useMemo(
    () => [...gradient.stops].sort((a, b) => a.at - b.at),
    [gradient.stops],
  );
  const active = sorted[Math.min(selectedStop, sorted.length - 1)];

  const commit = (stops: SlideGradient["stops"], rest?: Partial<SlideGradient>) => {
    onChange({
      ...gradient,
      ...rest,
      stops: [...stops].sort((a, b) => a.at - b.at),
    });
  };

  const barRatio = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const startDrag = (index: number) => (event: React.PointerEvent) => {
    event.stopPropagation();
    setSelectedStop(index);
    dragging.current = true;
    const move = (moveEvent: PointerEvent) => {
      const at = Math.round(barRatio(moveEvent.clientX) * 100);
      const stops = sorted.map((stop, i) =>
        i === index ? { ...stop, at } : stop,
      );
      commit(stops);
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const addStop = (event: React.PointerEvent) => {
    if (dragging.current || sorted.length >= MAX_STOPS) return;
    const at = Math.round(barRatio(event.clientX) * 100);
    // New stop inherits the gradient's color at that position (nearest stop
    // is a good-enough sample without rasterizing).
    const nearest = sorted.reduce((best, stop) =>
      Math.abs(stop.at - at) < Math.abs(best.at - at) ? stop : best,
    );
    const stops = [...sorted, { color: nearest.color, at }];
    commit(stops);
    setSelectedStop(stops.sort((a, b) => a.at - b.at).findIndex((s) => s.at === at));
  };

  const removeStop = (index: number) => {
    if (sorted.length <= 2) return;
    commit(sorted.filter((_, i) => i !== index));
    setSelectedStop(0);
  };

  return (
    <div className="space-y-4">
      {/* Stop rail — click to add, drag markers to move, select to edit
          below. The markers ARE the colour swatches: a separate start/end
          pair would only repeat the two outermost of them. */}
      <div
        ref={barRef}
        onPointerDown={addStop}
        className="relative h-6 w-full cursor-copy rounded-[4px] border border-border"
        style={{
          backgroundImage: buildGradientCss({ ...gradient, type: "linear", angle: 90 }),
        }}
      >
        {sorted.map((stop, index) => (
          <button
            key={`${stop.at}-${index}`}
            type="button"
            onPointerDown={startDrag(index)}
            onDoubleClick={() => removeStop(index)}
            className={cn(
              "absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 shadow",
              selectedStop === index
                ? "border-primary ring-2 ring-primary/40"
                : "border-white",
            )}
            style={{ left: `${stop.at}%`, backgroundColor: stop.color }}
            aria-label={`Gradient stop at ${stop.at}%`}
          />
        ))}
      </div>
      {sorted.length > 2 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={() => removeStop(selectedStop)}
          >
            <Minus className="h-3.5 w-3.5" /> Remove stop
          </Button>
        </div>
      ) : null}

      {/* Direction pad — 8 arrows + centre = radial. */}
      <div className="flex items-start justify-between gap-4">
        <span className="pt-1 text-sm font-medium text-foreground">
          {directionLabel}
        </span>
        <div className="grid grid-cols-3 gap-1">
          {DIRECTIONS.map(({ angle, Icon }) => {
            const activeDirection =
              angle === "radial"
                ? gradient.type === "radial"
                : gradient.type === "linear" && gradient.angle === angle;
            return (
              <button
                key={String(angle)}
                type="button"
                onClick={() =>
                  commit(
                    sorted,
                    angle === "radial"
                      ? { type: "radial" }
                      : { type: "linear", angle },
                  )
                }
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-[4px] border transition",
                  activeDirection
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted/60 text-muted-foreground hover:bg-muted",
                )}
                aria-label={
                  angle === "radial" ? "Radial gradient" : `Angle ${angle}°`
                }
              >
                <Icon className={cn("h-4 w-4", angle === "radial" && "h-2.5 w-2.5 fill-current")} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Color panel for the selected stop (the design's Frame 576). */}
      <ColorPickerPanel
        value={active?.color ?? "#ef4444"}
        onChange={(hex) => {
          const stops = sorted.map((stop, index) =>
            index === Math.min(selectedStop, sorted.length - 1)
              ? { ...stop, color: hex }
              : stop,
          );
          commit(stops);
        }}
      />
    </div>
  );
}
