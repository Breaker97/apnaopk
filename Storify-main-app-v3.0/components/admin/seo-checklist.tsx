"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  evaluateSeoChecklist,
  type SeoCheckItem,
  type SeoChecklistInput,
} from "@/lib/site-config/seo-checklist";

const STATUS_DOT: Record<SeoCheckItem["status"], string> = {
  pass: "bg-emerald-500",
  warn: "bg-amber-500",
  fail: "bg-red-500",
};

const FALLBACK_MESSAGES: Record<SeoCheckItem["message"], string> = {
  titleMissing: "Add a page title — search engines have nothing to show.",
  titleShort: "The title is short; 30–70 characters ranks best.",
  titleLong: "The title is too long and will be cut off in results.",
  titleGood: "Title length looks good.",
  metaMissing: "Add a meta description — results will show random page text.",
  metaAuto: "Meta description is auto-filled from content; write one for better click-through.",
  metaShort: "The meta description is short; 70–160 characters works best.",
  metaLong: "The meta description is too long and will be cut off.",
  metaGood: "Meta description length looks good.",
  handleMissing: "Add a URL handle.",
  handleAuto: "The handle is auto-generated from the title; review it.",
  handleMessy: "The handle has unusual characters or length; keep it short and hyphenated.",
  handleGood: "URL handle looks clean.",
  contentThin: "Content is thin; longer, useful content ranks better.",
  contentGood: "Content depth looks good.",
  tagsMissing: "Add a few tags to improve internal discovery.",
  tagsGood: "Tags present.",
};

/**
 * Instant, rule-based SEO health readout rendered under the Search Engine
 * Listing preview. Deterministic on purpose — the AI "Improve SEO" button is
 * the fix, this is the always-free diagnosis.
 */
export function SeoChecklist(props: SeoChecklistInput) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const result = useMemo(() => evaluateSeoChecklist(props), [props]);

  const tSafe = (key: string, fallback: string) => {
    try {
      const translate = t as unknown as (k: string) => string;
      const res = translate(key);
      return typeof res === "string" && res !== key ? res : fallback;
    } catch {
      return fallback;
    }
  };

  return (
    <div className="rounded-lg border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <span
            className={cn("h-2 w-2 rounded-full", STATUS_DOT[result.status])}
          />
          {tSafe("admin.seoChecklist.title", "SEO checklist")}
          <span className="text-xs font-normal text-muted-foreground">
            {tSafe("admin.seoChecklist.score", "Score")}: {result.score}/100
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <ul className="space-y-1.5 border-t px-3 py-2.5">
          {result.items.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-xs">
              <span
                className={cn(
                  "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                  STATUS_DOT[item.status],
                )}
              />
              <span className="text-muted-foreground">
                {tSafe(
                  `admin.seoChecklist.messages.${item.message}`,
                  FALLBACK_MESSAGES[item.message],
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
