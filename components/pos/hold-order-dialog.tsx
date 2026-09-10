"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface POSHoldOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Returns false when the sale could not be parked, so the dialog stays open
   *  instead of dismissing over a cart that was never saved. */
  onHold: (label: string) => boolean;
  itemCount: number;
}

export function POSHoldOrderDialog({
  open,
  onOpenChange,
  onHold,
  itemCount,
}: POSHoldOrderDialogProps) {
  const [label, setLabel] = React.useState("");

  useApplyOnChange([open], () => {
    if (open) setLabel("");
  });

  if (!open) return null;

  const canHold = itemCount > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="bg-background w-full max-w-md rounded-2xl border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-2">
          <div>
            <h2 className="text-base font-semibold">Hold this order</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional label – table number, customer name, anything you&apos;ll
              recognize.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full -mr-2 -mt-1"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5 pt-3">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Table 5 · Mrs. Patel · Pickup order"
            className="h-11 rounded-xl border-primary/50 text-sm focus-visible:border-primary focus-visible:ring-primary/30"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && canHold && onHold(label.trim())) {
                onOpenChange(false);
              }
            }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            disabled={!canHold}
            onClick={() => {
              if (onHold(label.trim())) onOpenChange(false);
            }}
            className="rounded-xl bg-primary px-5 text-white hover:bg-primary/90 disabled:opacity-50"
          >
            Hold order
          </Button>
        </div>
      </div>
    </div>
  );
}
