"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * The pieces the Shipping & Delivery dialogs (rate, zone, ship-from address,
 * carrier, package, automation) are built from, so they read as one family.
 */

/**
 * The copy a dialog edits. `changed` is false until the copy differs from what
 * it opened with, so Done on an untouched dialog can close without writing —
 * a write of the same values in a new object reads as an unsaved change.
 */
export function useDraft<T extends object>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const set = (patch: Partial<T>) => setDraft((current) => ({ ...current, ...patch }));
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  return { draft, set, changed };
}

/**
 * A label on the left and its inputs in a row; stacked on a phone. `compact`
 * narrows the label column for a dialog whose rows hold four controls.
 */
export function FieldLine(props: {
  label: string;
  htmlFor: string;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <label
        htmlFor={props.htmlFor}
        className={cn("text-sm font-medium sm:shrink-0", props.compact ? "sm:w-32" : "sm:w-40")}
      >
        {props.label}
      </label>
      <div className="flex flex-wrap items-center gap-2">{props.children}</div>
    </div>
  );
}

// Shared with Settings → SMS, where it picks how texts are sent.
export { Segmented } from "@/components/admin/settings/fields/segmented";

/** The muted word beside an input: a unit, "to", "days". */
export function Unit({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground text-sm">{children}</span>;
}

/** A switch in a bordered row; the whole row toggles it. */
export function SwitchRow(props: {
  title: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-4 rounded-xl border p-3.5 has-[button:disabled]:cursor-default">
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-sm font-medium">{props.title}</span>
        {props.hint ? (
          <span className="text-muted-foreground block text-xs">{props.hint}</span>
        ) : null}
      </span>
      <Switch
        checked={props.checked}
        disabled={props.disabled}
        aria-label={props.title}
        onCheckedChange={props.onCheckedChange}
      />
    </label>
  );
}

/**
 * The dialog's title bar. It starts where the language starts — the stock
 * header is left-aligned from `sm` up, in Arabic too — and keeps clear of the
 * close button, which sits on the right in both directions.
 */
export function EditDialogHeader({ children }: { children: ReactNode }) {
  return (
    <DialogHeader className="border-b pt-5 pr-12 pb-4 pl-6 text-start sm:text-start">
      {children}
    </DialogHeader>
  );
}

/** Remove on the left when there is something to remove; Cancel and Done on the right. */
export function EditDialogFooter(props: {
  removeLabel?: string;
  onRemove?: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const tCommon = useTranslations("common");
  return (
    <DialogFooter className="flex-row items-center gap-2 border-t px-6 py-4 sm:justify-between">
      {props.onRemove ? (
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive px-2"
          onClick={props.onRemove}
        >
          {props.removeLabel}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={props.onCancel}>
          {tCommon("cancel")}
        </Button>
        <Button type="button" onClick={props.onDone}>
          {tCommon("done")}
        </Button>
      </div>
    </DialogFooter>
  );
}
