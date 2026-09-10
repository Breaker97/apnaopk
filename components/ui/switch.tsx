"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  required?: boolean
}

function Switch({
  className,
  checked: controlledChecked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  ...props
}: SwitchProps) {
  const [internalChecked, setInternalChecked] = React.useState(defaultChecked)
  const isControlled = controlledChecked !== undefined
  const checked = isControlled ? controlledChecked : internalChecked
  const state = checked ? "checked" : "unchecked"

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      data-state={state}
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        const next = !checked
        if (!isControlled) setInternalChecked(next)
        onCheckedChange?.(next)
      }}
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span
        data-slot="switch-thumb"
        data-state={state}
        className={cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )}
      />
    </button>
  )
}

export { Switch }
