"use client";

import type React from "react";
import { Info, Plus, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  buildCustomColorVars,
  normalizeColorToHex,
  readableForegroundColor,
  toColorInputValue,
} from "@/lib/site-config/appearance-colors";

export function SettingCard({
  icon,
  label,
  checked,
  onCheckedChange,
  hasInfo,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  hasInfo?: boolean;
}) {
  return (
    <div
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "cursor-pointer relative flex flex-col justify-between p-4 h-[100px] rounded-2xl border transition-all duration-200 select-none",
        checked
          ? "bg-background border-border shadow-sm"
          : "bg-muted/20 border-border/50 hover:bg-muted/40 hover:border-border",
      )}
    >
      <div className="flex items-start justify-between">
        <span
          className={cn(
            "transition-colors",
            checked ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {icon}
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            className="data-[state=checked]:bg-primary"
          />
        </div>
      </div>
      <div className="flex items-end justify-between">
        <span className="font-medium text-sm">{label}</span>
        {hasInfo && <Info className="h-4 w-4 text-muted-foreground/40" />}
      </div>
    </div>
  );
}

export function SectionContainer({
  label,
  children,
  icon,
}: {
  label: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="relative p-4 pt-8 rounded-2xl border border-border/60 bg-muted/10">
      <span className="absolute -top-2.5 left-4 px-2.5 py-1 bg-primary/10 text-primary border border-primary/25 text-[10px] font-bold uppercase rounded-full tracking-wider flex items-center gap-1 ring-4 ring-background shadow-sm">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

export function NavColorCard({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const isIntegrate = label === "Integrate";

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer flex items-center justify-center gap-2 h-11 rounded-2xl transition-all font-medium text-sm",
        isActive
          ? "bg-background border border-border shadow-sm text-foreground"
          : "bg-transparent border border-transparent text-muted-foreground hover:bg-muted/40",
      )}
    >
      <div
        className={cn(
          "h-6 w-6 rounded-lg border-2 flex items-start p-0.5 gap-0.5 overflow-hidden",
          isActive
            ? "border-primary/50 bg-primary/5"
            : "border-muted-foreground/30 bg-muted/50",
        )}
      >
        <div
          className={cn(
            "w-1.5 h-full rounded-sm",
            isActive
              ? "bg-primary"
              : isIntegrate
                ? "bg-primary/60"
                : "bg-muted-foreground/40",
          )}
        />
        <div className="flex-1 h-full flex flex-col gap-0.5">
          <div
            className={cn(
              "h-1/3 w-full rounded-sm",
              isActive ? "bg-primary/20" : "bg-muted-foreground/15",
            )}
          />
          <div
            className={cn(
              "flex-1 w-full rounded-sm",
              isActive ? "bg-primary/10" : "bg-muted-foreground/10",
            )}
          />
        </div>
      </div>
      <span>{label}</span>
    </div>
  );
}

export function PresetColorCard({
  color,
  isActive,
  onClick,
}: {
  color: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer overflow-hidden rounded-xl transition-all h-16 p-1.5",
        isActive
          ? "bg-background border border-border/80 shadow-sm"
          : "bg-transparent border border-transparent hover:bg-muted/30",
      )}
    >
      <div className="flex h-full w-full gap-1 bg-background rounded-lg overflow-hidden p-1">
        <div
          className="w-[35%] h-full rounded-md"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 flex flex-col gap-0.5 h-full">
          <div
            className="h-[35%] w-full rounded-md"
            style={{ backgroundColor: color, opacity: 0.3 }}
          />
          <div
            className="flex-1 w-full rounded-md"
            style={{ backgroundColor: color, opacity: 0.15 }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Labeled color input pairing a native swatch picker with a free-text field.
 * The text field accepts hex or rgb()/rgba() and reports raw keystrokes via
 * `onChange` (so partial input isn't fought) while `onCommit` fires on blur so
 * callers can normalize to hex. The swatch always renders a valid `#rrggbb`.
 */
export function ColorField({
  id,
  label,
  value,
  onChange,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const swatchValue = toColorInputValue(value, "#000000");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2 transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/25">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={swatchValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          id={id}
          type="text"
          value={value ?? ""}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          placeholder="#2065D1"
          className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

/**
 * A saved custom preset — the same swatch preview as {@link PresetColorCard}
 * plus a hover remove control and an optional caption.
 */
export function CustomPresetCard({
  color,
  name,
  isActive,
  onClick,
  onRemove,
}: {
  color: string;
  name?: string;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group relative">
      <PresetColorCard color={color} isActive={isActive} onClick={onClick} />
      <button
        type="button"
        aria-label={`Remove ${name || "custom"} preset`}
        title="Remove preset"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute -right-1.5 -top-1.5 z-10 hidden h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-transform hover:scale-110 group-hover:flex"
      >
        <X className="h-3 w-3" />
      </button>
      {name ? (
        <span className="mt-1 block truncate px-1 text-center text-[10px] leading-3 text-muted-foreground">
          {name}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Prompt shown when the current colors match no preset: a dashed swatch of the
 * live primary color that persists the current triple as a new custom preset.
 */
export function AddCurrentPresetCard({
  color,
  onSave,
}: {
  color: string;
  onSave: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSave}
      title="Save current colors as a preset"
      aria-label="Save current colors as a preset"
      className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-primary/40 bg-primary/5 text-primary transition-all hover:bg-primary/10"
    >
      <span
        className="h-5 w-5 rounded-md border border-border/60 shadow-sm"
        style={{ backgroundColor: color }}
      />
      <span className="flex items-center gap-0.5 text-[10px] font-semibold">
        <Plus className="h-3 w-3" />
        Save
      </span>
    </button>
  );
}

/**
 * Live preview of the current brand colors. It maps the selected colors onto
 * the same CSS variables the whole app consumes (via `buildCustomColorVars`),
 * but scoped to this container — so the samples respond as colors are edited,
 * before saving, and mirror exactly how primary/secondary/accent render app
 * wide. Accent is also shown as a solid chip because its global token is a
 * subtle 12% surface tint that is otherwise easy to miss.
 */
export function ColorSystemPreview({
  primary,
  secondary,
  accent,
}: {
  primary?: string;
  secondary?: string;
  accent?: string;
}) {
  const scopedVars = buildCustomColorVars({
    primary,
    secondary,
    accent,
  }) as React.CSSProperties;
  const accentHex = normalizeColorToHex(accent);

  return (
    <div
      style={scopedVars}
      className="rounded-2xl border border-border bg-card p-4"
    >
      <div className="mb-3 flex items-center gap-1.5">
        <span className="text-xs font-semibold text-foreground">Preview</span>
        <span className="text-[11px] text-muted-foreground">
          — how your colors apply across the app
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-sm">
          Primary
        </span>
        <span className="inline-flex h-9 items-center rounded-lg bg-secondary px-3.5 text-sm font-medium text-secondary-foreground">
          Secondary
        </span>
        {accentHex ? (
          <span
            className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium shadow-sm"
            style={{
              backgroundColor: accentHex,
              color: readableForegroundColor(accentHex),
            }}
          >
            Accent
          </span>
        ) : null}
        <span className="inline-flex h-9 items-center rounded-lg border border-primary/40 px-3.5 text-sm font-medium text-primary">
          Outline
        </span>
        <span className="text-sm font-medium text-primary underline underline-offset-2">
          Link
        </span>
        <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-foreground">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: accentHex ?? "var(--accent-color)" }}
          />
          Accent surface
        </span>
      </div>
    </div>
  );
}
