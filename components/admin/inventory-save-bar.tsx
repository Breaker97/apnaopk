"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InventorySaveBarProps {
  open: boolean;
  count: number;
  isSaving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}

/**
 * Bottom bar shown while inline stock edits are pending.
 *
 * Centered over the table rather than pinned to a corner, so it never covers
 * the pagination controls or the last row. Warns before the tab is closed and
 * supports Cmd/Ctrl+S to save, Escape to discard.
 */
export function InventorySaveBar({
  open,
  count,
  isSaving,
  onDiscard,
  onSave,
}: InventorySaveBarProps) {
  const t = useTranslations();

  // Guard against losing edits to a tab close / reload.
  useEffect(() => {
    if (!open) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!isSaving) onSave();
        return;
      }
      // Don't hijack Escape from an open dropdown/dialog above the bar.
      if (event.key === "Escape" && !isSaving && !event.defaultPrevented) {
        onDiscard();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, isSaving, onSave, onDiscard]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:bottom-6"
    >
      <div className="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-xl border bg-background/95 p-2 pl-4 shadow-xl ring-1 ring-black/5 backdrop-blur duration-200 animate-in fade-in slide-in-from-bottom-4 dark:ring-white/10">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">
            {t("admin.inventory.unsavedChanges", { count })}
          </p>
          <p className="hidden truncate text-xs leading-tight text-muted-foreground sm:block">
            {t("admin.inventory.unsavedChangesHint")}
          </p>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          disabled={isSaving}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">
            {t("admin.inventory.actions.discard")}
          </span>
        </Button>

        <Button
          size="sm"
          onClick={onSave}
          disabled={isSaving}
          className="shrink-0"
        >
          {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {isSaving
            ? t("admin.inventory.actions.saving")
            : t("admin.inventory.actions.save")}
        </Button>
      </div>
    </div>
  );
}
