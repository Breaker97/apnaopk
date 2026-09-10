"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { addDays } from "@/lib/boosts/boost-days";

/** How a booked day actually delivered. Absent on the admin ladder strip. */
type OccupancyDayState = "served" | "partial" | "credited";

export type OccupancyDay = {
  day: string;
  /** Empty on the vendor's own campaign strip, where the holder is the viewer. */
  store?: string;
  product?: string;
  state?: OccupancyDayState;
};

const STATE_CLASS: Record<OccupancyDayState, string> = {
  served: "bg-primary",
  // Amber, not a lighter primary: a partially credited day is a money event,
  // and it has to read differently from "a bit less traffic".
  partial: "bg-amber-500",
  credited: "bg-destructive",
};

/**
 * One cell per day, in two modes.
 *
 * **Window mode** (`today` + `days`) is the admin's pricing instrument: a rung
 * booked solid 60 days out is underpriced and a rung at zero is overpriced, and
 * neither fact appears anywhere else in the admin.
 *
 * **Campaign mode** (`dayList`) is the vendor's delivery record: this booking's
 * own days, each marked served, partially credited or credited. It is the
 * surface where a vendor points at a day and the marketplace points at the same
 * day — which is the whole argument for selling days rather than impressions.
 */
export function BoostOccupancyStrip({
  today,
  days,
  dayList,
  bookedDays,
  labels,
}: {
  /** UTC "YYYY-MM-DD" the window starts at. Window mode. */
  today?: string;
  /** Window length in days. Window mode. */
  days?: number;
  /** Explicit days to render, in order. Campaign mode; overrides the window. */
  dayList?: string[];
  bookedDays: OccupancyDay[];
  labels: {
    /** e.g. "{booked} of {total} days booked" */
    summary: (booked: number, total: number) => string;
    nextFree: (day: string) => string;
    fullyBooked: string;
  };
}) {
  const { cells, bookedCount, total, nextFree } = useMemo(() => {
    const byDay = new Map(bookedDays.map((d) => [d.day, d]));
    const out: Array<{ day: string; holder: OccupancyDay | undefined }> = [];
    let free: string | null = null;

    const window =
      dayList ??
      Array.from({ length: days ?? 0 }, (_, i) => addDays(today ?? "", i));

    for (const day of window) {
      const holder = byDay.get(day);
      if (!holder && free === null) free = day;
      out.push({ day, holder });
    }
    return {
      cells: out,
      bookedCount: out.filter((c) => c.holder).length,
      total: window.length,
      nextFree: free,
    };
  }, [today, days, dayList, bookedDays]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-[3px]">
        {cells.map((cell, index) => (
          <span
            key={cell.day}
            title={
              cell.holder
                ? [cell.day, cell.holder.store, cell.holder.product]
                    .filter(Boolean)
                    .join(" — ")
                : cell.day
            }
            className={cn(
              "h-4 w-2 rounded-[2px]",
              cell.holder
                ? STATE_CLASS[cell.holder.state ?? "served"]
                : "bg-muted",
              // In window mode the first cell is today, and it is ringed rather
              // than coloured: it marks a position in the window, not a third
              // booking state. Campaign mode has no such anchor.
              !dayList &&
                index === 0 &&
                "ring-1 ring-foreground/40 ring-offset-1",
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {labels.summary(bookedCount, total)}
        {nextFree ? ` · ${labels.nextFree(nextFree)}` : ` · ${labels.fullyBooked}`}
      </p>
    </div>
  );
}
