"use client";

import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { UnitField } from "@/components/admin/unit-field";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SLIDE_PLATE,
  SLIDER_ARROW_POSITIONS,
  SLIDER_ARROW_STYLES,
  SLIDER_DOT_POSITIONS,
  SLIDER_DOT_STYLES,
  type SlidePlate,
  type SlideSchedule,
  type SliderControls,
} from "@/lib/sliders/types";
import { ColorPickerPanel } from "./color-picker";

/**
 * The small property groups a slide and a slider hang off the inspector:
 * the plate behind the copy, a slide's schedule, the carousel's controls,
 * the copy's reveal. Each is the FIELDS alone — the inspector opens them
 * as a panel of their own, with the title and the way back in its header,
 * so nothing here floats over the canvas.
 */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The plate                                                                  */
/* -------------------------------------------------------------------------- */

export interface PlateLabels {
  title: string;
  enabled: string;
  color: string;
  padding: string;
  radius: string;
  blur: string;
  hint: string;
}

export function PlateFields({
  value,
  onChange,
  labels,
}: {
  value?: SlidePlate;
  onChange: (plate: SlidePlate | undefined) => void;
  labels: PlateLabels;
}) {
  const [showColor, setShowColor] = useState(false);
  const plate = value ?? DEFAULT_SLIDE_PLATE;
  const patch = (next: Partial<SlidePlate>) => onChange({ ...plate, ...next });
  return (
    <div className="space-y-3">
      <Row label={labels.enabled}>
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(on) => onChange(on ? { ...DEFAULT_SLIDE_PLATE } : undefined)}
          aria-label={labels.enabled}
        />
      </Row>
      {value ? (
        <>
          <Row label={labels.color}>
            <button
              type="button"
              onClick={() => setShowColor((open) => !open)}
              className={cn(
                "h-8 w-14 rounded-md border shadow-sm transition",
                showColor ? "border-primary ring-2 ring-primary/30" : "border-border",
              )}
              style={{ backgroundColor: plate.color }}
              aria-label={labels.color}
            />
          </Row>
          {showColor ? (
            // The picker carries an alpha channel: a plate is usually a
            // tint, not a slab.
            <ColorPickerPanel value={plate.color} onChange={(hex) => patch({ color: hex })} />
          ) : null}
          <Row label={labels.padding}>
            <UnitField ariaLabel={labels.padding} value={plate.padding} unit="px" min={0} max={120} onChange={(padding) => patch({ padding })} className="w-28" />
          </Row>
          <Row label={labels.radius}>
            <UnitField ariaLabel={labels.radius} value={plate.radius} unit="px" min={0} max={80} onChange={(radius) => patch({ radius })} className="w-28" />
          </Row>
          <Row label={labels.blur}>
            <UnitField ariaLabel={labels.blur} value={plate.blur} unit="px" min={0} max={40} onChange={(blur) => patch({ blur })} className="w-28" />
          </Row>
        </>
      ) : null}
      <p className="text-[11px] leading-snug text-muted-foreground">{labels.hint}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The schedule                                                               */
/* -------------------------------------------------------------------------- */

export interface ScheduleLabels {
  title: string;
  start: string;
  end: string;
  clear: string;
  hint: string;
}

/** A stored instant as the field shows it, in the browser's own zone. */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ScheduleFields({
  value,
  onChange,
  labels,
}: {
  value?: SlideSchedule;
  onChange: (schedule: SlideSchedule | undefined) => void;
  labels: ScheduleLabels;
}) {
  const set = (key: "start" | "end", raw: string) => {
    const next: SlideSchedule = { ...(value ?? {}) };
    if (raw) next[key] = new Date(raw).toISOString();
    else delete next[key];
    onChange(next.start || next.end ? next : undefined);
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <span className="text-xs font-medium">{labels.start}</span>
        <Input type="datetime-local" value={toLocalInput(value?.start)} onChange={(event) => set("start", event.target.value)} className="h-9" />
      </div>
      <div className="space-y-1">
        <span className="text-xs font-medium">{labels.end}</span>
        <Input type="datetime-local" value={toLocalInput(value?.end)} onChange={(event) => set("end", event.target.value)} className="h-9" />
      </div>
      {value ? (
        <Button type="button" variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => onChange(undefined)}>
          {labels.clear}
        </Button>
      ) : null}
      <p className="text-[11px] leading-snug text-muted-foreground">{labels.hint}</p>
    </div>
  );
}

/** Where a slide stands against its window right now. */
export function scheduleState(
  schedule: SlideSchedule | undefined,
  now: Date,
): "always" | "upcoming" | "live" | "ended" {
  if (!schedule) return "always";
  const at = now.getTime();
  if (schedule.start && at < Date.parse(schedule.start)) return "upcoming";
  if (schedule.end && at >= Date.parse(schedule.end)) return "ended";
  return "live";
}

