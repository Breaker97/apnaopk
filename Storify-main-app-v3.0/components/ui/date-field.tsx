"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A single date, as the rest of the admin picks dates.
 *
 * The value is "YYYY-MM-DD" — a calendar day, not an instant — because that is
 * what a dated record stores and what an API parses. Days are read and written
 * in the viewer's own timezone: an expense entered on the 1st is on the 1st.
 *
 * Native `<input type="date">` was doing this job, and it renders the browser's
 * format rather than the store's ("27/08/2026" to a reader who writes 8/27),
 * with a picker that matches nothing else on the screen.
 */
export function DateField({
  id,
  value,
  onChange,
  disabled,
  className,
  placeholder,
  /** Days after this cannot be picked — a cost cannot be incurred in the future. */
  disableAfter,
  /** Days before this cannot be picked — a bill cannot be paid before it exists. */
  disableBefore,
  /**
   * Month and year menus in the calendar's caption, reaching back to
   * `startMonth` — for a date that may be years ago.
   */
  yearPicker = false,
  startMonth,
  /** The last month the menus offer; defaults to `disableAfter`. */
  endMonth,
  invalid = false,
  ariaDescribedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  disableAfter?: Date;
  disableBefore?: Date;
  yearPicker?: boolean;
  startMonth?: Date;
  endMonth?: Date;
  invalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);

  const selected = React.useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }, [value]);

  const text = selected
    ? new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(selected)
    : placeholder || "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            invalid && "border-destructive",
            className,
          )}
        >
          {text}
          <CalendarDays className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={[
            ...(disableAfter ? [{ after: disableAfter }] : []),
            ...(disableBefore ? [{ before: disableBefore }] : []),
          ]}
          captionLayout={yearPicker ? "dropdown" : "label"}
          startMonth={yearPicker ? startMonth : undefined}
          endMonth={yearPicker ? (endMonth ?? disableAfter) : undefined}
          onSelect={(date) => {
            if (!date) return;
            // Formatted from the local parts, never `toISOString()`: that is
            // UTC, and west of Greenwich it hands back the previous day.
            onChange(
              `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
            );
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
