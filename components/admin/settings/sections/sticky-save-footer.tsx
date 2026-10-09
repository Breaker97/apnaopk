"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function StickySaveFooter({
  label,
  isSaving,
  isDirty,
  disabled,
  onSave,
  onDiscard,
  children,
  className,
}: {
  label: string;
  isSaving: boolean;
  isDirty?: boolean;
  disabled?: boolean;
  onSave: () => void | Promise<unknown>;
  /** Shows a Discard button. Pass it only where it undoes every edit the bar counts. */
  onDiscard?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("admin.settings.saveBar");

  // The bar appears once there is something to save and stays through the
  // save. It used to sit there all the time as a see-through strip with one
  // disabled button, floating over the page's last rows: on Multi-Vendor
  // Mode it covered the Inbox switch. A caller that tracks no dirty state
  // (`isDirty` left out) still gets it always.
  if (isDirty === false && !isSaving) return null;

  const isDisabled = disabled ?? (isSaving || isDirty === false);

  // Sticky, not fixed: the bar rides the bottom of the viewport only while
  // the form it saves is on screen, then settles at that form's end, and it
  // needs no offsets for a sidebar that collapses. One bar per page: a save
  // reloads every section from the server, so a page that edits two sections
  // saves both through one bar (Multi-Vendor Mode does).
  return (
    <div
      className={cn(
        "pointer-events-none sticky bottom-0 z-40 py-3",
        className,
      )}
    >
      <div className="@container bg-card animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2.5 shadow-lg duration-200">
        {isDirty !== undefined ? (
          <p className="flex basis-full items-center gap-2 text-sm font-medium @lg:flex-1 @lg:basis-auto">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-amber-500"
            />
            {t("unsaved")}
          </p>
        ) : (
          <span className="hidden flex-1 @lg:block" />
        )}
        {children}
        {onDiscard ? (
          <Button
            variant="outline"
            className="flex-1 @lg:flex-none"
            disabled={isSaving}
            onClick={onDiscard}
          >
            {t("discard")}
          </Button>
        ) : null}
        <Button
          className="flex-1 @lg:flex-none"
          onClick={() => onSave()}
          disabled={isDisabled}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {label}
        </Button>
      </div>
    </div>
  );
}
