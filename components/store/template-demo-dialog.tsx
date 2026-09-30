"use client";

import type { RefObject } from "react";
import Image from "next/image";
import Link from "@/components/language/link";
import { ArrowRight, ArrowUpRight, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface DemoTemplate {
  id: string;
  name: string;
  description: string;
  /** Desktop capture (themes/preview.ts). */
  preview?: string;
  /** Phone capture, drawn over the desktop capture's corner. */
  mobilePreview?: string;
  /**
   * Absolute origin of the template's own demo deployment (from
   * DEMO_TEMPLATE_URLS). Absent only for the deployment being browsed,
   * whose card links back to its own home.
   */
  url?: string;
}

const compareLinkClassName =
  "items-center justify-center gap-2 rounded-full bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The demo switcher's showcase, opened from TemplateDemoPill (which loads
 * this module on the first open): every template side by side with large
 * previews, in one row from `lg`; below that the row scrolls sideways rather
 * than the dialog growing taller. Colors come from the store's tokens, so on
 * each demo it reads as part of that store; the radii are fixed so the
 * switcher looks the same on every demo whatever its theme's corners.
 */
export function TemplateDemoDialog({
  open,
  onOpenChange,
  locale,
  activeThemeId,
  templates,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  activeThemeId: string;
  templates: DemoTemplate[];
  /** The tab that opened the dialog; focus goes back to it on close. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Focus lands on the dialog itself: Radix skips links when it picks
        // the first control, so it chose the close button and drew a focus
        // ring on it at open. Tab still reaches every control from here.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        // The tab is not a Radix Trigger (it lives outside this lazily loaded
        // module), and without one Radix leaves focus on <body> at close.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        className="flex max-h-[calc(100dvh-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-[28px] border-0 p-0 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.45)] ring-1 ring-foreground/10 sm:max-w-[min(1320px,calc(100%-3rem))]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 sm:px-8 sm:pt-8">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">
                Store templates
              </DialogTitle>
              <span
                aria-hidden="true"
                className="rounded-full bg-foreground/5 px-2.5 py-0.5 text-sm font-medium text-muted-foreground"
              >
                {templates.length}
              </span>
            </div>
            <DialogDescription className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              Each demo is a separate store with its own sample products. You
              can switch templates at any time without losing products, orders
              or settings.
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/templates"
              onClick={close}
              className={cn("hidden h-10 px-5 sm:inline-flex", compareLinkClassName)}
            >
              Compare all templates
              <ArrowRight className="h-4 w-4" />
            </Link>
            <DialogClose className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Four templates sit in one row where there is room and two by
              two below it, rather than three and one left on its own. */}
          <ul
            className={cn(
              "scrollbar-hide flex snap-x snap-mandatory gap-5 overflow-x-auto px-6 py-6 sm:px-8 sm:pb-8 sm:pt-7 lg:grid lg:gap-6 lg:overflow-visible",
              templates.length === 4
                ? "lg:grid-cols-2 xl:grid-cols-4"
                : "lg:grid-cols-3",
            )}
          >
            {templates.map((template) => (
              <li
                key={template.id}
                className="w-[82%] shrink-0 snap-center sm:w-[46%] lg:w-auto"
              >
                <TemplateCard
                  template={template}
                  active={template.id === activeThemeId}
                  locale={locale}
                  onNavigate={close}
                />
              </li>
            ))}
          </ul>
          {/* Phones have no room for the header's button. */}
          <div className="px-6 pb-6 sm:hidden">
            <Link
              href="/templates"
              onClick={close}
              className={cn("flex h-11 w-full", compareLinkClassName)}
            >
              Compare all templates
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({
  template,
  active,
  locale,
  onNavigate,
}: {
  template: DemoTemplate;
  active: boolean;
  locale: string;
  onNavigate: () => void;
}) {
  const className =
    "group block rounded-[24px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background";
  const body = (
    <>
      {/* A tinted panel the captures rise out of: the whole desktop capture
          sets its height (a little of its bottom tucked under the edge, so
          the hover lift never opens a gap), the phone over its corner. On a
          short screen the height cap crops them further instead of pushing
          the dialog past the viewport (20rem is roughly everything else in
          the dialog). */}
      <span
        className={cn(
          "relative block max-h-[max(8rem,calc(100dvh-20rem))] overflow-hidden rounded-[20px] bg-muted px-5 pt-5",
          active && "ring-2 ring-primary ring-offset-4 ring-offset-background",
        )}
      >
        <span className="relative -mb-3 block aspect-[4/3] overflow-hidden rounded-t-xl bg-background shadow-[0_18px_40px_-16px_rgba(0,0,0,0.35)] ring-1 ring-foreground/10 transition-transform duration-500 ease-out group-hover:-translate-y-1.5">
          {template.preview ? (
            // `unoptimized`: the src carries the template's version stamp
            // (themes/preview.ts), which the optimizer refuses — and the
            // optimizer's year-long cache is exactly what kept an old
            // screenshot on screen after a re-capture.
            <Image
              src={template.preview}
              alt=""
              fill
              unoptimized
              sizes="(min-width: 1024px) 380px, 70vw"
              className="object-cover object-top"
            />
          ) : null}
        </span>
        {template.mobilePreview ? (
          <span className="absolute -bottom-8 right-3 block max-h-[80%] w-[22%] overflow-hidden rounded-t-[14px] bg-background shadow-[0_10px_30px_-8px_rgba(0,0,0,0.4)] ring-1 ring-foreground/10 transition-transform duration-500 ease-out group-hover:-translate-y-3">
            <Image
              src={template.mobilePreview}
              alt=""
              width={390}
              height={844}
              unoptimized
              className="h-auto w-full"
            />
          </span>
        ) : null}
      </span>
      <span className="mt-4 flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-lg font-semibold tracking-tight">
              {template.name}
            </span>
            {active ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Current
              </span>
            ) : null}
          </span>
          <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {template.description}
          </span>
        </span>
        {active ? null : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border transition-colors duration-300 group-hover:border-foreground group-hover:bg-foreground group-hover:text-background">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        )}
      </span>
    </>
  );

  // The active card stays on this deployment; the others open their own
  // deployment in a new tab — a plain anchor, since client routing cannot
  // cross origins.
  return active ? (
    <Link href="/" onClick={onNavigate} className={className}>
      {body}
    </Link>
  ) : (
    <a
      href={`${template.url}/${locale}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      className={className}
    >
      {body}
    </a>
  );
}
