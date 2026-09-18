"use client";

import { useCallback, useEffect, useState } from "react";
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
  duplicateSlide,
  normalizeSliderDocument,
  sliderWorkingContent,
  type SliderDocument,
} from "@/lib/sliders/types";
import type { StoreSurface } from "@/lib/storefront/themes/surface";
import type { SliderStats } from "@/app/api/admin/sliders/[id]/stats/route";
import { SliderCard } from "./slider-card";

/**
 * The Sliders page (Online Store → Sliders): every reusable slider as a
 * card — collapsed cards autoplay the PUBLISHED slider like the real
 * storefront thing, the selected card expands into the full editor, which
 * works on the slider's DRAFT. Save keeps the draft; Publish makes it live
 * and files what was live in the history; Discard drops it.
 */

export function SlidersManager({
  locale,
  storeSurface,
  languages = [],
  defaultLanguage = "en",
}: {
  locale: string;
  /** The active theme, compiled, so previews and the canvas are styled as the storefront is. */
  storeSurface?: StoreSurface;
  /** The store's languages; with more than one, slide copy can be translated. */
  languages?: string[];
  defaultLanguage?: string;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const { confirmDelete } = useConfirmation();

  const [sliders, setSliders] = useState<SliderDocument[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** Sliders edited since they were last saved or published. */
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<Record<string, SliderStats>>({});

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<unknown[]>("/api/admin/sliders")
      .then((items) => {
        if (cancelled) return;
        setSliders(Array.isArray(items) ? items.map(normalizeSliderDocument) : []);
      })
      .catch(() => {
        if (!cancelled) {
          setSliders([]);
          toast.error(tSafe("admin.sliders.loadFailed", "Could not load sliders"));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The counts a slide earned on the shop, fetched when a card opens.
  useEffect(() => {
    if (!expandedId || stats[expandedId]) return;
    let cancelled = false;
    apiClient
      .get<SliderStats>(`/api/admin/sliders/${expandedId}/stats?days=30`)
      .then((loaded) => {
        if (!cancelled && loaded) setStats((current) => ({ ...current, [expandedId]: loaded }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [expandedId, stats]);

  const replaceSlider = useCallback((id: string, next: SliderDocument) => {
    setSliders((current) =>
      current ? current.map((slider) => (slider._id === id ? next : slider)) : current,
    );
  }, []);

  const markClean = (id: string) =>
    setDirty((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });

  /**
   * The editor speaks a whole document whose content is what it edits; here
   * that content becomes the DRAFT of the stored document, and what is live
   * stays untouched until Publish.
   */
  const editSlider = (id: string, edited: SliderDocument) => {
    setSliders((current) =>
      current
        ? current.map((slider) =>
            slider._id === id
              ? {
                  ...slider,
                  name: edited.name,
                  isActive: edited.isActive,
                  draft: {
                    transition: edited.transition,
                    autoplaySeconds: edited.autoplaySeconds,
                    controls: edited.controls,
                    slides: edited.slides,
                    updatedAt: slider.draft?.updatedAt,
                  },
                }
              : slider,
          )
        : current,
    );
    setDirty((current) => new Set(current).add(id));
  };

  const saveDraft = async (slider: SliderDocument): Promise<SliderDocument | null> => {
    if (!slider._id) return null;
    setSavingId(slider._id);
    try {
      const saved = await apiClient.put<unknown>(`/api/admin/sliders/${slider._id}`, {
        name: slider.name || "Untitled slider",
        isActive: slider.isActive,
        draft: slider.draft ?? sliderWorkingContent(slider),
      });
      const next = normalizeSliderDocument(saved);
      replaceSlider(slider._id, next);
      markClean(slider._id);
      return next;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tSafe("admin.sliders.saveFailed", "Could not save the slider"),
      );
      return null;
    } finally {
      setSavingId(null);
    }
  };

  const saveSlider = async (slider: SliderDocument) => {
    const saved = await saveDraft(slider);
    if (saved) toast.success(tSafe("admin.sliders.draftSaved", "Draft saved"));
  };

  /** Save whatever is unsaved, then make the draft live. */
  const publishSlider = async (slider: SliderDocument) => {
    if (!slider._id) return;
    setPublishingId(slider._id);
    try {
      if (dirty.has(slider._id) || slider.draft) {
        const saved = await saveDraft(slider);
        if (!saved) return;
      }
      const published = await apiClient.post<unknown>(`/api/admin/sliders/${slider._id}/publish`);
      replaceSlider(slider._id, normalizeSliderDocument(published));
      markClean(slider._id);
      toast.success(tSafe("admin.sliders.published", "Slider published"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tSafe("admin.sliders.publishFailed", "Could not publish the slider"),
      );
    } finally {
      setPublishingId(null);
    }
  };

  const discardDraft = async (slider: SliderDocument) => {
    if (!slider._id) return;
    try {
      const restored = await apiClient.post<unknown>(`/api/admin/sliders/${slider._id}/discard`);
      replaceSlider(slider._id, normalizeSliderDocument(restored));
      markClean(slider._id);
      toast.success(tSafe("admin.sliders.draftDiscarded", "Draft discarded"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tSafe("admin.sliders.discardFailed", "Could not discard the draft"),
      );
    }
  };

  const restoreVersion = async (slider: SliderDocument, index: number) => {
    if (!slider._id) return;
    try {
      const restored = await apiClient.post<unknown>(`/api/admin/sliders/${slider._id}/restore`, { index });
      replaceSlider(slider._id, normalizeSliderDocument(restored));
      markClean(slider._id);
      toast.success(tSafe("admin.sliders.restored", "Version restored to the draft"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tSafe("admin.sliders.restoreFailed", "Could not restore the version"),
      );
    }
  };

  /**
   * A copy of a whole slider, kept next to the original rather than at the
   * head of the list: it is made from the one in front of you, and the two
   * belong side by side while they are told apart. The server gives the copy
   * its own handle, so nothing the storefront binds by handle moves, and
   * every slide gets an id of its own, so nothing keyed by slide is shared.
   *
   * The COPY then opens, and the original closes: a merchant who has just
   * duplicated a slider goes on to change the copy, and with the original
   * still open in front of them, the rename and the new background landed
   * on the original instead.
   */
  const duplicateSlider = async (slider: SliderDocument) => {
    setCreating(true);
    try {
      const content = sliderWorkingContent(slider);
      const slides = content.slides.reduce<typeof content.slides>(
        (copied, slide) => [
          ...copied,
          duplicateSlide(slide, copied.map((entry) => entry.id)),
        ],
        [],
      );
      const created = await apiClient.post<unknown>("/api/admin/sliders", {
        name: `${slider.name || tSafe("admin.sliders.untitled", "Untitled slider")} ${tSafe("admin.sliders.copySuffix", "copy")}`,
        isActive: slider.isActive,
        ...content,
        slides,
      });
      const copy = normalizeSliderDocument(created);
      setSliders((current) => {
        if (!current) return [copy];
        const at = current.findIndex((entry) => entry._id === slider._id);
        if (at < 0) return [copy, ...current];
        return [...current.slice(0, at + 1), copy, ...current.slice(at + 1)];
      });
      setExpandedId(copy._id ?? null);
      // The copy sits under the original; bring it into view once it is
      // on the page, so what opens is what the merchant is looking at.
      if (copy._id) {
        const target = `slider-${copy._id}`;
        window.setTimeout(() => {
          document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
      }
      toast.success(tSafe("admin.sliders.duplicated", "Slider duplicated — now editing the copy"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tSafe("admin.sliders.duplicateFailed", "Could not duplicate the slider"),
      );
    } finally {
      setCreating(false);
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
      const slider = normalizeSliderDocument(created);
      setSliders((current) => (current ? [slider, ...current] : [slider]));
      setExpandedId(slider._id ?? null);
      // The new slider opens at the head of the list; from the button at
      // the foot of a long page that is off screen, so go to it.
      window.scrollTo({ top: 0, behavior: "smooth" });
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

  // Offered twice — in the header, and after the last card — so a merchant
  // never has to travel the length of the list to add one.
  const addButton = (variant: "default" | "outline") => (
    <Button
      type="button"
      variant={variant}
      className="h-11 shrink-0 gap-2 rounded-full px-5"
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
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
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
        {addButton("default")}
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
              onChange={(next) => editSlider(slider._id ?? "", next)}
              onSave={() => void saveSlider(slider)}
              onPublish={() => void publishSlider(slider)}
              onDiscard={() => void discardDraft(slider)}
              onRestore={(index) => restoreVersion(slider, index)}
              onDelete={() => void deleteSlider(slider)}
              onDuplicate={() => void duplicateSlider(slider)}
              saving={savingId === slider._id}
              publishing={publishingId === slider._id}
              dirty={dirty.has(slider._id ?? "")}
              stats={slider._id ? stats[slider._id] : undefined}
              locale={locale}
              tSafe={tSafe}
              storeSurface={storeSurface}
              languages={languages}
              defaultLanguage={defaultLanguage}
            />
          ))}

          {addButton("outline")}
        </>
      )}
    </div>
  );
}
