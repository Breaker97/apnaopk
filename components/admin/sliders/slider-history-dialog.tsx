"use client";

import { useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SliderDocument } from "@/lib/sliders/types";

export interface HistoryLabels {
  title: string;
  description: string;
  restore: string;
  empty: string;
  slides: string;
  open: string;
}

/**
 * The last published versions of a slider, newest first, each restorable
 * INTO THE DRAFT — nothing goes live from here until it is published, so a
 * restore is never a surprise on the shop.
 */
export function SliderHistoryDialog({
  slider,
  onRestore,
  labels,
  locale,
}: {
  slider: SliderDocument;
  onRestore: (index: number) => Promise<void>;
  labels: HistoryLabels;
  locale: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const history = slider.history ?? [];
  const format = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? iso
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 rounded-full px-3 text-xs"
        onClick={() => setOpen(true)}
        disabled={history.length === 0}
        title={labels.open}
      >
        <History className="h-3.5 w-3.5" />
        {labels.open}
        {history.length > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{history.length}</span>
        ) : null}
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{labels.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((entry, index) => (
              <li key={`${entry.publishedAt}-${index}`} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{format(entry.publishedAt)}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.slides.length} {labels.slides} · {entry.transition} · {entry.autoplaySeconds}s
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 text-xs"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(index);
                    try {
                      await onRestore(index);
                      setOpen(false);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === index ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  {labels.restore}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
