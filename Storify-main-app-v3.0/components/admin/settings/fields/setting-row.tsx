"use client";

import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * The rows settings cards are built from: one bordered list with hairline
 * rows, each a setting's name and why on the left and a narrow control on the
 * right (Order Settings, Multi-Vendor Mode).
 *
 * The list is a container, and rows lay out by ITS width rather than the
 * viewport's: at 768px the admin sidebar leaves a card about 415px wide, and a
 * viewport `sm:` breakpoint put the control beside a label squeezed to one
 * word per line.
 */
export function SettingList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("@container divide-y rounded-lg border", className)}>
      {children}
    </div>
  );
}

/**
 * A setting with its control beside it. With `inputId` the name labels that
 * input; `align="start"` keeps a control that is taller than one line (an
 * input with a checkbox under it) level with the name.
 */
export function SettingRow({
  inputId,
  label,
  hint,
  align = "center",
  className,
  children,
}: {
  inputId?: string;
  label: ReactNode;
  hint?: ReactNode;
  align?: "center" | "start";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-4 @xl:flex-row @xl:gap-6",
        align === "start" ? "@xl:items-start" : "@xl:items-center",
        className,
      )}
    >
      <SettingText inputId={inputId} label={label} hint={hint} />
      <div className="flex shrink-0 flex-wrap items-center gap-2 @xl:w-72">
        {children}
      </div>
    </div>
  );
}

/** A setting whose control needs the row's full width: a list, chips, a textarea. */
export function SettingBlock({
  inputId,
  label,
  hint,
  className,
  children,
}: {
  inputId?: string;
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-3 p-4", className)}>
      <SettingText inputId={inputId} label={label} hint={hint} />
      {children}
    </div>
  );
}

/** A switch as a list row; the whole row toggles it. */
export function SettingSwitchItem({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4 p-4 has-[button:disabled]:cursor-default">
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-sm font-medium">{title}</span>
        {description ? (
          <span className="text-muted-foreground block text-sm">
            {description}
          </span>
        ) : null}
      </span>
      <Switch
        className="mt-1"
        checked={checked}
        disabled={disabled}
        aria-label={title}
        onCheckedChange={onCheckedChange}
      />
    </label>
  );
}

/** The muted word beside an input: a unit, "days", a currency code. */
export function SettingUnit({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground text-sm">{children}</span>;
}

function SettingText({
  inputId,
  label,
  hint,
}: {
  inputId?: string;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1 space-y-0.5">
      {inputId ? (
        <label htmlFor={inputId} className="block text-sm font-medium">
          {label}
        </label>
      ) : (
        <p className="text-sm font-medium">{label}</p>
      )}
      {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
    </div>
  );
}
