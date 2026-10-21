"use client";

/**
 * Small building blocks for the right panel: a titled section (a card, as
 * the Slider editor's inspector groups are), a labelled
 * row, a millimetre input (0.1 mm, via `NumberInput`, so typing a decimal
 * point or clearing the field never writes a stray value), and a Radix
 * select. Ids come from `useId`: the panel can be on screen as a column and
 * as a drawer.
 */
import { useId, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { roundMm } from "@/lib/invoice-templates/units";
import { cn } from "@/lib/utils";
import { EDITOR_CARD_CLASS, EDITOR_HINT_CLASS, EDITOR_TITLE_CLASS } from "./editor-styles";

export function PanelSection({ title, children, hint, ...props }: { title: string; hint?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section aria-label={title} className={EDITOR_CARD_CLASS} {...props}>
      <h3 className={cn("px-3 py-2.5", EDITOR_TITLE_CLASS)}>{title}</h3>
      <div className="space-y-3 border-t border-border px-3 py-3">
        {hint && <p className={EDITOR_HINT_CLASS}>{hint}</p>}
        {children}
      </div>
    </section>
  );
}

/** A label above its control; `children` receives the id to put on the control. */
export function Field({ label, children, className }: { label: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </Label>
      {children(id)}
    </div>
  );
}

export interface UnitInputProps {
  id: string;
  value: number;
  onChange: (value: number) => void;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  normalize?: (value: number) => number;
  /** Data attribute for tests and scripts: `data-field`. */
  field?: string;
}

/** A number with its unit beside it (mm, °); a cleared field keeps the last value until something is typed. */
export function UnitInput({ id, value, onChange, unit, min, max, step = 0.1, disabled, normalize = roundMm, field }: UnitInputProps) {
  return (
    <div className="relative">
      <NumberInput
        id={id}
        value={value}
        onValueChange={(next) => {
          if (next !== undefined) onChange(next);
        }}
        whenEmpty="keep"
        min={min}
        max={max}
        step={step}
        normalize={normalize}
        disabled={disabled}
        data-field={field}
        className="h-8 pe-9 tabular-nums"
      />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

export interface ChoiceSelectProps<T extends string> {
  id: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  field?: string;
}

export function ChoiceSelect<T extends string>({ id, value, options, onChange, disabled, field }: ChoiceSelectProps<T>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
      <SelectTrigger id={id} className="h-8 w-full" data-field={field}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface SegmentedProps<T extends string> {
  /** Names the group for assistive tech. */
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  field?: string;
  className?: string;
}

/** A short row of mutually exclusive choices (alignment, fixed text or data field). */
export function Segmented<T extends string>({ label, value, options, onChange, disabled, field, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} data-field={field} className={cn("flex w-full overflow-hidden rounded-[8px] border border-border", className)}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.title}
            title={option.title}
            data-value={option.value}
            disabled={disabled}
            onClick={() => {
              if (!checked) onChange(option.value);
            }}
            className={cn(
              "flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 border-s border-border px-2 text-xs font-medium transition-colors first:border-s-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              checked ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface OptionalNumberProps {
  id: string;
  /** `undefined` is "automatic". */
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  normalize?: (value: number) => number;
  field?: string;
}

/** A number that may be left empty ("Automatic"): clearing the field sends `undefined`. */
export function OptionalNumber({ id, value, onChange, placeholder, min, max, step = 1, unit, disabled, normalize, field }: OptionalNumberProps) {
  return (
    <div className="relative">
      <NumberInput
        id={id}
        value={value}
        onValueChange={onChange}
        min={min}
        max={max}
        step={step}
        normalize={normalize}
        disabled={disabled}
        placeholder={placeholder}
        data-field={field}
        className={cn("h-8 tabular-nums", unit && "pe-9")}
      />
      {unit && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs text-muted-foreground">
          {unit}
        </span>
      )}
    </div>
  );
}
