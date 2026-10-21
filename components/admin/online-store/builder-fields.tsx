"use client";

import type { ReactNode } from "react";
import { Palette } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ColorSwatchPicker } from "@/components/admin/color-swatch-picker";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import {
  ThemeColorSwatches,
  useDisplayColor,
  useThemeColorChoices,
} from "@/components/admin/theme-colors-context";
import { themeColorRef } from "@/lib/theme-colors/theme-refs";
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
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const themeChoices = useThemeColorChoices();
  const ref = themeColorRef(value);
  const display = useDisplayColor(value) ?? value;
  return (
    <FieldRow label={label}>
      <div className="flex gap-2">
        {ref ? (
          // A followed theme colour reads by name, not as a CSS variable.
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input px-3 text-sm">
            <span className="truncate">
              {tSafe("admin.themeColors.followingShort", "Theme · {name}", {
                name: tSafe(`admin.themeColors.refs.${ref.key}`, ref.label),
              })}
            </span>
          </div>
        ) : (
          <Input
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        {themeChoices ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={disabled}
                aria-label={tSafe("admin.themeColors.pick", "Use a theme color")}
                title={tSafe("admin.themeColors.pick", "Use a theme color")}
                className={cn("shrink-0", ref && "border-primary text-primary")}
              >
                <Palette className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <ThemeColorSwatches value={value} onPick={onChange} tSafe={tSafe} />
            </PopoverContent>
          </Popover>
        ) : null}
        <ColorSwatchPicker
          value={display}
          disabled={disabled}
          onChange={onChange}
          align="end"
          ariaLabel={`${label} picker`}
        />
      </div>
    </FieldRow>
  );
}
