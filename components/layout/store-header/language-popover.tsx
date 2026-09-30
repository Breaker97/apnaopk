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
        className="w-[310px] rounded-4xl border-0 bg-[#f3f3f3] p-0 text-zinc-900 shadow-[0_18px_40px_rgba(15,23,42,0.2)] dark:border dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-[0_18px_40px_rgba(0,0,0,0.5)]"
      >
        <div className="space-y-4 px-6 py-6">
          <section className="space-y-2.5">
            <h3 className="text-[17px] font-semibold leading-none text-zinc-900 dark:text-zinc-100">
              {t("common.language")}
            </h3>
            <div className="relative">
              <select
                value={pendingCode}
                onChange={(e) => setPendingCode(e.target.value)}
                className="h-11 w-full appearance-none rounded-xl border border-[#c8c8c8] bg-white px-4 pr-10 text-[14px] font-medium text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600 dark:text-zinc-300" />
            </div>
          </section>

          <Button
            type="button"
            onClick={() => {
              onSave(pendingCode);
              setOpen(false);
            }}
            className="mt-1 h-11 w-full rounded-full bg-primary text-[14px] font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t("common.save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
