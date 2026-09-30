"use client";

import type { ReactNode } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function StickySaveFooter({
  label,
  isSaving,
  isDirty,
  disabled,
  onSave,
  children,
  className,
}: {
  label: string;
  isSaving: boolean;
  isDirty?: boolean;
  disabled?: boolean;
  onSave: () => void | Promise<unknown>;
  children?: ReactNode;
  className?: string;
}) {
  const isDisabled = disabled ?? (isSaving || isDirty === false);

  // Sticky, not fixed: the bar rides the bottom of the viewport only while
  // the form it saves is on screen, then settles at that form's end, and it
  // needs no offsets for a sidebar that collapses. The strip itself lets
  // clicks through to the fields it floats over. One bar per page: a save
  // reloads every section from the server, so a page that edits two sections
  // saves both through one bar (Multi-Vendor Management does).
  return (
    <div
      className={cn(
        "pointer-events-none sticky bottom-0 z-40 flex min-h-15.25 justify-end gap-2 py-3 *:pointer-events-auto",
        className,
      )}
    >
      {children}
      <Button onClick={() => onSave()} disabled={isDisabled}>
        {isSaving ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Save className="h-4 w-4 mr-2" />
        )}
        {label}
      </Button>
    </div>
  );
}
