"use client";

import { cn } from "@/lib/utils";

/**
 * A choice between a few options as one row of buttons, one pressed in. The
 * buttons grow with their text rather than clip it: a translated label can be
 * twice the English one.
 */
export function Segmented<T extends string>(props: {
  /** The id of the element that names the group. */
  labelledBy: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
  /** The grid the buttons sit in, e.g. `grid-cols-2 sm:grid-cols-4`. */
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={props.labelledBy}
      className={cn("bg-muted grid gap-1 rounded-xl p-1", props.className)}
    >
      {props.options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={props.value === option.id}
          onClick={() => props.onChange(option.id)}
          className={cn(
            "min-h-8 rounded-lg px-2 py-1 text-xs leading-tight font-medium transition-colors",
            props.value === option.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
