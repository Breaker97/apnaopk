"use client";

import {
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { Input } from "@/components/ui/input";

/**
 * A number input the merchant can actually type into.
 *
 * Every numeric field in the admin is controlled by form or builder state,
 * and the naive `onChange={(e) => onChange(parseFloat(e.target.value) || 0)}`
 * made half of them unusable: "0." parses to 0 and re-renders as "0", so a
 * decimal point could never be typed; clearing the field wrote "0" straight
 * back; a floor of 16 turned a typed "5" into 16 and the next "0" into 160.
 *
 * So the text being typed lives here as a draft while the field is focused.
 * In-range values are sent up live (previews and totals follow the
 * keystrokes); half-typed or out-of-range text waits; blur or Enter commits
 * the clamped result and Escape drops the draft. The draft remembers which
 * value it was typed against, so an external change while focused (an undo,
 * a scrub on a unit label) shows through instead of hiding behind stale text.
 */
export interface NumberDraftOptions {
  value: number | null | undefined;
  onValueChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  /**
   * What a cleared field means: a number (sent live, so a required field
   * can hold 0 while the box reads empty), `"keep"` to leave the last value
   * in place until something is typed, or the default `undefined` for an
   * optional field that is unset when empty.
   */
  whenEmpty?: number | "keep";
  /** Applied to every value before it is sent, e.g. rounding to a step. */
  normalize?: (value: number) => number;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

interface Draft {
  text: string;
  /** The value the parent is expected to hold while this text is shown. */
  value: number | undefined;
}

export function useNumberDraft({
  value,
  onValueChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  whenEmpty,
  normalize = (next) => next,
  onBlur,
  onKeyDown,
}: NumberDraftOptions) {
  const [draft, setDraftState] = useState<Draft | null>(null);
  // Mirrored in a ref so Enter-then-blur (or any two handlers in one tick)
  // sees the commit the first one made instead of a stale closure.
  const draftRef = useRef<Draft | null>(null);
  const setDraft = (next: Draft | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const current = value ?? undefined;
  const clamp = (next: number) => Math.min(max, Math.max(min, normalize(next)));
  const parse = (text: string): number | null => {
    if (text.trim() === "") return null;
    const next = Number(text);
    return Number.isFinite(next) ? next : null;
  };
  const send = (next: number | undefined) => {
    if (next !== current) onValueChange(next);
  };
  const commit = () => {
    const pending = draftRef.current;
    if (!pending) return;
    const parsed = parse(pending.text);
    if (parsed !== null) send(clamp(parsed));
    setDraft(null);
  };

  return {
    type: "number" as const,
    value:
      draft && draft.value === current
        ? draft.text
        : current === undefined
          ? ""
          : String(current),
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined,
    onChange: (event: { target: { value: string } }) => {
      const text = event.target.value;
      if (text.trim() === "") {
        if (whenEmpty === "keep") {
          setDraft({ text, value: current });
        } else {
          setDraft({ text, value: whenEmpty });
          send(whenEmpty);
        }
        return;
      }
      const parsed = parse(text);
      if (parsed !== null && parsed >= min && parsed <= max) {
        const next = normalize(parsed);
        setDraft({ text, value: next });
        send(next);
      } else {
        setDraft({ text, value: current });
      }
    },
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      commit();
      onBlur?.(event);
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        commit();
      } else if (event.key === "Escape" && draftRef.current) {
        event.preventDefault();
        setDraft(null);
      }
      onKeyDown?.(event);
    },
  };
}

export type NumberInputProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange" | "type" | "min" | "max"
> &
  NumberDraftOptions;

export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  whenEmpty,
  normalize,
  onBlur,
  onKeyDown,
  ...props
}: NumberInputProps) {
  const draft = useNumberDraft({
    value,
    onValueChange,
    min,
    max,
    whenEmpty,
    normalize,
    onBlur,
    onKeyDown,
  });
  return <Input {...props} {...draft} />;
}
