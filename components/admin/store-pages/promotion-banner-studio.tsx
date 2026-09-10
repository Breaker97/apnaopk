"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { SliderEditor } from "@/components/admin/sliders/slider-editor";
import {
  clampAutoplaySeconds,
  createSlide,
  normalizeSlides,
  type SliderDocument,
} from "@/lib/sliders/types";

/**
 * The Promotional Banner inspector: the REAL slider editor (the Sliders
 * page's), embedded — same canvas, chips, styling popovers, shape bands, and
 * thumbnail rail. The difference is ownership: these slides live in this
 * section's own settings and autosave with the page draft, so the banner is
 * designed in place without a detour to the Sliders page and without
 * cluttering the global slider library.
 *
 * ONE slide: a promotional banner is a single placement, so the editor runs
 * in single-slide mode — no rail, no add, no transition or delay. Slides a
 * merchant added before that rule are kept in storage but only the first
 * one is edited and rendered.
 */
export function PromotionBannerStudio({
  settings,
  onSettingChange,
  locale,
  defaultLanguage,
}: {
  settings: Record<string, unknown>;
  onSettingChange: (key: string, value: unknown) => void;
  locale: string;
  defaultLanguage: string;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);

  const slides = useMemo(
    // The first slide only — the banner renders one, so the editor must not
    // offer to design a second that would never show.
    () => normalizeSlides(settings.slides).slice(0, 1),
    [settings.slides],
  );
  const transition = settings.transition === "fade" ? "fade" : "slide";
  const autoplaySeconds = clampAutoplaySeconds(settings.autoplaySeconds);
  const fullWidth = Boolean(settings.fullWidth);

  // First open of a slide-less banner: seed one slide, carrying over the
  // legacy single-image fields so an existing banner arrives with its
  // content instead of a blank canvas. Guarded by a ref — the seed write
  // round-trips through the parent and must not fire twice.
  const seeded = useRef(false);
  useEffect(() => {
    if (slides.length > 0 || seeded.current) return;
    seeded.current = true;
    const legacyText = (value: unknown) =>
      typeof value === "string"
        ? value
        : ((value as Record<string, string> | null)?.[defaultLanguage] ?? "");
    const seed = createSlide(`slide-${Date.now().toString(36)}`);
    const image = typeof settings.image === "string" ? settings.image : "";
    if (image) seed.background = { type: "image", image };
    seed.texts.heading = legacyText(settings.heading);
    seed.texts.description = legacyText(settings.subheading);
    seed.texts.cta = legacyText(settings.ctaLabel);
    if (seed.texts.description) seed.elements.description = true;
    seed.link = typeof settings.link === "string" ? settings.link : "";
    onSettingChange("slides", [seed]);
  }, [slides.length, settings, defaultLanguage, onSettingChange]);

  // The editor speaks SliderDocument; only the three keys this section
  // stores are written back, and only when they actually changed —
  // reference equality holds because the editor spreads patches.
  const doc: SliderDocument = useMemo(
    () => ({
      name: "Promotional Banner",
      handle: "",
      isActive: true,
      transition,
      autoplaySeconds,
      slides,
    }),
    [transition, autoplaySeconds, slides],
  );

  const handleChange = (next: SliderDocument) => {
    if (next.slides !== doc.slides) onSettingChange("slides", next.slides);
    if (next.transition !== doc.transition) {
      onSettingChange("transition", next.transition);
    }
    if (next.autoplaySeconds !== doc.autoplaySeconds) {
      onSettingChange("autoplaySeconds", next.autoplaySeconds);
    }
  };

  return (
    <div className="space-y-4">
      <SliderEditor
        slider={doc}
        onChange={handleChange}
        locale={locale}
        tSafe={tSafe}
        chrome="inline"
        singleSlide
        mode="banner"
      />
      <label className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
        <span className="text-sm font-medium">
          {tSafe("admin.storeBuilder.fields.fullWidth", "Full width")}
        </span>
        <Switch
          checked={fullWidth}
          onCheckedChange={(checked) => onSettingChange("fullWidth", checked)}
        />
      </label>
    </div>
  );
}
