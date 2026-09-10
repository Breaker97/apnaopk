"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ImagePlus,
  Loader2,
  Package,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  Timer,
  Trash2,
  Settings2,
} from "lucide-react";
import { AiGenerateMenu } from "@/components/ai-authoring/ai-generate-menu";
import { useAiAuthoring } from "@/components/ai-authoring/use-ai-authoring";
import { uploadImageFile } from "@/components/ai-authoring/upload-image";
import { ProductSelect } from "@/components/admin/store-pages/product-select";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UnitField } from "@/components/admin/unit-field";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { AIAuthoringRequest } from "@/lib/ai-authoring/types";
import {
  buildGradientCss,
  createSlide,
  EDITOR_CANVAS_HEIGHT,
  MAX_AUTOPLAY_SECONDS,
  MIN_AUTOPLAY_SECONDS,
  resolveImageLayout,
  resolveSlideLayout,
  resolveTextStyle,
  SLIDE_SHAPE_RATIO,
  MAX_SLIDES_PER_SLIDER,
  SLIDE_REVEALS,
  type SlideShape,
  type SlideElement,
  type SlideImageLayout,
  type SliderDocument,
  type SliderSlide,
  type SlideHAlign,
  type SlideLayout,
  type SlideTextElement,
  type SlideTextStyle,
  type SlideVAlign,
  type SlideCtaVariant,
} from "@/lib/sliders/types";
import {
  SlideCanvas,
  type SlideCanvasLabels,
  type SlideSelection,
} from "./slide-canvas";
import { AlignControls, SegmentedCell, SegmentedGroup } from "./align-controls";
import { BackgroundPicker } from "./background-picker";
import {
  CtaSettingsPopover,
  type CtaSettingsLabels,
} from "./cta-settings-popover";

/**
 * The expanded slider card: name row, element/animation toolbar, editable
 * slide canvas, device + product + background action bar, and the slide
 * thumbnail strip. Pure controlled component — the manager owns the working
 * copy and persistence.
 */

const ELEMENT_CHIPS: { key: SlideElement; fallback: string }[] = [
  { key: "heading", fallback: "Heading" },
  { key: "description", fallback: "Description" },
  { key: "tagline", fallback: "Tagline" },
  { key: "price", fallback: "Price" },
  { key: "cta", fallback: "CTA" },
  { key: "countdown", fallback: "Time Counter" },
];

const CTA_VARIANT_LABELS: Record<SlideCtaVariant, string> = {
  dark: "Dark",
  light: "Light",
  outline: "Outline",
};

const AI_MAX_CHARS: Record<SlideTextElement, number> = {
  tagline: 60,
  heading: 90,
  description: 220,
  cta: 24,
};

interface ProductInfo {
  _id: string;
  name: string;
  price?: number;
}

