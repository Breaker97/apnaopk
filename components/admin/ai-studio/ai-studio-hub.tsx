"use client";

/**
 * AI Studio hub — the launchpad behind the sidebar's "AI Studio" item. It
 * deliberately generates nothing itself: real generation happens inside the
 * entity forms, where the AI Studio overlay works against the form's unsaved
 * state. This page showcases the capability (a zero-cost, pre-rendered
 * before/after) and deep-links into the forms where each tool lives.
 */

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Newspaper,
  Search,
  Shapes,
  Sparkles,
  SquareSplitHorizontal,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** CSS-only "dull" grade for the Before pane, so the demo ships no AI cost. */
const BEFORE_FILTER = "saturate(0.5) brightness(0.92) contrast(0.85)";

const CARDS = [
  {
    key: "productContent",
    href: "/admin/products/new",
    icon: FileText,
    titleKey: "cardProductContentTitle",
    descriptionKey: "cardProductContentDescription",
  },
  {
    key: "productGraphics",
    href: "/admin/products/new?ai-studio=image",
    icon: ImageIcon,
    titleKey: "cardProductGraphicsTitle",
    descriptionKey: "cardProductGraphicsDescription",
  },
  {
    key: "seo",
    href: "/admin/products",
    icon: Search,
    titleKey: "cardSeoTitle",
    descriptionKey: "cardSeoDescription",
  },
  {
    key: "blog",
    href: "/admin/content/blog-posts/new",
    icon: Newspaper,
    titleKey: "cardBlogTitle",
    descriptionKey: "cardBlogDescription",
  },
  {
    key: "assets",
    href: "/admin/categories/new",
    icon: Shapes,
    titleKey: "cardAssetsTitle",
    descriptionKey: "cardAssetsDescription",
  },
  {
    key: "hero",
    href: "/admin/online-store/customize",
    icon: LayoutTemplate,
    titleKey: "cardHeroTitle",
    descriptionKey: "cardHeroDescription",
  },
] as const;

export function AiStudioHub({ configured }: { configured: boolean }) {
  const t = useTranslations("aiStudioHub");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[conic-gradient(from_0deg,#22d3ee,#fbbf24,#ec4899,#d946ef,#38bdf8,#22d3ee)] p-[2px]">
              <span className="flex h-full w-full items-center justify-center rounded-[10px] bg-background">
                <Sparkles className="h-4.5 w-4.5 text-primary" />
              </span>
            </span>
            {t("title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        {configured ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("statusConfigured")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
            <TriangleAlert className="h-3.5 w-3.5" />
            {t("statusNotConfigured")}
          </span>
        )}
      </div>

      {!configured ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <span>{t("statusNotConfiguredHint")}</span>
          <Link
            href="/admin/settings/ai"
            className="shrink-0 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-amber-500/10"
          >
            {t("configureCta")}
          </Link>
        </div>
      ) : null}

      {/* Showcase */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
          <div>
            <h2 className="text-lg font-semibold">{t("showcaseTitle")}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t("showcaseSubtitle")}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {t("showcaseCaption")}
            </p>
          </div>
          <BeforeAfterSlider
            imageSrc="/shoe.png"
            beforeLabel={t("showcaseBefore")}
            afterLabel={t("showcaseAfter")}
          />
        </div>
      </section>

      {/* Action cards */}
      <section>
        <h2 className="text-lg font-semibold">{t("cardsTitle")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((card) => (
            <Link
              key={card.key}
              href={card.href}
              className="group flex flex-col gap-2.5 rounded-xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <card.icon className="h-4.5 w-4.5" />
              </span>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {t(card.titleKey)}
                <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" />
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {t(card.descriptionKey)}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Built into every form + How it works */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold">{t("everywhereTitle")}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t("everywhereSubtitle")}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold">{t("howTitle")}</h3>
          <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {(["howStep1", "howStep2", "howStep3"] as const).map(
              (stepKey, index) => (
                <li key={stepKey} className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                    {index + 1}
                  </span>
                  {t(stepKey)}
                </li>
              ),
            )}
          </ol>
        </div>
      </section>
    </div>
  );
}

/**
 * A self-contained before/after slider. Both panes render the same image; the
 * Before pane is degraded with a CSS filter, so the showcase works in demo
 * installs without an API key and without paid generations.
 */
function BeforeAfterSlider({
  imageSrc,
  beforeLabel,
  afterLabel,
}: {
  imageSrc: string;
  beforeLabel: string;
  afterLabel: string;
}) {
  const [position, setPosition] = useState(50);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updatePosition = useCallback((clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setPosition(
      Math.min(98, Math.max(2, ((clientX - rect.left) / rect.width) * 100)),
    );
  }, []);

  return (
    <div
      ref={boxRef}
      className="relative aspect-[2/1] w-full touch-none select-none overflow-hidden rounded-xl border bg-white ring-1 ring-black/5"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        updatePosition(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging.current) updatePosition(event.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- before/after compare over blob: and generated URLs */}
      <img
        src={imageSrc}
        alt={afterLabel}
        draggable={false}
        className="h-full w-full object-contain"
      />
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- before/after compare over blob: and generated URLs */}
        <img
          src={imageSrc}
          alt={beforeLabel}
          draggable={false}
          className="h-full w-full object-contain"
          style={{ filter: BEFORE_FILTER }}
        />
      </div>
      <span className="absolute left-2 top-2 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] font-medium text-background">
        {beforeLabel}
      </span>
      <span className="absolute right-2 top-2 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] font-medium text-background">
        {afterLabel}
      </span>
      <div
        className={cn(
          "absolute bottom-0 top-0 z-10 w-0.5 -translate-x-1/2 bg-white",
          "shadow-[0_0_0_1px_rgba(0,0,0,0.15)]",
        )}
        style={{ left: `${position}%` }}
      >
        <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border bg-white text-foreground shadow-md">
          <SquareSplitHorizontal className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}
