"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STUDIO_CONTROL_RADIUS } from "@/components/admin/online-store/header-studio/layout-style";
import { cn } from "@/lib/utils";

/**
 * The shell both list editors wear — Tags and Links.
 *
 * The header is PINNED and the list scrolls under it, because the button
 * that adds a row lives up there: with the whole dialog scrolling, a
 * merchant twelve rows down had to scroll back to the top to add a
 * thirteenth. The action sits left of the dialog's own close button, which
 * is absolutely positioned at top-right — hence the reserved padding.
 */
export function StudioModal({
  open,
  onOpenChange,
  title,
  description,
  action,
  footer,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The "Add …" button, pinned in the header beside the title. */
  action?: ReactNode;
  /** A count, or anything else worth keeping under the list. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl",
          STUDIO_CONTROL_RADIUS,
          className,
        )}
      >
        <DialogHeader className="shrink-0 flex-row items-start gap-3 border-b bg-card px-6 py-4 pr-14 text-left">
          <div className="min-w-0 flex-1 space-y-1">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t px-6 py-3">{footer}</div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
