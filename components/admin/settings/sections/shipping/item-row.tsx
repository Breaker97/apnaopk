import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One thing in a Shipping & Delivery list — a zone, a carrier, a box — as its
 * icon, name and badges, a line about it, and the button that opens it.
 *
 * It lays out by its list's width (the list is the container): with room, the
 * line sits under the name between the icon and the button; without, it drops
 * to a row of its own across the full width. On a phone the old side-by-side
 * layout squeezed that line into a column three words wide.
 */
export function ItemRow(props: {
  icon: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  /** A caution under the description. */
  note?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 p-4 @md:gap-y-0.5",
        props.className,
      )}
    >
      <div className="@md:row-span-2">{props.icon}</div>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
        <span className="min-w-0 break-words">{props.title}</span>
        {props.badges}
      </p>
      <div className="@md:row-span-2">{props.action}</div>
      {props.description || props.note ? (
        <div className="col-span-3 min-w-0 space-y-0.5 @md:col-span-1 @md:col-start-2">
          {props.description ? (
            <p className="text-muted-foreground text-sm">{props.description}</p>
          ) : null}
          {props.note ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{props.note}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
