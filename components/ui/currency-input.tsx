"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import {
  useNumberDraft,
  type NumberDraftOptions,
} from "@/components/ui/number-input";

interface CurrencyInputProps extends React.ComponentProps<typeof Input> {
  currencySymbol: string;
}

/**
 * Number input with a currency prefix. The prefix width is measured at runtime
 * so the input padding always clears the symbol — this keeps multi-character
 * currency codes (e.g. "UGX", "TZS", "USD") from overlapping the value, while
 * still looking tight for single-character symbols (e.g. "$", "€").
 *
 * `type` defaults to "number" but stays overridable: a few money fields show a
 * range ("10.00 - 25.00") until focused, which a number input cannot hold.
 */
function CurrencyInput({
  currencySymbol,
  className,
  style,
  type = "number",
  ...props
}: CurrencyInputProps) {
  const symbolRef = React.useRef<HTMLSpanElement>(null);
  const [paddingLeft, setPaddingLeft] = React.useState<number>();

  React.useLayoutEffect(() => {
    const el = symbolRef.current;
    if (!el) return;
    // left offset (0.75rem) + measured symbol width + gap (0.375rem)
    setPaddingLeft(12 + el.offsetWidth + 6);
  }, [currencySymbol]);

  return (
    <div className="relative">
      <span
        ref={symbolRef}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap text-sm text-muted-foreground"
      >
        {currencySymbol}
      </span>
      <Input
        type={type}
        className={className}
        style={{ paddingLeft, ...style }}
        {...props}
      />
    </div>
  );
}

type CurrencyNumberInputProps = Omit<
  CurrencyInputProps,
  "value" | "onChange" | "type" | "min" | "max"
> &
  NumberDraftOptions;

/** The money field: a currency prefix over the draft-aware number input. */
function CurrencyNumberInput({
  value,
  onValueChange,
  min,
  max,
  whenEmpty,
  normalize,
  onBlur,
  onKeyDown,
  ...props
}: CurrencyNumberInputProps) {
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
  return <CurrencyInput {...props} {...draft} />;
}

export { CurrencyInput, CurrencyNumberInput };
