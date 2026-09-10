"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminFormStickyHeaderProps {
  /**
   * Optional: admin forms have no page-level `<h1>` of their own, so the bar
   * titles the page for them. Where the page already carries a heading (the
   * customer account area), omit it — the bar is then just the sticky action
   * rail, and the page keeps a single `<h1>`.
   */
  title?: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  flushWithAdminShell?: boolean;
  className?: string;
  contentClassName?: string;
}

export function AdminFormStickyHeader({
  title,
  description,
  status,
  actions,
  flushWithAdminShell = false,
  className,
  contentClassName,
}: AdminFormStickyHeaderProps) {
  return (
    <div
      className={cn(
        "sticky top-[var(--dashboard-header-height,4rem)] z-30 -mx-4 border-b bg-background px-4 py-3 shadow-sm md:px-8",
        flushWithAdminShell && "-mt-6 !-mx-10 !px-10 md:!-mx-12 md:!px-12",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
          contentClassName,
        )}
      >
        <div className="min-w-0">
          {title || status ? (
            <div className="flex items-center gap-2">
              {title ? (
                <h1 className="truncate text-lg font-semibold">{title}</h1>
              ) : null}
              {status}
            </div>
          ) : null}
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
