"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  GalleryHorizontalEnd,
  ImageIcon,
  ImagePlus,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { NativeSelect } from "@/components/ui/native-select";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { SliderPreview } from "@/components/admin/sliders/slider-card";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { normalizeSliderDocument, type SliderDocument } from "@/lib/sliders/types";
import type {
  BlockInstance,
  SectionCatalogEntry,
} from "@/lib/storefront/sections/types";
import { BlockEditor } from "./block-editor";
import {
  COLLECTION_ROW_CORNERS,
  COLLECTION_ROW_GAP_MODES,
  COLLECTION_ROW_LIMITS,
} from "@/lib/storefront/sections/collection-rows-spacing";
import { EditorGroup, FieldLabel } from "./field-renderer";
import { PanelGroup } from "./editor-shell";
import { SliderRow } from "./product-main-editor";
import { SectionImageField } from "./section-image-field";

interface CollectionOption {
  _id: string;
  title: string;
}

/**
 * The Featured Collection ("Top Collections") inspector. The generic block
 * list stays (drag, hide, remove, Add Collection) — this editor supplies
 * what the generated fields cannot: rows labeled with the PICKED
 * collection's name, and the feature slot as one control that takes either
 * an image upload or a saved slider, like a hero grid cell.
 */
export function FeaturedCollectionEditor({
  entry,
  sectionId,
  settings,
  blocks,
  onSettingChange,
  onBlocksChange,
  locale,
  languages,
  defaultLanguage,
  renderBlockPreview,
}: {
  entry: SectionCatalogEntry;
  sectionId: string;
  settings: Record<string, unknown>;
  blocks: BlockInstance[];
  onSettingChange: (key: string, value: unknown) => void;
  onBlocksChange: (
    updater: (blocks: BlockInstance[]) => BlockInstance[],
  ) => void;
  locale: string;
  languages: string[];
  defaultLanguage: string;
  /**
   * The storefront's render of ONE row, framed under that row's fields —
   * the section preview shows every row at once, which is no help while
   * editing the third one.
   */
  renderBlockPreview?: (blockId: string) => ReactNode;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);

  // ---- data the rows need: collection names, saved sliders ----------------
  const [collections, setCollections] = useState<CollectionOption[] | null>(
    null,
  );
  const [sliders, setSliders] = useState<SliderDocument[] | null>(null);
  const [featureDialog, setFeatureDialog] = useState<{
    blockId: string;
    mode: "choose" | "sliders" | "image";
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      // paginatedResponse nests the rows: { data, pagination }, NOT an array.
      .get<{ data?: CollectionOption[] } | CollectionOption[]>(
        "/api/admin/collections?page=1&limit=100&status=active",
      )
      .then((payload) => {
        if (cancelled) return;
        const items = Array.isArray(payload) ? payload : (payload?.data ?? []);
        setCollections(items);
      })
      .catch(() => {
        if (!cancelled) setCollections([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSliders = () => {
    apiClient
      .get<SliderDocument[]>("/api/admin/sliders")
      .then((list) => {
        if (!Array.isArray(list)) return setSliders([]);
        setSliders(list.map(normalizeSliderDocument));
      })
      .catch(() => setSliders((current) => current ?? []));
  };
  useEffect(loadSliders, []);
  // The Sliders page opens from here in another tab — refresh the list every
  // time the pick dialog comes up so a just-created slider is offered.
  useEffect(() => {
    if (featureDialog?.mode === "sliders") loadSliders();
  }, [featureDialog?.mode]);

  /**
   * Titles for collections the picker's list does not carry — it asks for
   * active ones only, so a row pointing at a draft or archived collection
   * would otherwise label itself with a raw id.
   */
  const [extraTitles, setExtraTitles] = useState<Record<string, string>>({});
  const requestedIds = useRef(new Set<string>());
  useEffect(() => {
    if (collections === null) return;
    const known = new Set(collections.map((option) => option._id));
    const missing = blocks
      .map((block) =>
        typeof block.settings.collection === "string"
          ? block.settings.collection
          : "",
      )
      .filter(
        (id) => id && !known.has(id) && !requestedIds.current.has(id),
      );
    if (missing.length === 0) return;
    missing.forEach((id) => requestedIds.current.add(id));
    Promise.all(
      missing.map((id) =>
        apiClient
          // A collection that 404s stays unresolved; the rest still label.
          .get<{ _id?: string; title?: string }>(
            `/api/admin/collections/${id}`,
          )
          .catch(() => null),
      ),
    ).then((rows) => {
      const resolved = Object.fromEntries(
        rows.flatMap((row) =>
          row?._id && typeof row.title === "string"
            ? [[String(row._id), row.title] as const]
            : [],
        ),
      );
      if (Object.keys(resolved).length === 0) return;
      setExtraTitles((current) => ({ ...current, ...resolved }));
    });
  }, [collections, blocks]);

  const collectionTitle = useMemo(() => {
    const byId = new Map((collections ?? []).map((c) => [c._id, c.title]));
    return (id: unknown) =>
      typeof id === "string" ? (byId.get(id) ?? extraTitles[id]) : undefined;
  }, [collections, extraTitles]);
  const sliderByHandle = useMemo(
    () => new Map((sliders ?? []).map((entry) => [entry.handle, entry])),
    [sliders],
  );

  const patchBlock = (blockId: string, patch: Record<string, unknown>) =>
    onBlocksChange((current) =>
      current.map((block) =>
        block.id === blockId
          ? { ...block, settings: { ...block.settings, ...patch } }
          : block,
      ),
    );

  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const dialogBlock = featureDialog
    ? blocks.find((block) => block.id === featureDialog.blockId)
    : undefined;

  return (
    <div className="space-y-6">
      <EditorGroup
        title={tSafe("admin.storeBuilder.sectionEditor.settings", "Settings")}
      >
        <div className="max-w-sm space-y-1.5">
          <FieldLabel>
            {tSafe("admin.storeBuilder.fields.title", "Title")}
          </FieldLabel>
          <Input
            value={str(settings.title)}
            onChange={(event) => onSettingChange("title", event.target.value)}
          />
        </div>

        {/* The rows' geometry: the space between the panel and the shelf
            of cards (the cards keep the product card's grid spacing), the
            panel's size, its corners. */}
        <PanelGroup title={tSafe("admin.storeBuilder.panelGroups.layout", "Layout")}>
        <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
          <SelectRow
            label={tSafe("admin.storeBuilder.fields.gapMode", "Spacing")}
            value={settings.gapMode === "custom" ? "custom" : "followCards"}
            options={COLLECTION_ROW_GAP_MODES.map((key) => ({
              key,
              label: tSafe(`admin.storeBuilder.options.${key}`, key),
            }))}
            onChange={(gapMode) => onSettingChange("gapMode", gapMode)}
          />
          {settings.gapMode === "custom" ? (
            <SliderRow
              label={tSafe("admin.storeBuilder.fields.panelGap", "Gap after the feature image")}
              value={num(settings.gap, COLLECTION_ROW_LIMITS.gap.default)}
              max={COLLECTION_ROW_LIMITS.gap.max}
              onChange={(gap) => onSettingChange("gap", gap)}
            />
          ) : null}
          <SliderRow
            label={tSafe("admin.storeBuilder.fields.panelWidth", "Feature image width")}
            value={num(settings.panelWidth, COLLECTION_ROW_LIMITS.panelWidth.default)}
            max={COLLECTION_ROW_LIMITS.panelWidth.max}
            unit="%"
            zeroLabel={tSafe("admin.storeBuilder.options.auto", "Auto")}
            onChange={(panelWidth) => onSettingChange("panelWidth", panelWidth)}
          />
          <SliderRow
            label={tSafe("admin.storeBuilder.fields.panelHeight", "Feature image height")}
            value={num(settings.panelHeight, COLLECTION_ROW_LIMITS.panelHeight.default)}
            max={COLLECTION_ROW_LIMITS.panelHeight.max}
            step={10}
            zeroLabel={tSafe("admin.storeBuilder.options.matchCards", "Match cards")}
            onChange={(panelHeight) => onSettingChange("panelHeight", panelHeight)}
          />
          <SelectRow
            label={tSafe("admin.storeBuilder.fields.corners", "Corners")}
            value={settings.corners === "theme" ? "theme" : "custom"}
            options={COLLECTION_ROW_CORNERS.map((key) => ({
              key,
              label: tSafe(`admin.storeBuilder.options.${key}`, key),
            }))}
            onChange={(corners) => onSettingChange("corners", corners)}
          />
          {settings.corners !== "theme" ? (
            <SliderRow
              label={tSafe("admin.storeBuilder.fields.panelRadius", "Corner radius")}
              value={num(settings.panelRadius, COLLECTION_ROW_LIMITS.panelRadius.default)}
              max={COLLECTION_ROW_LIMITS.panelRadius.max}
              onChange={(panelRadius) => onSettingChange("panelRadius", panelRadius)}
            />
          ) : null}
        </div>
        </PanelGroup>
      </EditorGroup>

      <EditorGroup
        title={tSafe("admin.storeBuilder.blockGroups.collection", "Collections")}
        count={blocks.length}
        hint={tSafe(
          "admin.storeBuilder.sectionEditor.blocksHint",
          "Drag to reorder. Open a row to edit it.",
        )}
      >
        <BlockEditor
          entry={entry}
          sectionId={sectionId}
          blocks={blocks}
          onChange={onBlocksChange}
          languages={languages}
          defaultLanguage={defaultLanguage}
          locale={locale}
          labelFor={(block) => collectionTitle(block.settings.collection)}
          renderFields={(block) => (
            <div className="space-y-4">
              {/* Two columns: what the row shows on the left, how it is
                  built on the right. The collection is the decision; the
                  card count and the panel are its dressing. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <FieldLabel>
                    {tSafe(
                      "admin.storeBuilder.fields.collection",
                      "Collection",
                    )}
                  </FieldLabel>
                  <NativeSelect
                    value={str(block.settings.collection)}
                    onChange={(event) =>
                      patchBlock(block.id, { collection: event.target.value })
                    }
                    disabled={collections === null}
                    className="w-full"
                  >
                    <option value="">
                      {tSafe(
                        "admin.storeBuilder.selectCollection",
                        "Select a collection…",
                      )}
                    </option>
                    {(collections ?? []).map((option) => (
                      <option key={option._id} value={option._id}>
                        {option.title}
                      </option>
                    ))}
                    {/* Keep a stored id selectable even off the first page,
                        under its own name once resolved. */}
                    {str(block.settings.collection) &&
                    collections &&
                    !collections.some(
                      (option) => option._id === block.settings.collection,
                    ) ? (
                      <option value={str(block.settings.collection)}>
                        {extraTitles[str(block.settings.collection)] ??
                          str(block.settings.collection)}
                      </option>
                    ) : null}
                  </NativeSelect>
                </div>

                <div className="flex items-end gap-3">
                <div className="w-24 space-y-1.5">
                  <FieldLabel>
                    {tSafe(
                      "admin.storeBuilder.featuredCollection.cards",
                      "Cards",
                    )}
                  </FieldLabel>
                  <NumberInput
                    inputMode="numeric"
                    min={3}
                    max={6}
                    step={1}
                    aria-label={tSafe(
                      "admin.storeBuilder.fields.maxProducts",
                      "Max products to show",
                    )}
                    value={
                      typeof block.settings.limit === "number"
                        ? block.settings.limit
                        : 4
                    }
                    whenEmpty="keep"
                    normalize={Math.floor}
                    onValueChange={(next) => {
                      if (next !== undefined) patchBlock(block.id, { limit: next });
                    }}
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <FieldLabel>
                    {tSafe(
                      "admin.storeBuilder.fields.featureImage",
                      "Feature image",
                    )}
                  </FieldLabel>
                  <FeatureSlot
                    block={block}
                    sliderByHandle={sliderByHandle}
                    slidersLoaded={sliders !== null}
                    tSafe={tSafe}
                    onOpen={() =>
                      setFeatureDialog({ blockId: block.id, mode: "choose" })
                    }
                    onClear={() =>
                      patchBlock(block.id, {
                        kind: "image",
                        image: "",
                        slider: "",
                      })
                    }
                  />
                </div>
                </div>
              </div>

              {renderBlockPreview ? renderBlockPreview(block.id) : null}
            </div>
          )}
        />
      </EditorGroup>

      {featureDialog && dialogBlock ? (
        <FeatureContentDialog
          state={featureDialog}
          onStateChange={setFeatureDialog}
          block={dialogBlock}
          sectionId={sectionId}
          sectionType={entry.type}
          locale={locale}
          sliders={sliders}
          onPatch={(patch) => patchBlock(dialogBlock.id, patch)}
          tSafe={tSafe}
        />
      ) : null}
    </div>
  );
}

/**
 * The feature slot at rest: what is chosen, named.
 *
 * It used to thumbnail the choice, but a panel that is a tall promo beside
 * a product shelf is unreadable at control size — a smear of colour that
 * tells a merchant nothing. The row preview underneath shows the panel at
 * the size it actually renders, so this only has to say WHICH thing is in
 * the slot and let it be changed.
 */
function FeatureSlot({
  block,
  sliderByHandle,
  slidersLoaded,
  tSafe,
  onOpen,
  onClear,
}: {
  block: BlockInstance;
  sliderByHandle: Map<string, SliderDocument>;
  /** Until the list lands, a stored handle is unresolved, NOT missing. */
  slidersLoaded: boolean;
  tSafe: ReturnType<typeof createTSafe>;
  onOpen: () => void;
  onClear: () => void;
}) {
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const kind = block.settings.kind === "slider" ? "slider" : "image";
  const image = str(block.settings.image);
  const handle = str(block.settings.slider);
  const slider = kind === "slider" && handle
    ? sliderByHandle.get(handle)
    : undefined;
  const filled = kind === "image" ? Boolean(image) : Boolean(handle);
  const addLabel = tSafe(
    "admin.storeBuilder.featuredCollection.addFeature",
    "Add an image or a slide",
  );

  const { Icon, label, tone } = (() => {
    if (kind === "image" && image) {
      return {
        Icon: ImageIcon,
        label: tSafe("admin.storeBuilder.sliderBlock.cellImage", "Image"),
        tone: "",
      };
    }
    if (slider) {
      return { Icon: GalleryHorizontalEnd, label: slider.name, tone: "" };
    }
    if (handle && !slidersLoaded) {
      return {
        Icon: GalleryHorizontalEnd,
        label: tSafe("admin.storeBuilder.sliderBlock.cellSlider", "Slider"),
        tone: "text-muted-foreground",
      };
    }
    if (handle) {
      // The stored handle's slider was deleted — say so instead of going
      // silently blank, and keep it replaceable.
      return {
        Icon: GalleryHorizontalEnd,
        label: tSafe(
          "admin.storeBuilder.featuredCollection.missingSlider",
          "Missing",
        ),
        tone: "text-amber-600 dark:text-amber-400",
      };
    }
    return {
      Icon: ImagePlus,
      label: tSafe("admin.storeBuilder.featuredCollection.choose", "Choose…"),
      tone: "text-muted-foreground",
    };
  })();

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        title={filled ? label : addLabel}
        aria-label={addLabel}
        className={cn(
          "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[4px] border bg-background px-2.5 text-left text-xs transition-colors hover:border-primary/60 hover:bg-muted/50",
          !filled && "border-dashed",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", tone || "text-muted-foreground")} />
        <span className={cn("min-w-0 flex-1 truncate", tone)}>{label}</span>
      </button>
      {filled ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          aria-label={tSafe(
            "admin.storeBuilder.sliderBlock.removeContent",
            "Remove content",
          )}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

/** The pick dialog — image upload or saved slider, like a hero grid cell. */
function FeatureContentDialog({
  state,
  onStateChange,
  block,
  sectionId,
  sectionType,
  locale,
  sliders,
  onPatch,
  tSafe,
}: {
  state: { blockId: string; mode: "choose" | "sliders" | "image" };
  onStateChange: (
    next: { blockId: string; mode: "choose" | "sliders" | "image" } | null,
  ) => void;
  block: BlockInstance;
  sectionId: string;
  sectionType: string;
  locale: string;
  sliders: SliderDocument[] | null;
  onPatch: (patch: Record<string, unknown>) => void;
  tSafe: ReturnType<typeof createTSafe>;
}) {
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const currentSlider = str(block.settings.slider);
  const slidersHref = `/${locale}/admin/online-store/sliders`;
  const title =
    state.mode === "sliders"
      ? tSafe("admin.storeBuilder.sliderBlock.pickSlider", "Pick a slider")
      : state.mode === "image"
        ? tSafe("admin.storeBuilder.sliderBlock.cellImage", "Image")
        : tSafe(
            "admin.storeBuilder.featuredCollection.featureTitle",
            "Add feature content",
          );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onStateChange(null);
      }}
    >
      <DialogContent
        className={cn(
          "max-h-[85vh] overflow-y-auto",
          // The slider list shows REAL previews — give them room.
          state.mode === "sliders"
            ? "sm:max-w-[min(110rem,calc(100vw-4rem))]"
            : "sm:max-w-xl",
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state.mode !== "choose" ? (
              <button
                type="button"
                onClick={() => onStateChange({ ...state, mode: "choose" })}
                aria-label={tSafe("admin.storeBuilder.sliderBlock.back", "Back")}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            {title}
          </DialogTitle>
        </DialogHeader>

        {state.mode === "choose" ? (
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                {
                  key: "image",
                  icon: ImageIcon,
                  label: tSafe(
                    "admin.storeBuilder.sliderBlock.cellImage",
                    "Image",
                  ),
                  hint: tSafe(
                    "admin.storeBuilder.featuredCollection.imageHint",
                    "A static picture, linked to the collection.",
                  ),
                },
                {
                  key: "sliders",
                  icon: GalleryHorizontalEnd,
                  label: tSafe(
                    "admin.storeBuilder.sliderBlock.cellSlider",
                    "Slider",
                  ),
                  hint: tSafe(
                    "admin.storeBuilder.sliderBlock.cellSliderHint",
                    "A saved slider from the Sliders page.",
                  ),
                },
              ] as const
            ).map(({ key, icon: Icon, label, hint }) => (
              <button
                key={key}
                type="button"
                onClick={() => onStateChange({ ...state, mode: key })}
                className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-6 text-center transition-colors hover:border-primary/60 hover:bg-accent/40"
              >
                <span className="grid h-11 w-11 place-items-center rounded-md bg-accent text-foreground">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
        ) : state.mode === "sliders" ? (
          <div className="space-y-3">
            {sliders === null ? null : sliders.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {tSafe(
                  "admin.storeBuilder.sliderBlock.noSliders",
                  "No sliders yet — create one on the Sliders page.",
                )}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {sliders.map((option) => (
                  <div
                    key={String(option._id ?? option.handle)}
                    className={cn(
                      "relative flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors",
                      currentSlider === option.handle
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-primary/60 hover:bg-accent/40",
                    )}
                  >
                    {/* The real storefront component, exactly as the
                        Sliders page previews it — never a stand-in. Its own
                        dot buttons are why the card's click target is an
                        overlay rather than a wrapping button. */}
                    <span className="pointer-events-none block">
                      <SliderPreview
                        slider={option}
                        className="aspect-[16/6] w-full rounded-md"
                      />
                    </span>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {option.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {option.slides.length}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onPatch({ kind: "slider", slider: option.handle });
                        onStateChange(null);
                      }}
                      aria-pressed={currentSlider === option.handle}
                      aria-label={option.name}
                      className="absolute inset-0 z-10 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                ))}
              </div>
            )}
            <Button asChild type="button" variant="outline" className="w-full">
              <Link href={slidersHref} target="_blank">
                {tSafe(
                  "admin.storeBuilder.sliderBlock.createEdit",
                  "Create / Edit Sliders",
                )}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <SectionImageField
              value={
                block.settings.kind === "image"
                  ? str(block.settings.image)
                  : ""
              }
              onChange={(url) => onPatch({ kind: "image", image: url })}
              context={{
                locale,
                sectionType,
                sectionId,
                blockType: block.type,
                blockId: block.id,
              }}
              uploadTitle={tSafe(
                "admin.storeBuilder.imageUploadTitle",
                "Drag and drop an image, or click to browse",
              )}
              previewAspectRatio="3 / 4"
            />
            <Button
              type="button"
              className="w-full"
              onClick={() => onStateChange(null)}
            >
              {tSafe("admin.storeBuilder.sliderBlock.done", "Done")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="text-sm text-foreground">{label}</span>
      <NativeSelect
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-9 w-44 shrink-0"
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
