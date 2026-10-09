import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SettingsTabHeader(props: {
  title: string;
  description?: string;
  meta?: ReactNode;
  /**
   * A small control that belongs to the page as a whole, such as its on/off
   * switch. Unlike `meta` it never wraps: it stays beside the title at every
   * width, where a phone would otherwise drop it under the description.
   */
  control?: ReactNode;
  className?: string;
  /** Under the title row, inside the same box: links out of the page, a note. */
  children?: ReactNode;
}) {
  // `meta` is a short status chip, but nothing stops a caller passing a
  // longer one. It keeps its width while it fits, then wraps onto its own
  // line rather than squeezing the title into a one-word column — and
  // `max-w-full` keeps even a sentence inside the card instead of running
  // off the page.
  const titleRow = (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <h2 className="text-base font-semibold">{props.title}</h2>
        {props.description ? (
          <p className="text-sm text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
      {props.meta ? (
        <div className="min-w-0 max-w-full shrink-0">{props.meta}</div>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-linear-to-br from-muted/70 via-card to-card px-6 py-5 dark:from-muted/40",
        props.className,
      )}
    >
      {props.control ? (
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">{titleRow}</div>
          <div className="shrink-0">{props.control}</div>
        </div>
      ) : (
        titleRow
      )}
      {props.children ? <div className="mt-3.5">{props.children}</div> : null}
    </div>
  );
}
