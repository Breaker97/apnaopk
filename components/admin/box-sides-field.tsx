"use client";

import { useState } from "react";
import { MoveHorizontal, MoveVertical, Scan } from "lucide-react";
import { UnitField } from "@/components/admin/unit-field";
import { cn } from "@/lib/utils";

/**
 * A box measurement with four sides — padding, margin, inset — edited the way
 * a design tool edits one: the two PAIRS while they are symmetric, and each
 * side on its own once they are not.
 *
 * Most of the time a merchant wants the same space left and right, so
 * offering four numbers up front is four decisions where one was needed. The
 * pair fields cover that case; the toggle on the right opens the sides. A
 * value that arrives already asymmetric opens expanded on its own, because a
 * collapsed control cannot show it without lying about one of the numbers.
 */

interface BoxSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoxSidesLabels {
  horizontal: string;
  vertical: string;
  top: string;
  right: string;
  bottom: string;
  left: string;
  /** The toggle, named for what pressing it does next. */
  expand: string;
  collapse: string;
}

export const DEFAULT_BOX_SIDES_LABELS: BoxSidesLabels = {
  horizontal: "Left and right",
  vertical: "Top and bottom",
  top: "Top",
  right: "Right",
  bottom: "Bottom",
  left: "Left",
  expand: "Edit each side",
  collapse: "Edit as pairs",
};

/** Whether the four sides can be shown honestly as two pairs. */
function boxSidesArePaired(value: BoxSides): boolean {
  return value.left === value.right && value.top === value.bottom;
}

export function BoxSidesField({
  value,
  onChange,
  min = 0,
  max = 200,
  step = 1,
  unit = "px",
  labels = DEFAULT_BOX_SIDES_LABELS,
  className,
}: {
  value: BoxSides;
  onChange: (value: BoxSides) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  labels?: BoxSidesLabels;
  className?: string;
}) {
  const paired = boxSidesArePaired(value);
  // Asymmetric values have nowhere to live in the collapsed view, so it opens
  // itself rather than showing one side and hiding the other.
  const [openedByHand, setOpenedByHand] = useState(false);
  const expanded = openedByHand || !paired;

  const field = (
    side: keyof BoxSides,
    label: string,
    icon: React.ReactNode,
    next: (n: number) => BoxSides,
  ) => (
    <div className="flex min-w-0 items-center gap-1">
      <span aria-hidden className="shrink-0 text-muted-foreground">
        {icon}
      </span>
      <UnitField
        ariaLabel={label}
        value={value[side]}
        unit={unit}
        min={min}
        max={max}
        step={step}
        onChange={(n) => onChange(next(n))}
        className="min-w-0 flex-1"
      />
    </div>
  );

  return (
    <div className={cn("flex items-start gap-1.5", className)}>
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
        {expanded ? (
          <>
            {field("top", labels.top, <SideGlyph side="top" />, (n) => ({
              ...value,
              top: n,
            }))}
            {field("right", labels.right, <SideGlyph side="right" />, (n) => ({
              ...value,
              right: n,
            }))}
            {field("bottom", labels.bottom, <SideGlyph side="bottom" />, (n) => ({
              ...value,
              bottom: n,
            }))}
            {field("left", labels.left, <SideGlyph side="left" />, (n) => ({
              ...value,
              left: n,
            }))}
          </>
        ) : (
          <>
            {field(
              "left",
              labels.horizontal,
              <MoveHorizontal className="h-3 w-3" />,
              (n) => ({ ...value, left: n, right: n }),
            )}
            {field(
              "top",
              labels.vertical,
              <MoveVertical className="h-3 w-3" />,
              (n) => ({ ...value, top: n, bottom: n }),
            )}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          if (!expanded) {
            setOpenedByHand(true);
            return;
          }
          // Collapsing has to make the value paired again, or the control
          // would reopen on the next render and the press would do nothing.
          setOpenedByHand(false);
          if (!paired) {
            onChange({
              top: value.top,
              bottom: value.top,
              left: value.left,
              right: value.left,
            });
          }
        }}
        aria-pressed={expanded}
        aria-label={expanded ? labels.collapse : labels.expand}
        title={expanded ? labels.collapse : labels.expand}
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-[4px] border transition",
          expanded
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Scan className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** A square with one edge lit: which side this number moves. */
function SideGlyph({ side }: { side: keyof BoxSides }) {
  return (
    <span className="relative block h-3 w-3 rounded-[2px] border border-current opacity-60">
      <span
        className={cn(
          "absolute bg-current",
          side === "top" && "inset-x-0 top-0 h-[2px]",
          side === "bottom" && "inset-x-0 bottom-0 h-[2px]",
          side === "left" && "inset-y-0 left-0 w-[2px]",
          side === "right" && "inset-y-0 right-0 w-[2px]",
        )}
      />
    </span>
  );
}
