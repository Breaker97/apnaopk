"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { FooterBuilder } from "@/components/admin/online-store/footer-builder";
import { FooterStudio } from "./footer-studio";
import { cn } from "@/lib/utils";

/**
 * Online Store → Navigation → Footer, in two halves.
 *
 * BUILD is the layout — rows of columns of items, the header's own idea
 * applied to the footer. SETTINGS is the form that was here before, and it
 * stays: it owns everything that is not an arrangement (the colour schemes,
 * the logo source, the contact source, the social URLs), and the layout
 * reads those rather than duplicating them. Removing it would have taken
 * those settings away to ship a canvas.
 */

type FooterTab = "build" | "settings";

export function FooterWorkspace({ locale }: { locale: string }) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const [tab, setTab] = useState<FooterTab>("build");

  const tabs: { key: FooterTab; label: string }[] = [
    { key: "build", label: tSafe("admin.footerStudio.tabs.build", "Build") },
    {
      key: "settings",
      label: tSafe("admin.footerStudio.tabs.settings", "Settings"),
    },
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={tSafe("admin.footerStudio.tabsLabel", "Footer")}
        className="flex w-fit rounded-[10px] border border-border p-0.5"
      >
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={cn(
              "rounded-[8px] px-3 py-1.5 text-xs font-medium transition",
              tab === entry.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* Both are mounted lazily rather than hidden: each loads the whole
          settings document on mount, and keeping the other alive would mean
          two copies of it drifting apart while the merchant edits one. */}
      {tab === "build" ? (
        <FooterStudio locale={locale} />
      ) : (
        <FooterBuilder />
      )}
    </div>
  );
}
