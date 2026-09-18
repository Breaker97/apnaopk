"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  normalizeSlideTemplate,
  resolveSlideLayout,
  SLIDE_TEMPLATES,
  slideTemplatePreset,
  type SliderSlide,
  type SlideTemplate,
  type SlideTemplatePreset,
} from "@/lib/sliders/types";

/**
 * Starting layouts: the built-in set every store has, and the ones a
 * merchant saved from a slide of their own. Applying one dresses the active
 * slide in that look and keeps its content — texts, background, product,
 * links — exactly as it was.
 *
 * Saved templates live in the store's settings (`sliderTemplates.items`),
 * so every slider on every device sees the same shelf.
 */

export interface TemplateLabels {
  title: string;
  builtIn: string;
  saved: string;
  saveAs: string;
  namePlaceholder: string;
  save: string;
  remove: string;
  empty: string;
  saved_: string;
  saveFailed: string;
  names: Record<string, string>;
}

const SETTINGS_SECTION = "sliderTemplates";

/** The saved shelf, loaded once and written back whole. */
function useSavedSlideTemplates() {
  const [items, setItems] = useState<SlideTemplate[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<Record<string, unknown>>("/api/admin/settings")
      .then((settings) => {
        if (cancelled) return;
        const section = settings?.[SETTINGS_SECTION] as { items?: unknown } | undefined;
        const list = Array.isArray(section?.items) ? section.items : [];
        setItems(list.map(normalizeSlideTemplate).filter((entry): entry is SlideTemplate => entry !== null));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: SlideTemplate[]) => {
    await apiClient.put("/api/admin/settings", {
      section: SETTINGS_SECTION,
      data: { items: next },
    });
    setItems(next);
  }, []);

  const save = useCallback(
    async (name: string, preset: SlideTemplatePreset) => {
      const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "template"}-${Date.now().toString(36)}`;
      await persist([...(items ?? []), { id, name, preset }]);
    },
    [items, persist],
  );

  const remove = useCallback(
    async (id: string) => {
      await persist((items ?? []).filter((entry) => entry.id !== id));
    },
    [items, persist],
  );

  return { items: items ?? [], loaded: items !== null, save, remove };
}

/** A thumbnail of a template's arrangement: where the copy and the artwork sit. */
function TemplateSketch({ preset }: { preset: SlideTemplatePreset }) {
  const sample = { layout: preset.layout, image: preset.image } as SliderSlide;
  const layout = resolveSlideLayout(sample, "landscape");
  const justify = { left: "flex-start", center: "center", right: "flex-end" }[layout.h];
  const align = { top: "flex-start", middle: "center", bottom: "flex-end" }[layout.v];
  const lines = (["tagline", "heading", "description"] as const).filter((element) => preset.elements[element]);
  const buttons = (["cta", "cta2"] as const).filter((element) => preset.elements[element]);
  return (
    <div className="relative aspect-[1248/450] w-full overflow-hidden rounded-[6px] border border-border bg-muted">
      {preset.image.landscape.scale > 0 ? (
        <div
          className="absolute inset-0 flex p-1.5"
          style={{
            justifyContent: { left: "flex-start", center: "center", right: "flex-end" }[preset.image.landscape.h],
            alignItems: { top: "flex-start", middle: "center", bottom: "flex-end" }[preset.image.landscape.v],
          }}
        >
          <div className="aspect-square rounded-sm bg-foreground/10" style={{ width: `${Math.min(60, preset.image.landscape.scale)}%` }} />
        </div>
      ) : null}
      <div className="absolute inset-0 flex p-2" style={{ justifyContent: justify, alignItems: align }}>
        <div className="flex flex-col gap-0.5" style={{ alignItems: justify, width: "55%" }}>
          {lines.map((element) => (
            <span
              key={element}
              className={cn("rounded-sm bg-foreground/60", element === "heading" ? "h-1.5 w-full" : "h-1 w-2/3")}
            />
          ))}
          {buttons.length > 0 ? (
            <span className="mt-0.5 flex gap-0.5">
              {buttons.map((element) => (
                <span key={element} className="h-1.5 w-5 rounded-sm bg-foreground/80" />
              ))}
            </span>
          ) : null}
        </div>
      </div>
      {preset.plate ? <span className="absolute inset-x-2 bottom-2 top-2 rounded-sm border border-dashed border-foreground/30" /> : null}
    </div>
  );
}

export function TemplatesFields({
  slide,
  onApply,
  labels,
}: {
  slide: SliderSlide;
  onApply: (preset: SlideTemplatePreset) => void;
  labels: TemplateLabels;
}) {
  const shelf = useSavedSlideTemplates();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const saveCurrent = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await shelf.save(trimmed, slideTemplatePreset(slide));
      setName("");
      toast.success(labels.saved_);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : labels.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const card = (template: SlideTemplate, removable: boolean) => (
    <div key={template.id} className="group/tpl relative">
      <button
        type="button"
        onClick={() => onApply(template.preset)}
        className="w-full rounded-[8px] p-1 text-left transition hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TemplateSketch preset={template.preset} />
        <span className="mt-1 block truncate text-[11px] font-medium">
          {labels.names[template.id] ?? template.name}
        </span>
      </button>
      {removable ? (
        <button
          type="button"
          aria-label={`${labels.remove}: ${template.name}`}
          onClick={() => void shelf.remove(template.id)}
          className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-[4px] bg-background/90 text-muted-foreground opacity-0 shadow-sm transition group-hover/tpl:opacity-100 hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3">
        <p className="text-[11px] font-medium text-muted-foreground">{labels.builtIn}</p>
        <div className="grid grid-cols-3 gap-1">
          {SLIDE_TEMPLATES.map((template) => card(template, false))}
        </div>
        <p className="text-[11px] font-medium text-muted-foreground">{labels.saved}</p>
        {shelf.items.length > 0 ? (
          <div className="grid grid-cols-3 gap-1">
            {shelf.items.map((template) => card(template, true))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">{labels.empty}</p>
        )}
        <div className="flex items-center gap-1.5 border-t border-border pt-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={labels.namePlaceholder}
            aria-label={labels.saveAs}
            className="h-8 text-xs"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveCurrent();
              }
            }}
          />
          <Button type="button" size="sm" className="h-8 gap-1 text-xs" disabled={busy || !name.trim() || !shelf.loaded} onClick={() => void saveCurrent()}>
            <Save className="h-3.5 w-3.5" />
            {labels.save}
          </Button>
        </div>
    </div>
  );
}
