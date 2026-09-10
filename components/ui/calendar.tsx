"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";
import type { DayProps } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

type CalendarProps = React.ComponentProps<typeof DayPicker>;

const RANGE_START_CLASS =
  "rounded-l-full bg-[#f0f2f5] dark:bg-muted [&>button]:!bg-[#1d5cff] [&>button]:!text-white [&>button]:hover:!bg-[#1d5cff]";
const RANGE_MIDDLE_CLASS =
  "bg-[#f0f2f5] dark:bg-muted [&>button]:!bg-transparent [&>button]:!text-[#172033] [&>button]:hover:!bg-transparent dark:[&>button]:!text-foreground";
const RANGE_END_CLASS =
  "rounded-r-full bg-[#f0f2f5] dark:bg-muted [&>button]:!bg-[#1d5cff] [&>button]:!text-white [&>button]:hover:!bg-[#1d5cff]";

function isTrailingOutsideDay(day: DayProps["day"]): boolean {
  if (!day.outside) return false;

  const dateMonth = new Date(day.date.getFullYear(), day.date.getMonth(), 1);
  const displayMonth = new Date(
    day.displayMonth.getFullYear(),
    day.displayMonth.getMonth(),
    1,
  );

  return dateMonth > displayMonth;
}

function withoutRangePaint(className?: string): string | undefined {
  if (!className) return className;

  return [RANGE_START_CLASS, RANGE_MIDDLE_CLASS, RANGE_END_CLASS].reduce(
    (nextClassName, rangeClassName) =>
      nextClassName.replace(rangeClassName, ""),
    className,
  );
}

function CalendarDay({ day, className, ...props }: DayProps) {
  return (
    <td
      className={cn(
        isTrailingOutsideDay(day) ? withoutRangePaint(className) : className,
      )}
      {...props}
    ></td>
  );
}

function Calendar({
  className,
  classNames,
  components,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-0", className)}
      classNames={{
        root: "w-full",
        months: "flex flex-col gap-8 md:flex-row md:gap-8",
        month: "w-[282px] space-y-4",
        month_caption: "relative flex h-8 items-center justify-center px-10",
        caption_label:
          "text-base font-semibold text-[#172033] dark:text-foreground",
        nav: "contents",
        button_previous:
          "absolute left-0 top-0 z-10 flex size-8 items-center justify-center rounded-md text-[#172033] transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 dark:text-foreground",
        button_next:
          "absolute right-0 top-0 z-10 flex size-8 items-center justify-center rounded-md text-[#172033] transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 dark:text-foreground",
        chevron: "size-4",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "flex size-10 items-center justify-center text-[13px] font-medium text-[#667085] dark:text-muted-foreground",
        weeks: "flex flex-col gap-1",
        week: "flex",
        day: "relative size-10 p-0 text-center text-[14px] font-medium text-[#172033] dark:text-foreground",
        day_button:
          "relative z-10 flex size-10 items-center justify-center rounded-full transition-colors hover:bg-[#eef1f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d5cff]/40 dark:hover:bg-muted",
        outside:
          "text-[#98a2b3] dark:text-muted-foreground/60 [&>button]:text-[#98a2b3] dark:[&>button]:text-muted-foreground/60",
        disabled:
          "pointer-events-none text-[#c4cad4] opacity-50 [&>button]:text-[#c4cad4]",
        selected: "",
        range_start: RANGE_START_CLASS,
        range_middle: RANGE_MIDDLE_CLASS,
        range_end: RANGE_END_CLASS,
        today: "",
        ...classNames,
      }}
      components={{
        Day: CalendarDay,
        Chevron: ({ orientation, className: chevronClassName }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-4", chevronClassName)} />
          ) : (
            <ChevronRight className={cn("size-4", chevronClassName)} />
          ),
        ...components,
      }}
      {...props}
    />
  );
}

export { Calendar };
