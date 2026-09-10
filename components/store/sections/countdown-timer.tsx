"use client";

import { useSyncExternalStore } from "react";

interface CountdownTimerProps {
  /** ISO datetime the offer ends at. */
  endsAt: string;
  labels: { days: string; hours: string; minutes: string; seconds: string };
  className?: string;
  /**
   * Vanish (instead of clamping at zero) once the deadline passes — for
   * hosts like hero slides whose server render cannot consult the clock.
   */
  hideWhenExpired?: boolean;
  /** Compact boxes for tighter hosts (slide overlays). */
  size?: "default" | "sm";
  /**
   * "boxed" is the token-coloured default. "cards" is the Electronics deals
   * design: white cards with the unit label on TOP and a large extra-light
   * number — fixed light like artwork, because its host paints its own
   * dark ground in both themes.
   */
  appearance?: "boxed" | "cards";
}

function remainingParts(endsAt: string) {
  const diff = Math.max(0, Date.parse(endsAt) - Date.now());
  const seconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

function subscribeEverySecond(onTick: () => void) {
  const interval = setInterval(onTick, 1000);
  return () => clearInterval(interval);
}

/**
 * Ticking countdown boxes. The server decides whether the section renders at
 * all (expired offers are dropped there); this only counts a live target
 * down and clamps at zero. Starts from a null state so SSR and the first
 * client paint agree, then hydrates to the real remainder.
 */
export function CountdownTimer({
  endsAt,
  labels,
  className,
  hideWhenExpired = false,
  size = "default",
  appearance = "boxed",
}: CountdownTimerProps) {
  // `null` on the server and while hydrating, then the wall clock once a second.
  const nowSeconds = useSyncExternalStore(
    subscribeEverySecond,
    () => Math.floor(Date.now() / 1000),
    () => null,
  );
  const parts = nowSeconds === null ? null : remainingParts(endsAt);

  const expired =
    parts !== null &&
    parts.days + parts.hours + parts.minutes + parts.seconds === 0;
  if (hideWhenExpired && expired) return null;

  const cells = [
    { value: parts?.days, label: labels.days },
    { value: parts?.hours, label: labels.hours },
    { value: parts?.minutes, label: labels.minutes },
    { value: parts?.seconds, label: labels.seconds },
  ];

  if (appearance === "cards") {
    // Four 68px cards are a desktop panel's furniture: on a phone they push
    // the first deal — and the clock's own urgency — below the fold. The same
    // numbers run as a single ticker line there instead. Units are colons
    // rather than letters because a unit abbreviation is not something the
    // locale files carry; the full localised reading stays for screen
    // readers, which is where it actually has to be a sentence.
    const spoken = cells
      .map((cell) => `${cell.value ?? "--"} ${cell.label}`)
      .join(", ");
    return (
      <div className={className}>
        <div className="flex w-fit items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-white sm:hidden">
          <span className="sr-only">{spoken}</span>
          <span
            aria-hidden
            className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-semibold tabular-nums"
          >
            {cells.map((cell, index) => (
              <span key={cell.label} className="flex items-baseline gap-x-1.5">
                {index > 0 ? (
                  <span className="text-[12px] opacity-40">:</span>
                ) : null}
                <span className="text-[15px] leading-none tracking-[-0.01em]">
                  {cell.value === undefined
                    ? "--"
                    : String(cell.value).padStart(2, "0")}
                </span>
                {/* The unit, not just a colon: four numbers with no words is
                    read as hours:minutes:seconds by anyone who does not stop
                    to count them. The locale files already keep these short
                    (Days/Hours/Mins/Secs), and the row wraps rather than
                    overflowing where a language spells them out. */}
                <span className="text-[10px] uppercase tracking-[0.04em] opacity-60">
                  {cell.label}
                </span>
              </span>
            ))}
          </span>
        </div>
        <div className="hidden items-center gap-2 sm:flex sm:gap-2.5">
          {cells.map((cell) => (
            <div
              key={cell.label}
              className="flex h-[68px] w-16 flex-col items-center justify-center gap-1 overflow-clip rounded-md bg-white text-center text-[#3b3b3b] sm:h-[89px] sm:w-20"
            >
              <span className="text-[11px] font-bold tracking-[-0.03em] sm:text-[14px]">
                {cell.label}
              </span>
              <span className="text-[28px] font-extralight leading-[1.08] tracking-[-0.03em] tabular-nums sm:text-[43px]">
                {cell.value === undefined
                  ? "--"
                  : String(cell.value).padStart(2, "0")}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2 sm:gap-3">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className={
              size === "sm"
                ? "flex min-w-11 flex-col items-center rounded-md border border-border/60 bg-background/80 px-1.5 py-1 backdrop-blur-sm"
                : "flex min-w-14 flex-col items-center rounded-lg border border-border/60 bg-background/80 px-2 py-2 backdrop-blur-sm sm:min-w-16 sm:px-3"
            }
          >
            <span
              className={
                size === "sm"
                  ? "text-base font-bold tabular-nums"
                  : "text-xl font-bold tabular-nums sm:text-2xl"
              }
            >
              {cell.value === undefined
                ? "--"
                : String(cell.value).padStart(2, "0")}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
              {cell.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
