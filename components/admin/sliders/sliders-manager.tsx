"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { SliderCardsSkeleton } from "@/components/admin/online-store/online-store-skeletons";
import { apiClient } from "@/lib/api/client";
import {
  createSlide,
  normalizeSlides,
  type SliderDocument,
} from "@/lib/sliders/types";
import { SliderCard } from "./slider-card";

/**
 * The Sliders page (Online Store → Sliders): every reusable slider as a
 * card — collapsed cards autoplay like the real storefront thing, the
 * selected card expands into the full editor. Sections pick these sliders by
 * handle wherever text-over-background content is needed (hero slideshow
 * today; more block types as they adopt the `slider` field).
 */

function normalizeDocument(raw: unknown): SliderDocument {
  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    _id: typeof source._id === "string" ? source._id : String(source._id ?? ""),
    name: typeof source.name === "string" ? source.name : "Untitled slider",
    handle: typeof source.handle === "string" ? source.handle : "",
    isActive: source.isActive !== false,
    transition: source.transition === "fade" ? "fade" : "slide",
    autoplaySeconds:
      typeof source.autoplaySeconds === "number"
        ? Math.min(10, Math.max(3, source.autoplaySeconds))
        : 5,
    slides: normalizeSlides(source.slides),
  };
}

export function SlidersManager({ locale }: { locale: string }) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const { confirmDelete } = useConfirmation();

  const [sliders, setSliders] = useState<SliderDocument[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<unknown[]>("/api/admin/sliders")
      .then((items) => {
        if (cancelled) return;
        setSliders(
          Array.isArray(items) ? items.map(normalizeDocument) : [],
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSliders([]);
          toast.error(
            tSafe("admin.sliders.loadFailed", "Could not load sliders"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSlider = (id: string, next: SliderDocument) =>
    setSliders((current) =>
      current
        ? current.map((slider) => (slider._id === id ? next : slider))
        : current,
    );

  const saveSlider = async (slider: SliderDocument) => {
    if (!slider._id) return;
    setSavingId(slider._id);
    try {
      const saved = await apiClient.put<unknown>(
        `/api/admin/sliders/${slider._id}`,
        {
          name: slider.name || "Untitled slider",
          transition: slider.transition,
          autoplaySeconds: slider.autoplaySeconds,
          isActive: slider.isActive,
          slides: slider.slides,
        },
      );
      updateSlider(slider._id, normalizeDocument(saved));
      setExpandedId(null);
      toast.success(tSafe("admin.sliders.saved", "Slider saved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tSafe("admin.sliders.saveFailed", "Could not save the slider"),
      );
    } finally {
      setSavingId(null);
    }
  };

  const deleteSlider = async (slider: SliderDocument) => {
    if (!slider._id) return;
    const confirmed = await confirmDelete(slider.name || "this slider");
    if (!confirmed) return;
    try {
      await apiClient.delete(`/api/admin/sliders/${slider._id}`);
      setSliders((current) =>
        current ? current.filter((entry) => entry._id !== slider._id) : current,
      );
      if (expandedId === slider._id) setExpandedId(null);
      toast.success(tSafe("admin.sliders.deleted", "Slider deleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tSafe("admin.sliders.deleteFailed", "Could not delete the slider"),
      );
    }
  };

  const addSlider = async () => {
    setCreating(true);
    try {
      const created = await apiClient.post<unknown>("/api/admin/sliders", {
        name: tSafe("admin.sliders.newSliderName", "New Slider"),
        slides: [createSlide(`slide-${Date.now().toString(36)}`)],
      });
      const slider = normalizeDocument(created);
      setSliders((current) => (current ? [slider, ...current] : [slider]));
      setExpandedId(slider._id ?? null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tSafe("admin.sliders.createFailed", "Could not create a slider"),
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {tSafe("admin.sliders.title", "Sliders")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tSafe(
            "admin.sliders.subtitle",
            "Reusable slide groups. Build them once here, then pick them inside the hero slideshow and other blocks that lay text over a background.",
          )}
        </p>
      </div>

      {sliders === null ? (
        <SliderCardsSkeleton />
      ) : (
        <>
          {sliders.map((slider) => (
            <SliderCard
              key={slider._id}
              slider={slider}
              expanded={expandedId === slider._id}
              onExpand={() => setExpandedId(slider._id ?? null)}
              onChange={(next) => updateSlider(slider._id ?? "", next)}
              onSave={() => void saveSlider(slider)}
              onDelete={() => void deleteSlider(slider)}
              saving={savingId === slider._id}
              locale={locale}
              tSafe={tSafe}
            />
          ))}

          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 rounded-full px-5"
            onClick={() => void addSlider()}
            disabled={creating}
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {tSafe("admin.sliders.addSlider", "Add New Slider")}
          </Button>
        </>
      )}
    </div>
  );
}
