"use client";

import * as React from "react";
import { Phone } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PHONE_CODES } from "@/lib/intl/phone-codes";

interface PhoneNumberFieldProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  /** Selected dial code, e.g. "+91". */
  code: string;
  /** Called when the dial code changes. */
  onCodeChange: (code: string) => void;
  /** Phone number (without the dial code). */
  value?: string;
  /** Called when the phone number changes. */
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  /** Extra classes for the outer wrapper. */
  wrapperClassName?: string;
}

/**
 * Reusable phone field: a searchable dial-code select paired with a phone
 * number <Input>. Keeps the currently selected code visible even when it is
 * not part of the shortlisted PHONE_CODES options.
 */
export function PhoneNumberField({
  code,
  onCodeChange,
  value,
  onChange,
  className,
  wrapperClassName,
  placeholder = "Enter phone number",
  ref,
  ...inputProps
}: PhoneNumberFieldProps) {
  const options = React.useMemo(() => {
    if (!code || PHONE_CODES.some((c) => c.value === code)) return PHONE_CODES;
    return [{ value: code, label: code }, ...PHONE_CODES];
  }, [code]);

  return (
    <div className={cn("flex gap-2", wrapperClassName)}>
      <SearchableSelect
        options={options}
        value={code}
        onValueChange={onCodeChange}
        searchPlaceholder="Search code..."
        emptyText="No codes found"
        className="h-10 w-24 shrink-0"
        contentClassName="w-56"
        // Compact trigger: show only the dial code, not the full label.
        renderValue={(option) => option.value}
      />
      <div className="relative flex-1">
        <Phone className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={ref}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={placeholder}
          className={cn("h-10 pl-10 w-full", className)}
          value={value}
          onChange={onChange}
          {...inputProps}
        />
      </div>
    </div>
  );
}
