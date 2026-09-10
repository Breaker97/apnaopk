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
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  disableAfter?: Date;
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
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
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
          disabled={disableAfter ? { after: disableAfter } : undefined}
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
