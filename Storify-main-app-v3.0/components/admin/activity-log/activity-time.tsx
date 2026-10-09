"use client";

import { useLocale } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatExactTime, formatRelativeTime } from "@/lib/activity-log/time";

/**
 * When a row happened: how long ago, with the exact moment in a tooltip, both in
 * the viewer's locale.
 *
 * A button, so the row can be opened from the keyboard (a table row has no
 * focus of its own); the click also reaches the row, which opens the same entry.
 * The relative text is worked out from the clock, so the server's rendering and
 * the browser's disagree by seconds — `suppressHydrationWarning`, as the order
 * timeline does for the same reason. `dateTime` keeps the exact instant for
 * assistive tech and for anyone reading the DOM.
 */
export function ActivityTime({
  iso,
  openLabel,
  onOpen,
}: {
  iso: string;
  /** Spoken before the time, so the button says what it does. */
  openLabel: string;
  onOpen: () => void;
}) {
  const locale = useLocale();
  const now = new Date();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          className="rounded-sm text-left text-xs hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="sr-only">{openLabel}: </span>
          <time dateTime={iso} suppressHydrationWarning>
            {formatRelativeTime(iso, now, locale)}
          </time>
        </button>
      </TooltipTrigger>
      <TooltipContent>{formatExactTime(iso, locale)}</TooltipContent>
    </Tooltip>
  );
}
