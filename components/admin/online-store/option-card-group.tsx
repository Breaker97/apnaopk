"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A radio group rendered as picture cards — the Themes page's control
 * vocabulary. Every global design choice (widths, heights, roundness, button
 * shape, default appearance) is a picture, never a dropdown: a merchant
 * compares shapes, not words.
 */
export function OptionCardGroup({
  label,
  hint,
  value,
  onChange,
  options,
  columns,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  options: { key: string; label: string; diagram: ReactNode }[];
  columns: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div role="radiogroup" className={cn("grid gap-2.5", columns)}>
        {options.map((option) => {
          const selected = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.key)}
              className={cn(
                "rounded-lg border p-2 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-foreground/30",
              )}
            >
              {option.diagram}
              <p className="mt-1.5 truncate text-xs font-medium">
                {option.label}
              </p>
            </button>
          );
        })}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Mini browser frame: a header strip plus whatever the variant places. */
export function DiagramFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-20 w-full flex-col overflow-hidden rounded-md border border-border/70 bg-muted/30",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-1 px-1.5 py-1">
        <span className="h-1 w-3 rounded-sm bg-foreground/60" />
        <span className="mx-auto flex gap-0.5">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-0.5 w-2 rounded-sm bg-foreground/30" />
          ))}
        </span>
        <span className="h-1 w-2 rounded-sm bg-foreground/40" />
      </div>
      {children}
    </div>
  );
}
