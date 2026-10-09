"use client";

import type { ComponentType } from "react";
import {
  Aperture,
  Contrast,
  Diamond,
  Droplet,
  Loader2,
  MoonStar,
  Palette,
  RotateCcw,
  Square,
  Sun,
  SunDim,
  Thermometer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  hasActiveEffects,
  type EffectKey,
  type EffectValues,
} from "@/components/ai-authoring/studio-effects";

type IconType = ComponentType<{ className?: string }>;

type EffectControl = { key: EffectKey; label: string; icon: IconType };

const LIGHT_CONTROLS: EffectControl[] = [
  { key: "brightness", label: "Brightness", icon: Sun },
  { key: "exposure", label: "Exposure", icon: Aperture },
  { key: "contrast", label: "Contrast", icon: Contrast },
  { key: "highlights", label: "Highlights", icon: SunDim },
  { key: "shadows", label: "Shadows", icon: MoonStar },
  { key: "vignette", label: "Vignette", icon: Square },
];

const COLOR_CONTROLS: EffectControl[] = [
  { key: "saturation", label: "Saturation", icon: Palette },
  { key: "warmth", label: "Warmth", icon: Thermometer },
  { key: "tint", label: "Tint", icon: Droplet },
  { key: "sharpness", label: "Sharpness", icon: Diamond },
];

type EffectsPanelProps = {
  values: EffectValues;
  disabled?: boolean;
  applying?: boolean;
  onChange: (key: EffectKey, value: number) => void;
  onReset: () => void;
  onApply: () => void;
};

export function EffectsPanel({
  values,
  disabled = false,
  applying = false,
  onChange,
  onReset,
  onApply,
}: EffectsPanelProps) {
  const active = hasActiveEffects(values);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {disabled ? (
          <p className="px-1 pt-4 text-center text-xs text-muted-foreground">
            Select or upload an image to adjust it.
          </p>
        ) : null}

        <EffectSection
          title="Light"
          controls={LIGHT_CONTROLS}
          values={values}
          disabled={disabled || applying}
          onChange={onChange}
        />
        <EffectSection
          title="Color"
          controls={COLOR_CONTROLS}
          values={values}
          disabled={disabled || applying}
          onChange={onChange}
          className="mt-6"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t p-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={!active || applying}
          onClick={onReset}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          className="flex-1"
          disabled={!active || disabled || applying}
          onClick={onApply}
        >
          {applying ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : null}
          Apply
        </Button>
      </div>
    </div>
  );
}

function EffectSection({
  title,
  controls,
  values,
  disabled,
  onChange,
  className,
}: {
  title: string;
  controls: EffectControl[];
  values: EffectValues;
  disabled: boolean;
  onChange: (key: EffectKey, value: number) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-3 text-sm font-semibold">{title}</p>
      <div className="flex flex-col gap-4">
        {controls.map((control) => (
          <EffectSlider
            key={control.key}
            control={control}
            value={values[control.key]}
            disabled={disabled}
            onChange={(value) => onChange(control.key, value)}
          />
        ))}
      </div>
    </div>
  );
}

function EffectSlider({
  control,
  value,
  disabled,
  onChange,
}: {
  control: EffectControl;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const Icon = control.icon;
  // Center-origin fill: paint the primary colour only between the midpoint and
  // the thumb, so a neutral (0) slider reads as an untouched track.
  const pos = (value + 100) / 2;
  const lo = Math.min(50, pos);
  const hi = Math.max(50, pos);
  const track = "color-mix(in oklab, var(--primary) 22%, transparent)";
  const fill = "var(--primary)";
  const background =
    value === 0
      ? track
      : `linear-gradient(to right, ${track} 0 ${lo}%, ${fill} ${lo}% ${hi}%, ${track} ${hi}% 100%)`;

  return (
    <div className={cn(disabled && "opacity-60")}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">{control.label}</span>
        {value !== 0 ? (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {value > 0 ? `+${value}` : value}
          </span>
        ) : null}
      </div>
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={control.label}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => onChange(0)}
        style={{ background }}
        className={cn(
          "h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none disabled:cursor-not-allowed",
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-colors",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow-sm",
          "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent",
          "focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-ring",
        )}
      />
    </div>
  );
}
