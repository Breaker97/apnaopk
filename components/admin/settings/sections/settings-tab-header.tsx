import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SettingsTabHeader(props: {
  title: string;
  description?: string;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-linear-to-br from-muted/70 via-card to-card px-6 py-5 dark:from-muted/40",
        props.className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{props.title}</h2>
          {props.description ? (
            <p className="text-sm text-muted-foreground">{props.description}</p>
          ) : null}
        </div>
        {props.meta ? <div className="shrink-0">{props.meta}</div> : null}
      </div>
    </div>
  );
}
