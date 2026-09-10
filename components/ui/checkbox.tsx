"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  indeterminate?: boolean;
  required?: boolean;
}

function Checkbox({
  className,
  indeterminate,
  checked: controlledChecked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  ...props
}: CheckboxProps) {
  const [internalChecked, setInternalChecked] = React.useState(defaultChecked);
  const isControlled = controlledChecked !== undefined;
  const checked = indeterminate
    ? false
    : isControlled
      ? controlledChecked
      : internalChecked;
  const state = indeterminate ? "indeterminate" : checked ? "checked" : "unchecked";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      data-slot="checkbox"
      data-state={state}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        const next = !checked;
        if (!isControlled) setInternalChecked(next);
        onCheckedChange?.(next);
      }}
      className={cn(
        "peer border-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span
        data-slot="checkbox-indicator"
        className={cn(
          "flex items-center justify-center text-current transition-none",
          state === "unchecked" && "hidden"
        )}
      >
        {indeterminate ? (
          <Minus className="size-3.5" />
        ) : (
          <Check className="size-3.5" />
        )}
      </span>
    </button>
  );
}

export { Checkbox };
