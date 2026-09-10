"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Shared form primitives for the online-store header/footer builders. */

export function FieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function SwitchRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border px-3 py-2.5",
        disabled && "opacity-55",
      )}
    >
      <Label className="m-0">{label}</Label>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

export function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <FieldRow label={label}>
      <div className="flex gap-2">
        <Input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 shrink-0 p-1"
          aria-label={`${label} picker`}
        />
      </div>
    </FieldRow>
  );
}
