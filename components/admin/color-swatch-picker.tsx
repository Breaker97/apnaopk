"use client";

import type { ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CHECKERBOARD,
  ColorPickerPanel,
} from "@/components/admin/sliders/color-picker";
import { cn } from "@/lib/utils";

/**
 * The admin's one colour control: a swatch that opens our picker panel in a
 * popover. Every colour field goes through this instead of the browser's
 * native `<input type="color">`, whose dialog differs per browser and OS.
 *
 * Pass `children` to supply a trigger of your own (rendered `asChild`, so it
 * must be a single element that forwards its ref); the default trigger is a
 * plain swatch over a chequerboard, so a translucent colour reads as one.
 */
export function ColorSwatchPicker({
  value,
  onChange,
  ariaLabel,
  alpha = true,
  disabled,
  align = "start",
  className,
  children,
}: {
  value: string;
  onChange: (hex: string) => void;
  ariaLabel: string;
  /** Offer opacity; off where the value must stay `#rrggbb`. */
  alpha?: boolean;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  /** Classes for the default swatch trigger (size, radius). */
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        {children ?? (
          <button
            type="button"
            aria-label={ariaLabel}
            title={ariaLabel}
            className={cn(
              "relative h-9 w-12 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border shadow-xs transition-shadow hover:ring-2 hover:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
            style={{ background: CHECKERBOARD }}
          >
            <span
              className="absolute inset-0"
              style={value ? { backgroundColor: value } : undefined}
            />
          </button>
        )}
      </PopoverTrigger>
      {/* Above sheets and dialogs (the sheet overlay sits at z-80). */}
      <PopoverContent
        align={align}
        className="z-[100] w-64 p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ColorPickerPanel value={value} onChange={onChange} alpha={alpha} />
      </PopoverContent>
    </Popover>
  );
}
