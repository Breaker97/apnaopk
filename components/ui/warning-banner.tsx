import * as React from "react";
import { TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  warning: {
    frame:
      "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
    icon: "text-amber-600 dark:text-amber-400",
  },
  danger: {
    frame:
      "border-destructive/30 bg-destructive/5 dark:border-destructive/40 dark:bg-destructive/10",
    icon: "text-destructive",
  },
} as const;

/**
 * The one amber "heads up" box used across the app — store gates, missing
 * settings, held orders, unsaved-change notes.
 *
 * Only the frame and icon carry the amber; title and body stay in the normal
 * foreground colour so the copy reads as plainly as the rest of the page.
 * `action` sits on the right on wide screens and wraps under the copy on
 * narrow ones. `tone="danger"` is the same box in red, for a warning that has
 * already run out (a deadline passed) rather than one still being waited on.
 */
export function WarningBanner({
  icon: Icon = TriangleAlert,
  title,
  children,
  action,
  tone = "warning",
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  icon?: LucideIcon | null;
  title?: React.ReactNode;
  action?: React.ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3 text-foreground",
        TONES[tone].frame,
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
        {Icon ? (
          <Icon
            aria-hidden
            className={cn("mt-0.5 h-4 w-4 shrink-0", TONES[tone].icon)}
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          {title ? (
            <p className="text-sm font-medium leading-snug text-foreground">
              {title}
            </p>
          ) : null}
          {children ? (
            <div
              className={cn(
                "leading-relaxed text-foreground",
                title ? "text-xs" : "text-sm"
              )}
            >
              {children}
            </div>
          ) : null}
        </div>
      </div>
      {action ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  );
}
