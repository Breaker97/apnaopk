"use client";

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SLIDE_H_ALIGN,
  SLIDE_V_ALIGN,
  type SlideHAlign,
  type SlideVAlign,
} from "@/lib/sliders/types";

/**
 * The design's alignment controls: two SEGMENTED groups — edges align the
 * copy or the artwork horizontally, then vertically — drawn as joined square
 * cells with hairline dividers, the active cell filled.
 *
 * The glyphs are the object-alignment set (a rule plus the shapes that snap
 * to it), which is what the design uses and what the control actually does —
 * not the text-alignment set, which would read as "align the words inside
 * the box".
 */

const H_ICONS: Record<SlideHAlign, LucideIcon> = {
  left: AlignStartVertical,
  center: AlignCenterVertical,
  right: AlignEndVertical,
};

const V_ICONS: Record<SlideVAlign, LucideIcon> = {
  top: AlignStartHorizontal,
  middle: AlignCenterHorizontal,
  bottom: AlignEndHorizontal,
};

/** One segmented group. Rounding lives on the container, so the cells inside
 * stay square and only the outer corners curve — the design's shape. */
export function SegmentedGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center overflow-hidden rounded-[8px] border border-border bg-background">
      {children}
    </div>
  );
}

export function SegmentedCell({
  icon: Icon,
  active,
  onClick,
  label,
  disabled,
}: {
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid h-8 w-9 place-items-center border-r border-border transition last:border-r-0",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40 hover:bg-background",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function AlignControls({
  h,
  v,
  onChange,
  labelFor,
}: {
  h: SlideHAlign;
  v: SlideVAlign;
  onChange: (patch: { h?: SlideHAlign; v?: SlideVAlign }) => void;
  labelFor: (axis: "h" | "v", value: string) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <SegmentedGroup>
        {SLIDE_H_ALIGN.map((value) => (
          <SegmentedCell
            key={value}
            icon={H_ICONS[value]}
            active={h === value}
            onClick={() => onChange({ h: value })}
            label={labelFor("h", value)}
          />
        ))}
      </SegmentedGroup>
      <SegmentedGroup>
        {SLIDE_V_ALIGN.map((value) => (
          <SegmentedCell
            key={value}
            icon={V_ICONS[value]}
            active={v === value}
            onClick={() => onChange({ v: value })}
            label={labelFor("v", value)}
          />
        ))}
      </SegmentedGroup>
    </div>
  );
}
