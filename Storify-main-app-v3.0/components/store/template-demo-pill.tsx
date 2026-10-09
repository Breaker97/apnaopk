"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DemoTemplate } from "@/components/store/template-demo-dialog";

/**
 * Loaded on the first open, not with the page: the store layout imports this
 * pill on every install, so whatever it imports statically is in every
 * storefront page's first load — although only a demo deployment renders it.
 */
const TemplateDemoDialog = dynamic(() =>
  import("@/components/store/template-demo-dialog").then(
    (module) => module.TemplateDemoDialog,
  ),
);

/** Starts loading the dialog on the tab's pointer, touch and focus intents. */
function preloadTemplateDemoDialog() {
  void import("@/components/store/template-demo-dialog");
}

/**
 * Floating template switcher for DEMO DEPLOYMENTS only (the layout renders
 * it solely under DEMO_TEMPLATES=1, so neither buyers nor their shoppers
 * ever see it). Each template demo is a separate deployment — its own
 * subdomain and database — so every card is a full cross-host navigation,
 * and "active" means "the deployment you are on". Deliberately
 * English-only: it is vendor marketing chrome on our own demo host, not
 * product UI, so it stays out of the 17 locale files. Injected by the
 * layout — never a section or menu entry.
 *
 * The tab is built to be noticed: its glow breathes, and every few seconds
 * it nudges out from the edge while a shine crosses it (the demo-pill-*
 * rules in globals.css). The motion stops while the dialog is open and
 * never runs under prefers-reduced-motion.
 */
export function TemplateDemoPill({
  locale,
  activeThemeId,
  templates,
}: {
  locale: string;
  activeThemeId: string;
  templates: DemoTemplate[];
}) {
  const [open, setOpen] = useState(false);
  // Stays mounted after the first open so the close animation still plays.
  const [requested, setRequested] = useState(false);
  const tabRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <div
        className={cn(
          "fixed left-0 top-1/2 z-50 -translate-y-1/2",
          !open && "demo-pill-nudge",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-3 left-0 right-1 rounded-r-3xl bg-linear-to-br from-fuchsia-500 via-violet-600 to-indigo-600 opacity-60 blur-xl",
            !open && "demo-pill-glow",
          )}
        />
        <button
          ref={tabRef}
          type="button"
          onClick={() => {
            setRequested(true);
            setOpen(true);
          }}
          onPointerEnter={preloadTemplateDemoDialog}
          onTouchStart={preloadTemplateDemoDialog}
          onFocus={preloadTemplateDemoDialog}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Explore store demos"
          className="group relative flex w-[72px] flex-col items-center gap-1.5 overflow-hidden rounded-r-2xl bg-linear-to-br from-fuchsia-500 via-violet-600 to-indigo-700 px-1.5 pb-3 pt-3.5 text-center text-white shadow-[0_16px_40px_-12px_rgba(124,58,237,0.9)] ring-2 ring-white transition-[translate,filter] duration-300 hover:translate-x-1 hover:brightness-110 focus-visible:outline-none focus-visible:ring-amber-300 md:w-[88px] md:gap-2 md:px-2 md:pb-4 md:pt-5"
        >
          {!open ? (
            <span
              aria-hidden="true"
              className="demo-pill-shine pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-linear-to-r from-transparent via-white/45 to-transparent"
            />
          ) : null}
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/35 transition-[scale] duration-300 group-hover:scale-110 md:h-11 md:w-11",
              !open && "demo-pill-wiggle",
            )}
          >
            <LayoutGrid className="h-5 w-5 md:h-6 md:w-6" />
          </span>
          <span className="-mb-0.5 block text-[26px] font-black leading-none text-amber-300 [text-shadow:0_2px_12px_rgba(251,191,36,0.6)] md:text-[32px]">
            {templates.length}
          </span>
          <span className="block text-[11px] font-bold leading-[1.15] md:text-[13px]">
            Store
            <br />
            Demos
          </span>
          <span className="mt-0.5 block rounded-full bg-white px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-violet-700 shadow-sm md:px-2.5 md:py-1 md:text-[10px]">
            Explore
          </span>
        </button>
        {/* Notification dot on the tab's outer corner. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 w-4"
        >
          {!open ? (
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-75 motion-safe:animate-ping" />
          ) : null}
          <span className="relative inline-flex h-4 w-4 rounded-full bg-amber-400 ring-2 ring-white" />
        </span>
      </div>

      {requested ? (
        <TemplateDemoDialog
          open={open}
          onOpenChange={setOpen}
          locale={locale}
          activeThemeId={activeThemeId}
          templates={templates}
          returnFocusRef={tabRef}
        />
      ) : null}
    </>
  );
}