/* -------------------------------------------------------------------------- */
/* The carousel's controls                                                    */
/* -------------------------------------------------------------------------- */

export interface ControlsLabels {
  title: string;
  arrows: string;
  arrowsPosition: string;
  dots: string;
  dotsPosition: string;
  pause: string;
  arrowStyles: Record<SliderControls["arrows"], string>;
  arrowPositions: Record<SliderControls["arrowsPosition"], string>;
  dotStyles: Record<SliderControls["dots"], string>;
  dotPositions: Record<SliderControls["dotsPosition"], string>;
  hint: string;
}

export function ControlsFields({
  value,
  onChange,
  labels,
}: {
  value: SliderControls;
  onChange: (controls: SliderControls) => void;
  labels: ControlsLabels;
}) {
  const select = <K extends keyof SliderControls>(
    key: K,
    options: readonly SliderControls[K][],
    names: Record<string, string>,
    label: string,
  ) => (
    <Row label={label}>
      <NativeSelect
        value={String(value[key])}
        aria-label={label}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        className="h-8 w-32 text-xs"
      >
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {names[String(option)]}
          </option>
        ))}
      </NativeSelect>
    </Row>
  );
  return (
    <div className="space-y-3">
      {select("arrows", SLIDER_ARROW_STYLES, labels.arrowStyles, labels.arrows)}
      {value.arrows !== "none"
        ? select("arrowsPosition", SLIDER_ARROW_POSITIONS, labels.arrowPositions, labels.arrowsPosition)
        : null}
      {select("dots", SLIDER_DOT_STYLES, labels.dotStyles, labels.dots)}
      {value.dots !== "none"
        ? select("dotsPosition", SLIDER_DOT_POSITIONS, labels.dotPositions, labels.dotsPosition)
        : null}
      <Row label={labels.pause}>
        <Switch checked={value.pause} onCheckedChange={(pause) => onChange({ ...value, pause })} aria-label={labels.pause} />
      </Row>
      <p className="text-[11px] leading-snug text-muted-foreground">{labels.hint}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The reveal                                                                 */
/* -------------------------------------------------------------------------- */

export interface AnimationLabels {
  title: string;
  reveal: string;
  reveals: Record<string, string>;
  duration: string;
  stagger: string;
  easing: string;
  easings: Record<string, string>;
  hint: string;
}

/**
 * How the copy arrives: which reveal, how long it takes, and how far apart
 * the elements come in. A stagger of zero is one reveal, as before.
 */
export function AnimationFields({
  reveal,
  reveals,
  duration,
  stagger,
  easing,
  easings,
  onChange,
  labels,
}: {
  reveal: string;
  reveals: readonly string[];
  duration: number;
  stagger: number;
  easing: string;
  easings: readonly string[];
  onChange: (patch: {
    reveal?: string;
    revealDuration?: number;
    revealStagger?: number;
    revealEasing?: string;
  }) => void;
  labels: AnimationLabels;
}) {
  return (
    <div className="space-y-3">
      <Row label={labels.reveal}>
        <NativeSelect
          value={reveal}
          aria-label={labels.reveal}
          onChange={(event) => onChange({ reveal: event.target.value })}
          className="h-8 w-32 text-xs"
        >
          {reveals.map((option) => (
            <option key={option} value={option}>
              {labels.reveals[option] ?? option}
            </option>
          ))}
        </NativeSelect>
      </Row>
      {reveal !== "none" ? (
        <>
          <Row label={labels.duration}>
            <UnitField
              ariaLabel={labels.duration}
              value={duration}
              unit="ms"
              min={200}
              max={2000}
              step={50}
              onChange={(revealDuration) => onChange({ revealDuration })}
              className="w-28"
            />
          </Row>
          <Row label={labels.stagger}>
            <UnitField
              ariaLabel={labels.stagger}
              value={stagger}
              unit="ms"
              zeroLabel="off"
              min={0}
              max={400}
              step={10}
              onChange={(revealStagger) => onChange({ revealStagger })}
              className="w-28"
            />
          </Row>
          <Row label={labels.easing}>
            <NativeSelect
              value={easing}
              aria-label={labels.easing}
              onChange={(event) => onChange({ revealEasing: event.target.value })}
              className="h-8 w-32 text-xs"
            >
              {easings.map((option) => (
                <option key={option} value={option}>
                  {labels.easings[option] ?? option}
                </option>
              ))}
            </NativeSelect>
          </Row>
        </>
      ) : null}
      <p className="text-[11px] leading-snug text-muted-foreground">{labels.hint}</p>
    </div>
  );
}
