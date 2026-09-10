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

  return (
    <div
      className={cn(
        "fixed bottom-0 left-3 right-3 z-40 flex min-h-[61px] justify-end gap-2 py-3 md:left-[max(314px,calc((100vw-1030px)/2+314px))] md:right-auto md:w-[min(716px,calc(100vw-314px))]",
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
