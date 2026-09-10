"use client";

import { useRef, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { useNumberDraft } from "@/components/ui/number-input";
import { cn } from "@/lib/utils";

/**
 * The admin's ONE numeric control: a typed number with a draggable unit
 * label (drag "PX" left/right to nudge the value). Born in the Header
 * Studio; every builder that used to put a value on a slider rail — the
 * product page and card editors, the slide toolbar and text styles, the
 * theme token controls — renders this instead, because a rail 200px wide
 * cannot land on "13" and a number field can.
 */

/**
 * Chrome draws stepper arrows inside a number input, which in a 130px-wide
 * property field leaves no room for the number itself.
 */
const NO_SPINNERS =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/** Pointer travel, in px, per step of value while scrubbing. */
const SCRUB_PX_PER_STEP = 4;

function roundToStep(value: number, step: number): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(value.toFixed(decimals));
}

/**
 * The Figma unit label: hover it for a left/right cursor, drag it to nudge
 * the number one step per few pixels of travel. Pointer capture keeps the
 * drag alive after the cursor leaves the tiny label, and the body cursor is
 * pinned so it does not flicker over whatever is passed on the way. The
 * value is clamped to the field's range, exactly as typing would be.
 */
export function ScrubHandle({
  value,
  min,
  max,
  step,
  onChange,
  label,
  children,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
  children: ReactNode;
}) {
  const [scrubbing, setScrubbing] = useState(false);
  const origin = useRef<{ x: number; value: number } | null>(null);

  const scrubTo = (clientX: number) => {
    if (!origin.current) return;
    const steps = Math.round((clientX - origin.current.x) / SCRUB_PX_PER_STEP);
    const next = roundToStep(origin.current.value + steps * step, step);
    onChange(Math.min(max, Math.max(min, next)));
  };

  return (
    <span
      role="slider"
      tabIndex={-1}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title={label}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        origin.current = { x: event.clientX, value };
        setScrubbing(true);
        document.body.style.cursor = "ew-resize";
      }}
      onPointerMove={(event) => {
        if (origin.current) scrubTo(event.clientX);
      }}
      onPointerUp={(event) => {
        if (!origin.current) return;
        scrubTo(event.clientX);
        origin.current = null;
        setScrubbing(false);
        document.body.style.cursor = "";
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        origin.current = null;
        setScrubbing(false);
        document.body.style.cursor = "";
      }}
      className={cn(
        "flex h-full shrink-0 cursor-ew-resize select-none items-center px-1 text-[10px] uppercase text-muted-foreground transition-colors hover:text-foreground",
        scrubbing && "text-primary",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The unit field's input: the shared draft-aware number input, rounded to
 * the step, keeping the last value when cleared (a size has no "unset"),
 * and blurring on Enter so the committed value is what the box shows.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  id,
  ariaLabel,
  disabled,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const draft = useNumberDraft({
    value,
    min,
    max,
    whenEmpty: "keep",
    normalize: (next) => roundToStep(next, step),
    onValueChange: (next) => {
      if (next !== undefined) onChange(next);
    },
    onKeyDown: (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
  });
  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      step={step}
      disabled={disabled}
      {...draft}
      className={cn(
        "h-8 min-w-0 flex-1 border-0 bg-transparent text-xs tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent",
        NO_SPINNERS,
        className,
      )}
    />
  );
}

export function UnitField({
  value,
  unit,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  zeroLabel,
  ariaLabel,
  id,
  disabled,
  className,
}: {
  value: number;
  /** The draggable suffix: "px", "%", "°", "s". */
  unit: string;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Replaces the unit while the value is 0 and 0 means "use the default". */
  zeroLabel?: string;
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-8 items-center rounded-[4px] border bg-background pr-1 focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "opacity-50",
        className,
      )}
    >
      <NumberInput
        id={id}
        ariaLabel={ariaLabel}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={onChange}
        className="px-2"
      />
      <ScrubHandle
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={disabled ? () => undefined : onChange}
        label={ariaLabel ?? unit}
      >
        {value === 0 && zeroLabel ? zeroLabel : unit}
      </ScrubHandle>
    </div>
  );
}
