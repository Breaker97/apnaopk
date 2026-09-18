"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The point of interest in a picture: click or drag on the preview to set
 * it. A frame that crops the picture keeps this point in view, so a face
 * near the top of a tall photo survives a 16:10 phone crop.
 */
export function FocalPointPicker({
  src,
  value,
  onChange,
  label,
  className,
}: {
  src: string;
  value?: { x: number; y: number };
  onChange: (point: { x: number; y: number }) => void;
  label: string;
  className?: string;
}) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const point = value ?? { x: 50, y: 50 };

  const setFrom = (clientX: number, clientY: number) => {
    const area = areaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const x = Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)) * 10) / 10;
    const y = Math.round(Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)) * 10) / 10;
    onChange({ x, y });
  };

  return (
    <div
      ref={areaRef}
      role="slider"
      aria-label={label}
      aria-valuenow={point.x}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${point.x}% ${point.y}%`}
      tabIndex={0}
      className={cn("relative cursor-crosshair select-none overflow-hidden rounded-[8px] border border-border", className)}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setFrom(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (event.buttons & 1) setFrom(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 5 : 1;
        const next = { ...point };
        if (event.key === "ArrowLeft") next.x = Math.max(0, point.x - step);
        else if (event.key === "ArrowRight") next.x = Math.min(100, point.x + step);
        else if (event.key === "ArrowUp") next.y = Math.max(0, point.y - step);
        else if (event.key === "ArrowDown") next.y = Math.min(100, point.y + step);
        else return;
        event.preventDefault();
        onChange(next);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="aspect-video w-full object-cover" draggable={false} />
      {/* The crosshair: a ring with a dot, readable on any picture. */}
      <span
        aria-hidden
        className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ left: `${point.x}%`, top: `${point.y}%` }}
      >
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      </span>
    </div>
  );
}
