"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The language picker a header control opens: the Language item, or the
 * icons cluster's language glyph. Each trigger owns its picker and the
 * choice pending in it. With one open state shared by every trigger, a
 * header holding both controls opened the two pickers on a click, each
 * closed the other as focus moved into it, and neither ever showed.
 */
export function LanguagePopover({
  trigger,
  currentCode,
  languages,
  onSave,
}: {
  trigger: ReactNode;
  /** The page's language; the picker starts on it each time it opens. */
  currentCode: string;
  languages: ReadonlyArray<{ code: string; name: string }>;
  /** The language chosen when the shopper saves. */
  onSave: (code: string) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [pendingCode, setPendingCode] = useState(currentCode);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setPendingCode(currentCode);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={10}
        className="w-[310px] rounded-4xl border border-border bg-popover p-0 text-popover-foreground shadow-[0_18px_40px_rgba(15,23,42,0.2)] dark:shadow-[0_18px_40px_rgba(0,0,0,0.5)]"
      >
        <div className="space-y-4 px-6 py-6">
          <section className="space-y-2.5">
            <h3 className="text-[17px] font-semibold leading-none text-foreground">
              {t("common.language")}
            </h3>
            <div className="relative">
              <select
                value={pendingCode}
                onChange={(e) => setPendingCode(e.target.value)}
                className="h-11 w-full appearance-none rounded-xl border border-input bg-background px-4 pr-10 text-[14px] font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30"
              >
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </section>

          <Button
            type="button"
            onClick={() => {
              onSave(pendingCode);
              setOpen(false);
            }}
            className="mt-1 h-11 w-full rounded-full bg-primary text-[14px] font-semibold text-primary-foreground hover:bg-(--primary-hover,var(--primary))"
          >
            {t("common.save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
