"use client";

import type { ComponentType, ReactNode } from "react";
import { Switch } from "@/components/ui/switch";

/**
 * A titled list of switches in one bordered box with hairline rows — the
 * Settings → Products look, shared with Multi-Vendor Mode's policy list.
 */
export function FeatureGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {title}
      </h3>
      {/* A container, so SettingRows inside lay out by the card's width. */}
      <div className="@container divide-y rounded-lg border">{children}</div>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </section>
  );
}

/**
 * One switch with its icon, name and what it covers; the whole row toggles it.
 * `children` sit under the row, outside the clickable label: a note about an
 * unsaved change, or the settings that only apply while the switch is on.
 */
export function FeatureRow({
  icon: Icon,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  const row = (
    <label className="flex cursor-pointer items-start gap-3 p-4 has-[button:disabled]:cursor-default">
      <span className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-sm">{description}</span>
      </span>
      <Switch
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={title}
      />
    </label>
  );
  return children ? (
    <div>
      {row}
      {children}
    </div>
  ) : (
    row
  );
}
