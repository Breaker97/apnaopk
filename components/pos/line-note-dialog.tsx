"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface POSLineNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string | null;
  itemName: string;
  current: string | null;
  onSave: (itemId: string, note: string | null) => void;
}

export function POSLineNoteDialog({
  open,
  onOpenChange,
  itemId,
  itemName,
  current,
  onSave,
}: POSLineNoteDialogProps) {
  const [note, setNote] = React.useState<string>("");

  // Reset form when dialog opens
  useApplyOnChange([open, current], () => {
    if (open) setNote(current ?? "");
  });

  const handleSave = () => {
    if (!itemId) return;
    const trimmed = note.trim();
    onSave(itemId, trimmed.length > 0 ? trimmed : null);
    onOpenChange(false);
  };

  const handleRemove = () => {
    if (!itemId) return;
    onSave(itemId, null);
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="bg-background w-full max-w-md rounded-2xl border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        {/* Header */}
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div className="min-w-0 flex-1 pr-2">
            <h2 className="text-base font-semibold">Line note</h2>
            <p className="truncate text-xs text-muted-foreground">{itemName}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="p-5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. customer wants no ice · gift wrap · ring up separately"
            rows={4}
            className={cn(
              "border-input bg-background ring-offset-background placeholder:text-muted-foreground",
              "flex w-full rounded-xl border px-3 py-2.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary",
              "resize-none",
            )}
            autoFocus
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
          {current ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              className="rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Remove
            </Button>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="rounded-xl bg-primary px-5 text-white hover:bg-primary/90"
          >
            <Check className="mr-1 h-4 w-4" />
            Save note
          </Button>
        </div>
      </div>
    </div>
  );
}
