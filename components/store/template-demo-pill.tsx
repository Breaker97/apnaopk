"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { LayoutGrid, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DemoTemplate {
  id: string;
  name: string;
  description: string;
  preview?: string;
  /**
   * Absolute origin of the template's own demo deployment (from
   * DEMO_TEMPLATE_URLS). Absent only for the deployment being browsed,
   * whose card links back to its own home.
   */
  url?: string;
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

  return (
    <div className="fixed left-0 top-1/2 z-50 -translate-y-1/2">
      {/* The tab stays put; the panel slides out beside it. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? "Close store demos" : "Explore store demos"}
        className={cn(
          "group flex items-center gap-2 rounded-r-xl bg-linear-to-br from-sky-500 via-blue-600 to-indigo-600 py-2.5 pl-2.5 pr-2.5 text-white shadow-lg shadow-blue-600/40 transition-all hover:brightness-110 sm:pr-3.5",
          open && "translate-x-[300px]",
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
          {open ? (
            <X className="h-4 w-4" />
          ) : (
            <LayoutGrid className="h-4 w-4" />
          )}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-[13px] font-bold leading-tight">
            Store Demos
          </span>
          <span className="mt-0.5 block text-[10px] font-medium leading-tight text-white/85">
            {templates.length} designs to explore
          </span>
        </span>
      </button>

      <div
        className={cn(
          "absolute left-0 top-1/2 w-[300px] -translate-y-1/2 rounded-r-xl border border-l-0 border-border bg-background shadow-2xl transition-transform",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={!open}
      >
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-bold">Store templates</p>
          <p className="text-xs text-muted-foreground">
            One engine — pick a look, keep your catalog.
          </p>
        </div>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4">
          {templates.map((template) => {
            const active = template.id === activeThemeId;
            const cardClassName = cn(
              "block overflow-hidden rounded-lg border transition-colors",
              active
                ? "border-primary ring-1 ring-primary"
                : "border-border hover:border-primary/50",
            );
            const cardBody = (
              <>
                {template.preview ? (
                  <span className="relative block aspect-[4/3]">
                    <Image
                      src={template.preview}
                      alt={template.name}
                      fill
                      sizes="280px"
                      className="object-cover object-top"
                    />
                  </span>
                ) : null}
                <span className="block px-3 py-2">
                  <span className="block text-sm font-semibold">
                    {template.name}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                    {template.description}
                  </span>
                </span>
              </>
            );
            // The active card stays on this deployment; the others open
            // their own deployment in a new tab — a plain anchor, since
            // client routing cannot cross origins.
            return active ? (
              <Link
                key={template.id}
                href={`/${locale}`}
                onClick={() => setOpen(false)}
                className={cardClassName}
              >
                {cardBody}
              </Link>
            ) : (
              <a
                key={template.id}
                href={`${template.url}/${locale}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className={cardClassName}
              >
                {cardBody}
              </a>
            );
          })}
        </div>
        <div className="border-t border-border p-3">
          <Link
            href={`/${locale}/templates`}
            onClick={() => setOpen(false)}
            className="block rounded-md bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground"
          >
            Compare all templates
          </Link>
        </div>
      </div>
    </div>
  );
}