export function SliderEditor({
  slider,
  onChange,
  onSave,
  onDelete,
  saving = false,
  locale,
  tSafe,
  chrome = "full",
  singleSlide = false,
  mode = "slider",
}: {
  slider: SliderDocument;
  onChange: (next: SliderDocument) => void;
  onSave?: () => void;
  onDelete?: () => void;
  saving?: boolean;
  locale: string;
  tSafe: TSafe;
  /**
   * "full" is the Sliders page: name row with Save/Delete. "inline" embeds
   * the editor inside another surface (the Promotional Banner section) that
   * owns naming, persistence, and deletion itself — the slide-editing rows
   * are identical in both.
   */
  chrome?: "full" | "inline";
  /**
   * One slide, always: the thumbnail rail (and with it Add and Remove) and
   * the carousel's own transition and delay all disappear, because none of
   * them mean anything for a banner that never advances.
   */
  singleSlide?: boolean;
  /**
   * "slider" binds a product (Price element, artwork, fallback link).
   * "banner" is the Promotional Banner: plain artwork uploaded as an image,
   * the CTA linking wherever the merchant says, no product and no Price —
   * a banner promotes an offer, not one SKU.
   */
  mode?: "slider" | "banner";
}) {
  const isBanner = mode === "banner";
  const [activeIndex, setActiveIndex] = useState(0);
  const [shape, setShape] = useState<SlideShape>("landscape");
  const [products, setProducts] = useState<Record<string, ProductInfo>>({});
  const [uploadingArt, setUploadingArt] = useState(false);
  // Which layer the alignment / scale / rotation controls drive.
  const [selection, setSelection] = useState<SlideSelection>("content");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const aiAuthoring = useAiAuthoring({
    contentEndpoint: "/api/admin/ai-authoring/content",
  });

  const slides = slider.slides;
  const active = slides[Math.min(activeIndex, slides.length - 1)];
  const layout = active ? resolveSlideLayout(active, shape) : null;
  const imageLayout = active ? resolveImageLayout(active, shape) : null;
  // A slide with no artwork has no artwork layer to select.
  const imageSelected = selection === "image" && Boolean(active?.productImage);

  // Resolve the bound product once per id — the canvas price preview and the
  // AI context both read it.
  useEffect(() => {
    const id = active?.productId;
    if (!id || products[id]) return;
    let cancelled = false;
    apiClient
      .get<ProductInfo>(`/api/admin/products/${id}`)
      .then((product) => {
        if (!cancelled && product?._id) {
          setProducts((current) => ({ ...current, [id]: product }));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active?.productId, products]);

  const updateSlides = (nextSlides: SliderSlide[]) =>
    onChange({ ...slider, slides: nextSlides });

  const updateSlide = (patch: Partial<SliderSlide>) => {
    if (!active) return;
    updateSlides(
      slides.map((slide, index) =>
        index === Math.min(activeIndex, slides.length - 1)
          ? { ...slide, ...patch }
          : slide,
      ),
    );
  };

  const patchLayout = (patch: Partial<SlideLayout>) => {
    if (!active) return;
    if (shape === "landscape") {
      updateSlide({
        layout: {
          ...active.layout,
          landscape: { ...active.layout.landscape, ...patch },
        },
      });
    } else {
      updateSlide({
        layout: {
          ...active.layout,
          [shape]: { ...(active.layout[shape] ?? {}), ...patch },
        },
      });
    }
  };

  const patchImage = (patch: Partial<SlideImageLayout>) => {
    if (!active) return;
    if (shape === "landscape") {
      updateSlide({
        image: {
          ...active.image,
          landscape: { ...active.image.landscape, ...patch },
        },
      });
    } else {
      updateSlide({
        image: {
          ...active.image,
          [shape]: { ...(active.image[shape] ?? {}), ...patch },
        },
      });
    }
  };

  /**
   * Type styling is written into the band being edited. Landscape is the base
   * every other band inherits from; square and portrait hold only what they
   * change, so setting a smaller size in portrait leaves its weight and colour
   * following landscape.
   */
  const patchStyle = (element: SlideTextElement, style: SlideTextStyle) => {
    if (!active) return;
    if (shape === "landscape") {
      updateSlide({
        styles: {
          ...active.styles,
          landscape: { ...active.styles.landscape, [element]: style },
        },
      });
      return;
    }
    updateSlide({
      styles: {
        ...active.styles,
        [shape]: { ...(active.styles[shape] ?? {}), [element]: style },
      },
    });
  };

  /** The CTA's style as stored for the current band (what the gear edits). */
  const ctaOwnStyle: SlideTextStyle =
    (active
      ? shape === "landscape"
        ? active.styles.landscape.cta
        : active.styles[shape]?.cta
      : undefined) ?? {};
  /** Alignment drives whichever layer is selected. */
  const setAlign = (patch: { h?: SlideHAlign; v?: SlideVAlign }) =>
    imageSelected ? patchImage(patch) : patchLayout(patch);

  const setText = (element: SlideTextElement, value: string) => {
    if (!active) return;
    updateSlide({ texts: { ...active.texts, [element]: value } });
  };

  const ctaSettingsLabels: CtaSettingsLabels = useMemo(
    () => ({
      title: tSafe("admin.sliders.ctaSettings", "Button settings"),
      link: tSafe("admin.sliders.link", "Link"),
      style: tSafe("admin.sliders.ctaStyle", "Style"),
      paddingX: tSafe("admin.sliders.ctaPaddingX", "Padding X"),
      paddingY: tSafe("admin.sliders.ctaPaddingY", "Padding Y"),
      height: tSafe("admin.sliders.ctaHeight", "Height"),
      hint: tSafe(
        "admin.sliders.ctaBoxHint",
        "Auto follows the label size; the link falls back to the bound product on a slider.",
      ),
      variants: {
        dark: tSafe("admin.sliders.ctaVariants.dark", CTA_VARIANT_LABELS.dark),
        light: tSafe("admin.sliders.ctaVariants.light", CTA_VARIANT_LABELS.light),
        outline: tSafe(
          "admin.sliders.ctaVariants.outline",
          CTA_VARIANT_LABELS.outline,
        ),
      },
    }),
    [tSafe],
  );

  const canvasLabels: SlideCanvasLabels = useMemo(
    () => ({
      ctaSettings: ctaSettingsLabels,
      weight: tSafe("admin.sliders.textStyle.weight", "Weight"),
      style: tSafe("admin.sliders.textStyle.style", "Style"),
      size: tSafe("admin.sliders.textStyle.size", "Size"),
      color: tSafe("admin.sliders.textStyle.color", "Color"),
      width: tSafe("admin.sliders.textStyle.width", "Width"),
      startingAt: tSafe("admin.sliders.startingAt", "Starting at"),
      bindProduct: tSafe("admin.sliders.bindProduct", "bind a product"),
      countdown: {
        days: tSafe("admin.sliders.countdown.days", "Days"),
        hours: tSafe("admin.sliders.countdown.hours", "Hours"),
        minutes: tSafe("admin.sliders.countdown.minutes", "Mins"),
        seconds: tSafe("admin.sliders.countdown.seconds", "Secs"),
      },
      placeholders: {
        tagline: tSafe("admin.sliders.placeholders.tagline", "Tagline"),
        heading: tSafe("admin.sliders.placeholders.heading", "Your headline"),
        description: tSafe(
          "admin.sliders.placeholders.description",
          "Describe the offer…",
        ),
        cta: tSafe("admin.sliders.placeholders.cta", "Shop Now"),
      },
    }),
    [tSafe, ctaSettingsLabels],
  );

  const buildAiRequest = (element: SlideTextElement): AIAuthoringRequest => {
    const product = active?.productId
      ? products[active.productId]
      : undefined;
    return {
      entity: "content_page",
      operation: element === "description" ? "description" : "summary",
      locale,
      targetField: element,
      fields: {
        surface: "storefront hero slide",
        element,
        slider: slider.name,
        ...(product ? { product: product.name } : {}),
        heading: active?.texts.heading ?? "",
        tagline: active?.texts.tagline ?? "",
        description: active?.texts.description ?? "",
        cta: active?.texts.cta ?? "",
      },
      constraints: { maxLength: AI_MAX_CHARS[element], audience: "shopper" },
    };
  };

  const generateText = async (
    element: SlideTextElement,
    request: AIAuthoringRequest,
  ): Promise<string | null> => {
    const draft = await aiAuthoring.generateContent(
      `slider-${active?.id}-${element}`,
      request,
    );
    if (!draft) return null;
    const direct = draft.fields[element];
    if (typeof direct === "string" && direct) return direct;
    const first = Object.values(draft.fields).find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    return first ?? null;
  };

  const renderAiAction = (element: SlideTextElement) => (
    <AiGenerateMenu
      label={tSafe("admin.sliders.generate", "Generate")}
      placeholder={tSafe(
        "admin.sliders.aiPlaceholder",
        "Generate a short summary of the product under 50 words…",
      )}
      maxChars={AI_MAX_CHARS[element]}
      request={buildAiRequest(element)}
      loading={aiAuthoring.isLoading(`slider-${active?.id}-${element}`)}
      onGenerate={(request) => generateText(element, request)}
      onApply={(value) => setText(element, value)}
      align="end"
    />
  );

  const handleThumbDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const from = slides.findIndex((slide) => slide.id === dragged.id);
    const to = slides.findIndex((slide) => slide.id === over.id);
    if (from < 0 || to < 0) return;
    const activeId = active?.id;
    const next = arrayMove(slides, from, to);
    updateSlides(next);
    if (activeId) {
      setActiveIndex(Math.max(0, next.findIndex((s) => s.id === activeId)));
    }
  };

  const addSlide = () => {
    if (slides.length >= MAX_SLIDES_PER_SLIDER) return;
    const next = [
      ...slides,
      createSlide(`slide-${Date.now().toString(36)}`),
    ];
    updateSlides(next);
    setActiveIndex(next.length - 1);
  };

  const removeSlide = (index: number) => {
    if (slides.length <= 1) {
      toast.error(
        tSafe("admin.sliders.lastSlide", "A slider needs at least one slide"),
      );
      return;
    }
    const next = slides.filter((_, i) => i !== index);
    updateSlides(next);
    setActiveIndex((current) => Math.max(0, Math.min(current, next.length - 1)));
  };

  const uploadProductArt = async (file: File | undefined) => {
    if (!file) return;
    setUploadingArt(true);
    try {
      const uploaded = await uploadImageFile(file);
      updateSlide({ productImage: uploaded.url });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Image upload failed",
      );
    } finally {
      setUploadingArt(false);
    }
  };

  if (!active || !layout) return null;

  /** Label + typed number with a draggable unit, the shape every toolbar
      value wears. */
  const toolSlider = (
    label: string,
    value: number,
    unit: string,
    min: number,
    max: number,
    onValueChange: (next: number) => void,
    fieldClass = "w-24",
  ) => (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      <UnitField
        ariaLabel={label}
        value={value}
        unit={unit}
        min={min}
        max={max}
        onChange={onValueChange}
        className={fieldClass}
      />
    </div>
  );

  return (
    <div className={cn("space-y-4", chrome === "full" && "p-4 sm:p-5")}>
      {chrome === "full" ? (
        /* Row 1 — name, delete, save */
        <div className="flex items-center gap-3">
          <Input
            value={slider.name}
            onChange={(event) =>
              onChange({ ...slider, name: event.target.value })
            }
            placeholder={tSafe("admin.sliders.namePlaceholder", "Slider Name")}
            className="h-10 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-[8px] text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label={tSafe("admin.sliders.deleteSlider", "Delete slider")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            className="h-10 rounded-[8px] px-8"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {tSafe("admin.sliders.save", "Save")}
          </Button>
        </div>
      ) : null}

      {/* Row 2 — element chips, gap, reveal, alignment */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {ELEMENT_CHIPS.filter(
            (chip) => !(isBanner && chip.key === "price"),
          ).map((chip) => {
            const on = active.elements[chip.key];
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() =>
                  updateSlide({
                    elements: { ...active.elements, [chip.key]: !on },
                    // The countdown is the one element with no text to type:
                    // switching it on seeds a real deadline (24h out) so the
                    // chip produces something visible and editable at once,
                    // like every other chip does.
                    ...(chip.key === "countdown" &&
                    !on &&
                    !active.countdownEndsAt
                      ? {
                          countdownEndsAt: new Date(
                            Date.now() + 24 * 60 * 60 * 1000,
                          ).toISOString(),
                        }
                      : {}),
                  })
                }
                className={cn(
                  "rounded-[6px] px-2.5 py-1.5 text-xs font-semibold transition",
                  on
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {tSafe(`admin.sliders.elements.${chip.key}`, chip.fallback)}
              </button>
            );
          })}
          {/* Also reachable from the button itself on the canvas. */}
          {active.elements.cta ? (
            <CtaSettingsPopover
              trigger={
                <button
                  type="button"
                  aria-label={ctaSettingsLabels.title}
                  title={ctaSettingsLabels.title}
                  className="grid h-7 w-7 place-items-center rounded-[6px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              }
              link={active.link}
              variant={active.ctaVariant}
              ownStyle={ctaOwnStyle}
              labels={ctaSettingsLabels}
              onLinkChange={(link) => updateSlide({ link })}
              onVariantChange={(ctaVariant) => updateSlide({ ctaVariant })}
              onStyleChange={(style) => patchStyle("cta", style)}
            />
          ) : null}
        </div>

      </div>

      {/* Row 3 — size rails on the LEFT, animation and alignment on the RIGHT.
          Which layer they drive is whatever is selected on the canvas; there
          is no separate layer switch, you just click the thing. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* Gap belongs to the copy stack; scale and rotation follow the
            SELECTION, so the same rail always means "this layer's size". */}
        {imageSelected
          ? null
          : toolSlider(
              tSafe("admin.sliders.gap", "Gap"),
              layout.gap,
              "px",
              0,
              60,
              (next) => patchLayout({ gap: next }),
            )}

        {imageSelected && imageLayout
          ? toolSlider(
              tSafe("admin.sliders.scale", "Scale"),
              imageLayout.scale,
              "%",
              5,
              200,
              (next) => patchImage({ scale: next }),
            )
          : toolSlider(
              tSafe("admin.sliders.scale", "Scale"),
              layout.scale,
              "%",
              40,
              200,
              (next) => patchLayout({ scale: next }),
            )}

        {imageSelected && imageLayout
          ? toolSlider(
              tSafe("admin.sliders.rotation", "Rotation"),
              imageLayout.rotation,
              "°",
              -180,
              180,
              (next) => patchImage({ rotation: next }),
            )
          : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <NativeSelect
            value={active.reveal}
            onChange={(event) =>
              updateSlide({
                reveal: event.target.value as SliderSlide["reveal"],
              })
            }
            className="h-8 w-32 rounded-[8px] text-xs"
            aria-label={tSafe("admin.sliders.reveal", "Content animation")}
          >
            {SLIDE_REVEALS.map((reveal) => (
              <option key={reveal} value={reveal}>
                {tSafe(
                  `admin.sliders.reveals.${reveal}`,
                  reveal === "none"
                    ? "No animation"
                    : reveal
                        .split("-")
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(" "),
                )}
              </option>
            ))}
          </NativeSelect>

          <AlignControls
            h={(imageSelected ? imageLayout?.h : layout.h) ?? "left"}
            v={(imageSelected ? imageLayout?.v : layout.v) ?? "middle"}
            onChange={setAlign}
            labelFor={(axis, value) =>
              `${tSafe(
                imageSelected
                  ? "admin.sliders.layerImage"
                  : "admin.sliders.layerContent",
                imageSelected
                  ? isBanner
                    ? "Image"
                    : "Product image"
                  : "Content",
              )}: align ${value}`
            }
          />
        </div>
      </div>

      {/* Canvas. Every shape is framed at the same HEIGHT, so switching bands
          re-proportions the canvas without the page jumping around. */}
      <div
        className="mx-auto w-full transition-all"
        style={{
          maxWidth: Math.round(EDITOR_CANVAS_HEIGHT * SLIDE_SHAPE_RATIO[shape]),
        }}
      >
        <SlideCanvas
          slide={active}
          shape={shape}
          productPrice={
            active.productId ? (products[active.productId]?.price ?? null) : null
          }
          selection={imageSelected ? "image" : "content"}
          onSelectionChange={setSelection}
          onTextChange={setText}
          onStyleChange={(element, style) =>
            patchStyle(element, style)
          }
          onCtaVariantChange={(ctaVariant) => updateSlide({ ctaVariant })}
          onLinkChange={(link) => updateSlide({ link })}
          onImageNudge={patchImage}
          renderAiAction={renderAiAction}
          labels={canvasLabels}
        />
      </div>

      {/* Action bar — shape band left, transition/product/background right */}
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedGroup>
          {(
            [
              ["landscape", RectangleHorizontal],
              ["square", Square],
              ["portrait", RectangleVertical],
            ] as [SlideShape, typeof Square][]
          ).map(([band, Icon]) => (
            <SegmentedCell
              key={band}
              icon={Icon}
              active={shape === band}
              onClick={() => setShape(band)}
              label={tSafe(`admin.sliders.shapes.${band}`, band)}
            />
          ))}
        </SegmentedGroup>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {singleSlide ? null : (
            <>
          <NativeSelect
            value={slider.transition}
            onChange={(event) =>
              onChange({
                ...slider,
                transition: event.target.value === "fade" ? "fade" : "slide",
              })
            }
            className="h-8 w-32 rounded-[6px] text-xs"
            aria-label={tSafe("admin.sliders.transition", "Transition")}
          >
            <option value="slide">
              {tSafe("admin.sliders.transitions.slide", "Slide")}
            </option>
            <option value="fade">
              {tSafe("admin.sliders.transitions.fade", "Fade")}
            </option>
          </NativeSelect>

          {/* How long each slide holds before the next one. Belongs to the
              SLIDER, not the slide — it is the carousel's own timing, which
              is why it sits beside the transition. */}
          {toolSlider(
            tSafe("admin.sliders.delay", "Delay"),
            slider.autoplaySeconds,
            "s",
            MIN_AUTOPLAY_SECONDS,
            MAX_AUTOPLAY_SECONDS,
            (next) => onChange({ ...slider, autoplaySeconds: next }),
            "w-20",
          )}
            </>
          )}

          {active.elements.countdown ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 rounded-[6px] text-xs"
                >
                  <Timer className="h-3.5 w-3.5" />
                  {tSafe("admin.sliders.timer", "Timer")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-2 p-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  {tSafe("admin.sliders.timerEndsAt", "Counts down to")}
                </p>
                <Input
                  type="datetime-local"
                  value={active.countdownEndsAt.slice(0, 16)}
                  onChange={(event) =>
                    updateSlide({
                      countdownEndsAt: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : "",
                    })
                  }
                  className="h-9"
                />
              </PopoverContent>
            </Popover>
          ) : null}

          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 rounded-[6px] text-xs"
              >
                {isBanner ? (
                  <ImagePlus className="h-3.5 w-3.5" />
                ) : (
                  <Package className="h-3.5 w-3.5" />
                )}
                {isBanner
                  ? tSafe("admin.sliders.image", "Image")
                  : tSafe("admin.sliders.product", "Product")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3 p-3">
              {isBanner ? (
                <p className="text-xs leading-snug text-muted-foreground">
                  {tSafe(
                    "admin.sliders.imageHint",
                    "Artwork placed beside the copy. The button links wherever you set under its settings.",
                  )}
                </p>
              ) : (
                <>
                  <p className="text-xs leading-snug text-muted-foreground">
                    {tSafe(
                      "admin.sliders.productHint",
                      "Bind a product: the Price element and the slide's link resolve from it.",
                    )}
                  </p>
                  <ProductSelect
                    value={active.productId}
                    onChange={(productId) => updateSlide({ productId })}
                    searchPlaceholder={tSafe(
                      "admin.sliders.searchProducts",
                      "Search products…",
                    )}
                    clearLabel={tSafe(
                      "admin.sliders.clearProduct",
                      "Remove product",
                    )}
                  />
                </>
              )}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">
                  {isBanner
                    ? tSafe("admin.sliders.image", "Image")
                    : tSafe("admin.sliders.productImage", "Product image")}
                </p>
                {active.productImage ? (
                  <div className="relative overflow-hidden rounded-md border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={active.productImage}
                      alt=""
                      className="aspect-video w-full bg-muted object-contain"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="absolute right-1.5 top-1.5 h-7 w-7"
                      onClick={() => updateSlide({ productImage: "" })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-xs text-muted-foreground transition hover:bg-accent">
                    {uploadingArt ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImagePlus className="h-4 w-4" />
                    )}
                    {tSafe("admin.sliders.uploadImage", "Upload image")}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        void uploadProductArt(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
              {/* The link lives under the button's settings now; the slider
                  keeps a copy here because a product-bound slide with no
                  CTA still links as a whole. */}
              {isBanner ? null : (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {tSafe("admin.sliders.link", "Link")}
                  </p>
                  <Input
                    value={active.link}
                    onChange={(event) => updateSlide({ link: event.target.value })}
                    placeholder="/products or https://…"
                    className="h-9"
                  />
                </div>
              )}
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 rounded-[6px] text-xs"
              >
                {tSafe("admin.sliders.background", "Background")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-4">
              <BackgroundPicker
                value={active.background}
                onChange={(background) => updateSlide({ background })}
                labels={{
                  solid: tSafe("admin.sliders.bg.solid", "Solid"),
                  gradient: tSafe("admin.sliders.bg.gradient", "Gradient"),
                  image: tSafe("admin.sliders.bg.image", "Image"),
                  upload: tSafe("admin.sliders.bg.upload", "Upload Image"),
                  direction: tSafe("admin.sliders.bg.direction", "Direction"),
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Thumbnail strip — nothing to pick between when there is one slide. */}
      {singleSlide ? null : (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleThumbDragEnd}
      >
        <SortableContext
          items={slides.map((slide) => slide.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-wrap items-stretch gap-3">
            {slides.map((slide, index) => (
              <SlideThumbnail
                key={slide.id}
                slide={slide}
                selected={index === Math.min(activeIndex, slides.length - 1)}
                onSelect={() => setActiveIndex(index)}
                onRemove={() => removeSlide(index)}
              />
            ))}
            {slides.length < MAX_SLIDES_PER_SLIDER ? (
              <button
                type="button"
                onClick={addSlide}
                className="flex h-24 w-40 flex-col items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 text-xs font-semibold text-primary transition hover:bg-primary/10"
              >
                <Plus className="h-4 w-4" />
                {tSafe("admin.sliders.addSlide", "Add New Slide")}
              </button>
            ) : null}
          </div>
        </SortableContext>
      </DndContext>
      )}
    </div>
  );
}

function SlideThumbnail({
  slide,
  selected,
  onSelect,
  onRemove,
}: {
  slide: SliderSlide;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id });

  const backgroundStyle: React.CSSProperties =
    slide.background.type === "gradient" && slide.background.gradient
      ? { backgroundImage: buildGradientCss(slide.background.gradient) }
      : slide.background.type === "image" && slide.background.image
        ? {
            backgroundImage: `url(${slide.background.image})`,
            // Full image stretched to the thumb, matching the storefront.
            backgroundSize: "100% 100%",
          }
        : { backgroundColor: slide.background.color ?? "#f1f1f1" };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group/thumb relative h-24 w-40 cursor-pointer overflow-hidden rounded-lg border-2 transition",
        selected ? "border-rose-500" : "border-transparent hover:border-border",
        isDragging && "z-10 opacity-80",
      )}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      <div className="absolute inset-0" style={backgroundStyle} aria-hidden />
      {slide.productImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slide.productImage}
          alt=""
          className="absolute bottom-1 right-1 h-14 w-14 object-contain"
        />
      ) : null}
      <div className="absolute inset-0 flex flex-col justify-center gap-0.5 p-2">
        {slide.elements.heading && slide.texts.heading ? (
          <p
            className="line-clamp-2 text-[10px] font-bold leading-tight"
            style={{
              color:
                resolveTextStyle(slide, "heading", "landscape").color ??
                (slide.background.type === "image" ? "#fff" : "#1f2937"),
            }}
          >
            {slide.texts.heading}
          </p>
        ) : null}
        {slide.elements.cta && slide.texts.cta ? (
          <span className="mt-0.5 w-fit rounded-sm bg-black/80 px-1.5 py-0.5 text-[7px] font-semibold text-white">
            {slide.texts.cta}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-white/85 text-muted-foreground opacity-0 shadow transition hover:text-destructive group-hover/thumb:opacity-100"
        aria-label="Remove slide"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
