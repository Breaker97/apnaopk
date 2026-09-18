"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
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
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpToLine,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Eye,
  FolderOpen,
  ImagePlus,
  Languages,
  LayoutTemplate,
  Loader2,
  Package,
  PanelBottom,
  Plus,
  Play,
  RectangleHorizontal,
  RectangleVertical,
  Redo2,
  Rocket,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { AiGenerateMenu } from "@/components/ai-authoring/ai-generate-menu";
import { useAiAuthoring } from "@/components/ai-authoring/use-ai-authoring";
import { uploadImageFile } from "@/components/ai-authoring/upload-image";
import { ProductSelect } from "@/components/admin/store-pages/product-select";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { UnitField } from "@/components/admin/unit-field";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { StoreSurface } from "@/lib/storefront/themes/surface";
import type { AIAuthoringRequest } from "@/lib/ai-authoring/types";
import { Switch } from "@/components/ui/switch";
import { localizedSlideTexts } from "@/lib/sliders/render";
import type { SliderStats } from "@/app/api/admin/sliders/[id]/stats/route";
import {
  applySlideStyleToGroup,
  applySlideTemplate,
  buildGradientCss,
  DEFAULT_REVEAL_DURATION,
  resolveSlideArt,
  resolveSlideBackground,
  resolveSlideElements,
  createSlide,
  duplicateSlide as copySlide,
  MAX_AUTOPLAY_SECONDS,
  MIN_AUTOPLAY_SECONDS,
  resolveImageLayout,
  resolveSlideLayout,
  resolveTextStyle,
  MAX_COPY_PADDING,
  MAX_SLIDES_PER_SLIDER,
  SLIDE_REVEALS,
  SLIDE_REVEAL_EASINGS,
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
  type SlideBackground,
  type SlidePlate,
  type SlideSchedule,
  type SliderControls,
  type SlideTemplatePreset,
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
import { historyChord, useSliderHistory } from "./use-slider-history";
import {
  AnimationFields,
  ControlsFields,
  PlateFields,
  ScheduleFields,
  scheduleState,
} from "./slide-popovers";
import { useSlideClipboard } from "./slide-clipboard";
import { SlidePreviewStrip } from "./slide-preview-strip";
import { TemplatesFields } from "./templates-popover";
import { SlideWarningsStrip, type SlideWarningLabels } from "./slide-warnings";
import { SliderHistoryDialog } from "./slider-history-dialog";
import { MediaPickerDialog } from "./media-picker-dialog";
import { removeArtworkBackground } from "./remove-background";

/**
 * The expanded slider card: name row, element/animation toolbar, editable
 * slide canvas, device + product + background action bar, and the slide
 * thumbnail strip. Pure controlled component — the manager owns the working
 * copy and persistence.
 */

/** The chips' names; chips are drawn in the slide's own `order`. */
const ELEMENT_LABELS: Record<SlideElement, string> = {
  heading: "Heading",
  description: "Description",
  tagline: "Tagline",
  price: "Price",
  countdown: "Time Counter",
  cta: "Button",
  cta2: "Button 2",
};

const CTA_VARIANT_LABELS: Record<SlideCtaVariant, string> = {
  dark: "Dark",
  light: "Light",
  outline: "Outline",
  custom: "Custom",
};

const AI_MAX_CHARS: Record<SlideTextElement, number> = {
  tagline: 60,
  heading: 90,
  description: 220,
  cta: 24,
  cta2: 24,
};

interface ProductInfo {
  _id: string;
  name: string;
  price?: number;
}

/** The deadline a freshly switched-on countdown starts with: a day out. */
function deadlineTomorrow(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

export function SliderEditor({
  slider,
  onChange,
  onSave,
  onDelete,
  onDuplicate,
  saving = false,
  locale,
  tSafe,
  chrome = "full",
  singleSlide = false,
  mode = "slider",
  storeSurface,
  onPublish,
  onDiscard,
  onRestore,
  publishing = false,
  dirty = false,
  hasDraft = false,
  stats,
  languages = [],
  defaultLanguage = "en",
}: {
  slider: SliderDocument;
  onChange: (next: SliderDocument) => void;
  /** Keeps the draft. */
  onSave?: () => void;
  /** Makes the draft live. */
  onPublish?: () => void;
  /** Drops the draft; present only while there is one. */
  onDiscard?: () => void;
  /** A past version into the draft, by its position in the history. */
  onRestore?: (index: number) => Promise<void>;
  publishing?: boolean;
  /** Edited since the last save. */
  dirty?: boolean;
  hasDraft?: boolean;
  /** Views and clicks per slide, from the shop. */
  stats?: SliderStats;
  /** The store's languages; with more than one, the copy can be translated. */
  languages?: string[];
  defaultLanguage?: string;
  onDelete?: () => void;
  /** Copies the whole slider. Absent on the embedded editors, which own one. */
  onDuplicate?: () => void;
  /** The active theme, compiled — so the canvas is styled as the storefront is. */
  storeSurface?: StoreSurface;
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
  /**
   * "Match all slides": while it is on, the look the merchant sets here is
   * carried to every other slide in this slider, so a carousel reads as one
   * piece instead of four unrelated designs. Editor state, not stored — it
   * describes how edits propagate, and what it produced is already on each
   * slide by the time anything is saved.
   */
  const [matchStyles, setMatchStyles] = useState(false);
  // Every edit goes through the history, so Ctrl+Z takes it back.
  const history = useSliderHistory(slider, onChange);
  /** The language whose copy the fields show and write. */
  const [lang, setLang] = useState(defaultLanguage);
  const multilingual = languages.length > 1;
  const editingLang = multilingual ? lang : defaultLanguage;
  const [artLibrary, setArtLibrary] = useState(false);
  const [cutting, setCutting] = useState<number | null>(null);
  // The shop's frames under the canvas, shown on request.
  const [showPreview, setShowPreview] = useState(false);
  // The one inspector group that is unfolded — opening another folds it,
  // so the panel never runs longer than one group's fields.
  const [openSection, setOpenSection] = useState<InspectorSectionKey | null>("content");
  /**
   * The inspector's open panel: a setting with fields of its own (the
   * background, the product, the plate…) opens IN the inspector, over the
   * groups, with the way back in its header — so nothing floats over the
   * canvas or runs off the bottom of the window.
   */
  const [panel, setPanel] = useState<InspectorPanelKey | null>(null);
  // Slides and looks copied here paste into any slider, on any tab.
  const clipboard = useSlideClipboard();
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
    history.change({ ...slider, slides: nextSlides });
  const updateSlider = (patch: Partial<SliderDocument>) =>
    history.change({ ...slider, ...patch });

  const updateSlide = (patch: Partial<SliderSlide>) => {
    if (!active) return;
    const index = Math.min(activeIndex, slides.length - 1);
    const next = slides.map((slide, at) =>
      at === index ? { ...slide, ...patch } : slide,
    );
    // While Match all slides is on, only a change to the LOOK travels. Text,
    // artwork, background, link, alignment — everything that belongs to this
    // slide alone — stays where it was typed.
    const touchesStyle =
      "styles" in patch ||
      "ctaVariant" in patch ||
      "cta2Variant" in patch ||
      "plate" in patch;
    updateSlides(
      matchStyles && touchesStyle
        ? applySlideStyleToGroup(next, next[index].id)
        : next,
    );
  };

  /**
   * Switching it on applies what is on screen right now, rather than waiting
   * for the next edit — the merchant asked for these slides to match, and the
   * slides they are looking at should match.
   */
  const toggleMatchStyles = (on: boolean) => {
    setMatchStyles(on);
    if (on && active) updateSlides(applySlideStyleToGroup(slides, active.id));
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

  /**
   * The default language writes the slide's own texts; another language
   * writes its translation, and an emptied translation is dropped so the
   * default shows through again.
   */
  const setText = (element: SlideTextElement, value: string) => {
    if (!active) return;
    if (editingLang === defaultLanguage) {
      updateSlide({ texts: { ...active.texts, [element]: value } });
      return;
    }
    const own = { ...(active.translations?.[editingLang] ?? {}) };
    if (value) own[element] = value;
    else delete own[element];
    const translations = { ...(active.translations ?? {}) };
    if (Object.keys(own).length > 0) translations[editingLang] = own;
    else delete translations[editingLang];
    updateSlide({
      translations: Object.keys(translations).length > 0 ? translations : undefined,
    });
  };

  /**
   * The picture and the cutout the band being edited shows — its own, or
   * the landscape's — and where an edit to them lands. A band with its own
   * picture (art direction) writes to `backgrounds[band]`; without one, the
   * landscape background is what every band shows, so that is what edits.
   */
  const bandBackground = active ? resolveSlideBackground(active, shape) : null;
  const bandOwnsBackground = shape !== "landscape" && Boolean(active?.backgrounds?.[shape]);
  const setBandBackground = (background: SlideBackground) => {
    if (!active) return;
    if (shape === "landscape" || !active.backgrounds?.[shape]) {
      updateSlide({ background });
      return;
    }
    updateSlide({ backgrounds: { ...active.backgrounds, [shape]: background } });
  };
  const toggleOwnBackground = (own: boolean) => {
    if (!active || shape === "landscape") return;
    const backgrounds = { ...(active.backgrounds ?? {}) };
    if (own) backgrounds[shape] = structuredClone(active.background);
    else delete backgrounds[shape];
    updateSlide({ backgrounds: Object.keys(backgrounds).length > 0 ? backgrounds : undefined });
  };
  const bandArt = active ? resolveSlideArt(active, shape) : "";
  const bandOwnsArt = shape !== "landscape" && active?.productImages?.[shape] !== undefined;
  const setBandArt = (productImage: string) => {
    if (!active) return;
    if (shape === "landscape" || active.productImages?.[shape] === undefined) {
      updateSlide({ productImage });
      return;
    }
    updateSlide({ productImages: { ...active.productImages, [shape]: productImage } });
  };
  const toggleOwnArt = (own: boolean) => {
    if (!active || shape === "landscape") return;
    const productImages = { ...(active.productImages ?? {}) };
    if (own) productImages[shape] = active.productImage;
    else delete productImages[shape];
    updateSlide({ productImages: Object.keys(productImages).length > 0 ? productImages : undefined });
  };

  /** Which elements the band being edited shows, and how a chip changes it. */
  const bandElements = active ? resolveSlideElements(active, shape) : null;
  const toggleElement = (key: SlideElement) => {
    if (!active || !bandElements) return;
    const on = bandElements[key];
    // The countdown is the one element with no text to type: switching it
    // on seeds a real deadline (24h out) so the chip produces something
    // visible and editable at once, like every other chip does.
    const seedDeadline =
      key === "countdown" && !on && !active.countdownEndsAt
        ? { countdownEndsAt: deadlineTomorrow() }
        : {};
    if (shape === "landscape") {
      updateSlide({ elements: { ...active.elements, [key]: !on }, ...seedDeadline });
      return;
    }
    // A band stores only what it CHANGES from landscape.
    const own = { ...(active.elementsByShape?.[shape] ?? {}) };
    if (!on === active.elements[key]) delete own[key];
    else own[key] = !on;
    const byShape = { ...(active.elementsByShape ?? {}) };
    if (Object.keys(own).length > 0) byShape[shape] = own;
    else delete byShape[shape];
    updateSlide({
      elementsByShape: Object.keys(byShape).length > 0 ? byShape : undefined,
      ...seedDeadline,
    });
  };

  const reorderElements = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!active || !over || dragged.id === over.id) return;
    const from = active.order.indexOf(dragged.id as SlideElement);
    const to = active.order.indexOf(over.id as SlideElement);
    if (from < 0 || to < 0) return;
    updateSlide({ order: arrayMove(active.order, from, to) });
  };

  /** The active slide as the fields show it: its copy in the language being edited. */
  const displaySlide = active && editingLang !== defaultLanguage
    ? { ...active, texts: localizedSlideTexts(active, editingLang) }
    : active;

  /** A copied slide, pasted after the active one with a fresh id. */
  const pasteSlide = () => {
    if (!clipboard.slide || slides.length >= MAX_SLIDES_PER_SLIDER) return;
    const index = Math.min(activeIndex, slides.length - 1);
    const copy = copySlide(clipboard.slide, slides.map((slide) => slide.id));
    const next = [...slides.slice(0, index + 1), copy, ...slides.slice(index + 1)];
    updateSlides(next);
    setActiveIndex(index + 1);
  };
  const pasteStyle = () => {
    if (!active || !clipboard.style) return;
    updateSlide(applySlideTemplate(active, clipboard.style));
  };

  const applyTemplate = (preset: SlideTemplatePreset) => {
    if (!active) return;
    updateSlide(applySlideTemplate(active, preset));
  };

  const removeBackground = async () => {
    if (!bandArt) return;
    setCutting(0);
    try {
      const uploaded = await removeArtworkBackground(bandArt, (share) =>
        setCutting(Math.round(share * 100)),
      );
      setBandArt(uploaded.url);
      toast.success(tSafe("admin.sliders.cutoutDone", "Background removed"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tSafe("admin.sliders.cutoutFailed", "Could not remove the background"),
      );
    } finally {
      setCutting(null);
    }
  };

  // Short enough to sit in a toolbar; the sentence that explains it — and
  // names what does NOT travel — is the hover title and the screen-reader
  // description, so the control itself stays one phrase.
  const matchStylesLabel = tSafe(
    "admin.sliders.matchStyles",
    "Match all slides",
  );
  const matchStylesHint = tSafe(
    "admin.sliders.matchStylesHint",
    "Copies this slide's text and button styling to every other slide. Alignment stays as each slide has it.",
  );
  const matchStylesHintId = `${useId()}-match-styles`;

  const ctaSettingsLabels: CtaSettingsLabels = useMemo(
    () => ({
      title: tSafe("admin.sliders.ctaSettings", "Button settings"),
      link: tSafe("admin.sliders.link", "Link"),
      style: tSafe("admin.sliders.ctaStyle", "Style"),
      fill: tSafe("admin.sliders.ctaFill", "Fill"),
      paddingX: tSafe("admin.sliders.ctaPaddingX", "Padding X"),
      paddingY: tSafe("admin.sliders.ctaPaddingY", "Padding Y"),
      height: tSafe("admin.sliders.ctaHeight", "Height"),
      radius: tSafe("admin.sliders.ctaRadius", "Corners"),
      border: tSafe("admin.sliders.ctaBorder", "Border"),
      hint: tSafe(
        "admin.sliders.ctaBoxHint",
        "Auto follows the label; corners follow the theme until set. The link falls back to the bound product.",
      ),
      variants: {
        dark: tSafe("admin.sliders.ctaVariants.dark", CTA_VARIANT_LABELS.dark),
        light: tSafe("admin.sliders.ctaVariants.light", CTA_VARIANT_LABELS.light),
        outline: tSafe(
          "admin.sliders.ctaVariants.outline",
          CTA_VARIANT_LABELS.outline,
        ),
        custom: tSafe(
          "admin.sliders.ctaVariants.custom",
          CTA_VARIANT_LABELS.custom,
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
      letterSpacing: tSafe(
        "admin.sliders.textStyle.letterSpacing",
        "Letter spacing",
      ),
      lineHeight: tSafe("admin.sliders.textStyle.lineHeight", "Line height"),
      transform: tSafe("admin.sliders.textStyle.transform", "Case"),
      transformOptions: {
        default: tSafe("admin.sliders.textStyle.transformOptions.default", "Default"),
        none: tSafe("admin.sliders.textStyle.transformOptions.none", "None"),
        uppercase: tSafe(
          "admin.sliders.textStyle.transformOptions.uppercase",
          "Uppercase",
        ),
        capitalize: tSafe(
          "admin.sliders.textStyle.transformOptions.capitalize",
          "Capitalize",
        ),
      },
      highlight: tSafe("admin.sliders.textStyle.highlight", "Highlight"),
      highlightOptions: {
        none: tSafe("admin.sliders.textStyle.highlightOptions.none", "None"),
        color: tSafe("admin.sliders.textStyle.highlightOptions.color", "Colour"),
        italic: tSafe("admin.sliders.textStyle.highlightOptions.italic", "Italic"),
        underline: tSafe("admin.sliders.textStyle.highlightOptions.underline", "Underline"),
        marker: tSafe("admin.sliders.textStyle.highlightOptions.marker", "Marker"),
      },
      highlightColor: tSafe("admin.sliders.textStyle.highlightColor", "Highlight colour"),
      highlightHint: tSafe(
        "admin.sliders.textStyle.highlightHint",
        "Wrap a word in *asterisks* to highlight it. Without a colour of its own it takes the theme's.",
      ),
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
        cta2: tSafe("admin.sliders.placeholders.cta2", "Learn more"),
      },
    }),
    [tSafe, ctaSettingsLabels],
  );

  const warningLabels: SlideWarningLabels = useMemo(
    () => ({
      "cta-no-link": tSafe("admin.sliders.warnings.ctaNoLink", "The button has nowhere to go: set a link or bind a product."),
      "cta2-no-link": tSafe("admin.sliders.warnings.cta2NoLink", "The second button has no link."),
      "image-narrow": tSafe("admin.sliders.warnings.imageNarrow", "The picture is narrower than a desktop hero and will look soft."),
      "video-heavy": tSafe("admin.sliders.warnings.videoHeavy", "The video is over 8 MB; phones will wait for it."),
      "no-alt": tSafe("admin.sliders.warnings.noAlt", "No alt text: screen readers and search see nothing."),
      "heading-empty": tSafe("admin.sliders.warnings.headingEmpty", "The heading is on but empty."),
      "low-contrast": tSafe("admin.sliders.warnings.lowContrast", "The copy will be hard to read on this background — darken it or add a plate."),
      fix: tSafe("admin.sliders.warnings.fix", "Fix"),
    }),
    [tSafe],
  );

  const animationLabels = useMemo(
    () => ({
      title: tSafe("admin.sliders.animation.title", "Content animation"),
      reveal: tSafe("admin.sliders.reveal", "Reveal"),
      reveals: Object.fromEntries(
        SLIDE_REVEALS.map((reveal) => [
          reveal,
          tSafe(
            `admin.sliders.reveals.${reveal}`,
            reveal === "none"
              ? "No animation"
              : reveal
                  .split("-")
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(" "),
          ),
        ]),
      ),
      duration: tSafe("admin.sliders.animation.duration", "Duration"),
      stagger: tSafe("admin.sliders.animation.stagger", "Stagger"),
      easing: tSafe("admin.sliders.animation.easing", "Curve"),
      easings: {
        ease: tSafe("admin.sliders.animation.easings.ease", "Smooth"),
        "ease-out": tSafe("admin.sliders.animation.easings.easeOut", "Ease out"),
        spring: tSafe("admin.sliders.animation.easings.spring", "Spring"),
        linear: tSafe("admin.sliders.animation.easings.linear", "Linear"),
      },
      hint: tSafe("admin.sliders.animation.hint", "Elements arrive one after another when a stagger is set. Visitors who asked for less motion see none of it."),
    }),
    [tSafe],
  );

  const previewLabels = useMemo(
    () => ({
      title: tSafe("admin.sliders.preview.title", "On the shop"),
      desktop: tSafe("admin.sliders.preview.desktop", "Desktop hero"),
      tablet: tSafe("admin.sliders.preview.tablet", "Tablet"),
      phone: tSafe("admin.sliders.preview.phone", "Phone"),
      tile: tSafe("admin.sliders.preview.tile", "Square tile"),
    }),
    [tSafe],
  );

  const plateLabels = useMemo(
    () => ({
      title: tSafe("admin.sliders.plate.title", "Plate behind the copy"),
      enabled: tSafe("admin.sliders.plate.enabled", "Plate"),
      color: tSafe("admin.sliders.plate.color", "Color"),
      padding: tSafe("admin.sliders.plate.padding", "Padding"),
      radius: tSafe("admin.sliders.plate.radius", "Corners"),
      blur: tSafe("admin.sliders.plate.blur", "Blur"),
      hint: tSafe("admin.sliders.plate.hint", "A tinted box behind the text keeps it readable over a busy picture. It hugs the copy; the padding is per band."),
    }),
    [tSafe],
  );

  const scheduleLabels = useMemo(
    () => ({
      title: tSafe("admin.sliders.schedule.title", "Schedule"),
      start: tSafe("admin.sliders.schedule.start", "Show from"),
      end: tSafe("admin.sliders.schedule.end", "Until"),
      clear: tSafe("admin.sliders.schedule.clear", "Always show"),
      hint: tSafe("admin.sliders.schedule.hint", "Outside its window the slide is skipped, like a hidden one. Times are your own."),
    }),
    [tSafe],
  );

  const controlsLabels = useMemo(
    () => ({
      title: tSafe("admin.sliders.controls.title", "Arrows, indicators, pause"),
      arrows: tSafe("admin.sliders.controls.arrows", "Arrows"),
      arrowsPosition: tSafe("admin.sliders.controls.arrowsPosition", "Arrow position"),
      dots: tSafe("admin.sliders.controls.dots", "Indicators"),
      dotsPosition: tSafe("admin.sliders.controls.dotsPosition", "Indicator position"),
      pause: tSafe("admin.sliders.controls.pause", "Pause button"),
      arrowStyles: {
        none: tSafe("admin.sliders.controls.arrowStyles.none", "None"),
        round: tSafe("admin.sliders.controls.arrowStyles.round", "Round"),
        square: tSafe("admin.sliders.controls.arrowStyles.square", "Square"),
        minimal: tSafe("admin.sliders.controls.arrowStyles.minimal", "Minimal"),
      },
      arrowPositions: {
        sides: tSafe("admin.sliders.controls.arrowPositions.sides", "Sides"),
        bottom: tSafe("admin.sliders.controls.arrowPositions.bottom", "Bottom"),
      },
      dotStyles: {
        dots: tSafe("admin.sliders.controls.dotStyles.dots", "Dots"),
        bars: tSafe("admin.sliders.controls.dotStyles.bars", "Bars"),
        numbers: tSafe("admin.sliders.controls.dotStyles.numbers", "Numbers"),
        none: tSafe("admin.sliders.controls.dotStyles.none", "None"),
      },
      dotPositions: {
        start: tSafe("admin.sliders.controls.dotPositions.start", "Left"),
        center: tSafe("admin.sliders.controls.dotPositions.center", "Center"),
        end: tSafe("admin.sliders.controls.dotPositions.end", "Right"),
      },
      hint: tSafe("admin.sliders.controls.hint", "The pause button lets a reader stop the autoplay, which moving content owes them."),
    }),
    [tSafe],
  );

  const templateLabels = useMemo(
    () => ({
      title: tSafe("admin.sliders.templates.title", "Templates"),
      builtIn: tSafe("admin.sliders.templates.builtIn", "Starting layouts"),
      saved: tSafe("admin.sliders.templates.saved", "Saved"),
      saveAs: tSafe("admin.sliders.templates.saveAs", "Save this slide's look as a template"),
      namePlaceholder: tSafe("admin.sliders.templates.namePlaceholder", "Template name"),
      save: tSafe("admin.sliders.templates.save", "Save"),
      remove: tSafe("admin.sliders.templates.remove", "Remove template"),
      empty: tSafe("admin.sliders.templates.empty", "Nothing saved yet. Arrange a slide, name it, and save its look here."),
      saved_: tSafe("admin.sliders.templates.savedToast", "Template saved"),
      saveFailed: tSafe("admin.sliders.templates.saveFailed", "Could not save the template"),
      names: {
        editorial: tSafe("admin.sliders.templates.names.editorial", "Editorial"),
        centered: tSafe("admin.sliders.templates.names.centered", "Centered"),
        split: tSafe("admin.sliders.templates.names.split", "Product split"),
        caption: tSafe("admin.sliders.templates.names.caption", "Bottom caption"),
        poster: tSafe("admin.sliders.templates.names.poster", "Poster"),
        "two-buttons": tSafe("admin.sliders.templates.names.twoButtons", "Two buttons"),
      },
    }),
    [tSafe],
  );

  const libraryLabels = useMemo(
    () => ({
      title: tSafe("admin.sliders.library.title", "Media library"),
      description: tSafe("admin.sliders.library.description", "Pick something the store already has."),
      search: tSafe("admin.sliders.library.search", "Search files…"),
      empty: tSafe("admin.sliders.library.empty", "Nothing here yet."),
      loadMore: tSafe("admin.sliders.library.loadMore", "Load more"),
      loadFailed: tSafe("admin.sliders.library.loadFailed", "Could not load the library"),
    }),
    [tSafe],
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

  const duplicateSlide = (index: number) => {
    if (slides.length >= MAX_SLIDES_PER_SLIDER) {
      toast.error(
        tSafe(
          "admin.sliders.slideLimit",
          "A slider holds at most {max} slides",
        ).replace("{max}", String(MAX_SLIDES_PER_SLIDER)),
      );
      return;
    }
    const copy = copySlide(
      slides[index],
      slides.map((slide) => slide.id),
    );
    // Beside the slide it came from, not at the end: a copy is made to be
    // tweaked into the next slide, and that is where it belongs.
    const next = [...slides.slice(0, index + 1), copy, ...slides.slice(index + 1)];
    updateSlides(next);
    setActiveIndex(index + 1);
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
      setBandArt(uploaded.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Image upload failed",
      );
    } finally {
      setUploadingArt(false);
    }
  };

  if (!active || !layout) return null;

  const undoRedo = (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-[6px]"
        onClick={history.undo}
        disabled={!history.canUndo}
        aria-label={tSafe("admin.sliders.undo", "Undo")}
        title={`${tSafe("admin.sliders.undo", "Undo")} (Ctrl+Z)`}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-[6px]"
        onClick={history.redo}
        disabled={!history.canRedo}
        aria-label={tSafe("admin.sliders.redo", "Redo")}
        title={`${tSafe("admin.sliders.redo", "Redo")} (Ctrl+Shift+Z)`}
      >
        <Redo2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  /** Label on the left, control on the right — every inspector row. */
  const fieldRow = (
    label: string,
    value: number,
    unit: string,
    min: number,
    max: number,
    onValueChange: (next: number) => void,
  ) => (
    <FieldRow label={label}>
      <UnitField
        ariaLabel={label}
        value={value}
        unit={unit}
        min={min}
        max={max}
        onChange={onValueChange}
        className="w-28"
      />
    </FieldRow>
  );

  /** A small picture of a background, on the button that opens its picker. */
  const backgroundSwatch = (background: SlideBackground): React.CSSProperties =>
    background.type === "gradient" && background.gradient
      ? { backgroundImage: buildGradientCss(background.gradient) }
      : (background.type === "image" || background.type === "video") &&
          background.image
        ? {
            backgroundImage: `url(${background.image})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }
        : { backgroundColor: background.color ?? "#f1f1f1" };

  /** A row's opener: what is set now, and the chevron that says it opens a panel. */
  const panelButton = (key: InspectorPanelKey, inner: ReactNode) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 w-36 justify-between gap-1.5 rounded-[6px] px-2 text-xs"
      onClick={() => setPanel(key)}
      aria-expanded={panel === key}
    >
      <span className="flex min-w-0 items-center gap-1.5">{inner}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </Button>
  );

  const panelTitles: Record<InspectorPanelKey, string> = {
    background: tSafe("admin.sliders.background", "Background"),
    product: isBanner
      ? tSafe("admin.sliders.image", "Image")
      : tSafe("admin.sliders.product", "Product"),
    plate: plateLabels.title,
    animation: animationLabels.title,
    templates: templateLabels.title,
    schedule: scheduleLabels.title,
    timer: tSafe("admin.sliders.timer", "Timer"),
    controls: controlsLabels.title,
  };

  /** The open panel's fields. */
  const panelBody = (key: InspectorPanelKey): ReactNode => {
    switch (key) {
      case "background":
        return (
          <div className="space-y-3">
                  {/* Art direction: this band's own picture, where the desktop
                      shot would crop badly on a phone. */}
                  {shape !== "landscape" ? (
                    <div className="flex items-center justify-between gap-3 rounded-[6px] border border-border px-2.5 py-2">
                      <span className="text-xs font-medium">
                        {tSafe("admin.sliders.ownBackground", "Own picture for this band")}
                      </span>
                      <Switch
                        checked={bandOwnsBackground}
                        onCheckedChange={toggleOwnBackground}
                        aria-label={tSafe("admin.sliders.ownBackground", "Own picture for this band")}
                      />
                    </div>
                  ) : null}
                  <BackgroundPicker
                    value={bandBackground ?? active.background}
                    onChange={setBandBackground}
                    // A slide plays a video background; the product artwork and
                    // text fills beside it do not, and keep the default tabs.
                    modes={["solid", "gradient", "image", "video"]}
                    labels={{
                      solid: tSafe("admin.sliders.bg.solid", "Solid"),
                      gradient: tSafe("admin.sliders.bg.gradient", "Gradient"),
                      image: tSafe("admin.sliders.bg.image", "Image"),
                      upload: tSafe("admin.sliders.bg.upload", "Upload Image"),
                      direction: tSafe("admin.sliders.bg.direction", "Direction"),
                      darken: tSafe("admin.sliders.bg.darken", "Darken"),
                      video: tSafe("admin.sliders.bg.video", "Video"),
                      uploadVideo: tSafe(
                        "admin.sliders.bg.uploadVideo",
                        "Upload Video",
                      ),
                      poster: tSafe("admin.sliders.bg.poster", "Poster"),
                      videoHint: tSafe(
                        "admin.sliders.bg.videoHint",
                        "Plays muted and looping. The poster shows first, and stands in where motion is reduced.",
                      ),
                      focal: tSafe("admin.sliders.bg.focal", "Focal point"),
                      overlayKind: tSafe("admin.sliders.bg.overlayKind", "Darkening"),
                      overlayKinds: {
                        flat: tSafe("admin.sliders.bg.overlayKinds.flat", "Whole picture"),
                        gradient: tSafe("admin.sliders.bg.overlayKinds.gradient", "From an edge"),
                      },
                      overlayFrom: tSafe("admin.sliders.bg.overlayFrom", "From"),
                      overlayEdges: {
                        bottom: tSafe("admin.sliders.bg.overlayEdges.bottom", "Bottom"),
                        top: tSafe("admin.sliders.bg.overlayEdges.top", "Top"),
                        left: tSafe("admin.sliders.bg.overlayEdges.left", "Left"),
                        right: tSafe("admin.sliders.bg.overlayEdges.right", "Right"),
                      },
                      tint: tSafe("admin.sliders.bg.tint", "Tint"),
                      blur: tSafe("admin.sliders.bg.blur", "Blur"),
                      motion: tSafe("admin.sliders.bg.motion", "Motion"),
                      motionOptions: {
                        none: tSafe("admin.sliders.bg.motionOptions.none", "Still"),
                        kenburns: tSafe("admin.sliders.bg.motionOptions.kenburns", "Slow drift"),
                        pan: tSafe("admin.sliders.bg.motionOptions.pan", "Pan across"),
                        "zoom-out": tSafe("admin.sliders.bg.motionOptions.zoomOut", "Settle in"),
                        float: tSafe("admin.sliders.bg.motionOptions.float", "Float"),
                      },
                      library: tSafe("admin.sliders.library.button", "Library"),
                      libraryDialog: libraryLabels,
                      hover: tSafe("admin.sliders.bg.hover", "Hover"),
                      hoverOptions: {
                        none: tSafe("admin.sliders.bg.hoverOptions.none", "None"),
                        zoom: tSafe("admin.sliders.bg.hoverOptions.zoom", "Zoom"),
                        darken: tSafe("admin.sliders.bg.hoverOptions.darken", "Darken"),
                        brighten: tSafe(
                          "admin.sliders.bg.hoverOptions.brighten",
                          "Brighten",
                        ),
                      },
                    }}
                  />
                
          </div>
        );
      case "product":
        return (
          <div className="space-y-3">
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
                    {shape !== "landscape" ? (
                      <div className="flex items-center justify-between gap-3 rounded-[6px] border border-border px-2.5 py-2">
                        <span className="text-xs font-medium">
                          {tSafe("admin.sliders.ownArt", "Own artwork for this band")}
                        </span>
                        <Switch
                          checked={bandOwnsArt}
                          onCheckedChange={toggleOwnArt}
                          aria-label={tSafe("admin.sliders.ownArt", "Own artwork for this band")}
                        />
                      </div>
                    ) : null}
                    {bandArt ? (
                      <div className="relative overflow-hidden rounded-md border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={bandArt}
                          alt=""
                          className="aspect-video w-full bg-muted object-contain"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="absolute right-1.5 top-1.5 h-7 w-7"
                          onClick={() => setBandArt("")}
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
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 flex-1 gap-1.5 text-xs"
                        onClick={() => setArtLibrary(true)}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        {tSafe("admin.sliders.library.button", "Library")}
                      </Button>
                      {bandArt ? (
                        // The cutout: the background removed in the browser, the
                        // result uploaded as a transparent PNG.
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 flex-1 gap-1.5 text-xs"
                          onClick={() => void removeBackground()}
                          disabled={cutting !== null}
                          title={tSafe("admin.sliders.cutoutHint", "Removes the photo's background so the product stands free. Runs on this computer; the first time downloads the model.")}
                        >
                          {cutting !== null ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          {cutting !== null && cutting > 0
                            ? `${cutting}%`
                            : tSafe("admin.sliders.cutout", "Remove background")}
                        </Button>
                      ) : null}
                    </div>
                    <MediaPickerDialog
                      open={artLibrary}
                      onOpenChange={setArtLibrary}
                      kind="image"
                      labels={libraryLabels}
                      onPick={(media) => setBandArt(media.url)}
                    />
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
                
          </div>
        );
      case "timer":
        return (
          <div className="space-y-2">
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
                  
          </div>
        );
      case "plate":
        return (
          <PlateFields
                value={active.plate}
                onChange={(plate: SlidePlate | undefined) => updateSlide({ plate })}
                labels={plateLabels}
              />
        );
      case "animation":
        return (
          <AnimationFields
                reveal={active.reveal}
                reveals={SLIDE_REVEALS}
                duration={active.revealDuration ?? DEFAULT_REVEAL_DURATION}
                stagger={active.revealStagger ?? 0}
                easing={active.revealEasing ?? "ease"}
                easings={SLIDE_REVEAL_EASINGS}
                labels={animationLabels}
                onChange={(patch) =>
                  updateSlide({
                    ...(patch.revealEasing !== undefined
                      ? {
                          revealEasing:
                            patch.revealEasing === "ease"
                              ? undefined
                              : (patch.revealEasing as SliderSlide["revealEasing"]),
                        }
                      : {}),
                    ...(patch.reveal !== undefined
                      ? { reveal: patch.reveal as SliderSlide["reveal"] }
                      : {}),
                    ...(patch.revealDuration !== undefined
                      ? { revealDuration: patch.revealDuration }
                      : {}),
                    ...(patch.revealStagger !== undefined
                      ? { revealStagger: patch.revealStagger > 0 ? patch.revealStagger : undefined }
                      : {}),
                  })
                }
              />
        );
      case "templates":
        return (
          <TemplatesFields
                slide={active}
                onApply={applyTemplate}
                labels={templateLabels}
              />
        );
      case "schedule":
        return (
          <ScheduleFields
                value={active.schedule}
                onChange={(schedule: SlideSchedule | undefined) => updateSlide({ schedule })}
                labels={scheduleLabels}
              />
        );
      case "controls":
        return (
          <ControlsFields
                  value={slider.controls}
                  onChange={(controls: SliderControls) => updateSlider({ controls })}
                  labels={controlsLabels}
                />
        );
    }
  };

  const bands: [SlideShape, typeof Square][] = [
    ["landscape", RectangleHorizontal],
    ["square", Square],
    ["portrait", RectangleVertical],
  ];
  const scheduleNow = scheduleState(active.schedule, new Date());
  const toggleSection = (key: InspectorSectionKey) =>
    setOpenSection((current) => (current === key ? null : key));

  return (
    <div
      className={cn("space-y-4", chrome === "full" && "p-4 sm:p-5")}
      onKeyDown={(event) => {
        const chord = historyChord(event);
        if (chord) {
          event.preventDefault();
          if (chord === "undo") history.undo();
          else history.redo();
          return;
        }
        // Ctrl+C / Ctrl+V move a slide, with Shift a look — outside a text
        // field, where those chords mean text.
        const target = event.target as HTMLElement | null;
        const inField =
          target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
        if (inField || !(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === "c") {
          event.preventDefault();
          if (event.shiftKey) clipboard.copyStyle(active);
          else clipboard.copySlide(active);
        } else if (key === "v") {
          event.preventDefault();
          if (event.shiftKey) pasteStyle();
          else pasteSlide();
        }
      }}
    >
      {chrome === "full" ? (
        /* The slider's own row: its name and undo/redo on the left; on the
           right, one primary action — Publish — with Save draft beside it
           and the rarer ones (history, copy, delete, discard) quieter. */
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={slider.name}
            onChange={(event) => updateSlider({ name: event.target.value })}
            placeholder={tSafe("admin.sliders.namePlaceholder", "Slider Name")}
            className="h-10 min-w-40 flex-1 text-sm font-semibold"
          />
          {undoRedo}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {onRestore ? (
              <SliderHistoryDialog
                slider={slider}
                onRestore={onRestore}
                locale={locale}
                labels={{
                  open: tSafe("admin.sliders.history.open", "History"),
                  title: tSafe("admin.sliders.history.title", "Published versions"),
                  description: tSafe("admin.sliders.history.description", "Restoring puts a version into the draft. Publish it when it is what you meant."),
                  restore: tSafe("admin.sliders.history.restore", "Restore"),
                  empty: tSafe("admin.sliders.history.empty", "Nothing published yet."),
                  slides: tSafe("admin.sliders.history.slides", "slides"),
                }}
              />
            ) : null}
            {onDuplicate ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-[8px] text-muted-foreground hover:text-foreground"
                onClick={onDuplicate}
                aria-label={tSafe("admin.sliders.duplicateSlider", "Duplicate slider")}
                title={tSafe("admin.sliders.duplicateSlider", "Duplicate slider")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-[8px] text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label={tSafe("admin.sliders.deleteSlider", "Delete slider")}
              title={tSafe("admin.sliders.deleteSlider", "Delete slider")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            {onDiscard ? (
              <Button
                type="button"
                variant="ghost"
                className="h-9 gap-1.5 rounded-[8px] px-3 text-muted-foreground"
                onClick={onDiscard}
                disabled={saving || publishing}
                title={tSafe("admin.sliders.discardHint", "Drops the draft; what is live stays as it is.")}
              >
                <X className="h-4 w-4" />
                {tSafe("admin.sliders.discard", "Discard draft")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-1.5 rounded-[8px] px-4"
              onClick={onSave}
              disabled={saving || publishing || !dirty}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {tSafe("admin.sliders.saveDraft", "Save draft")}
              {dirty ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
            </Button>
            <Button
              type="button"
              className="h-9 gap-1.5 rounded-[8px] px-5"
              onClick={onPublish}
              disabled={saving || publishing || (!dirty && !hasDraft)}
              title={tSafe("admin.sliders.publishHint", "Saves the draft and makes it live on the shop.")}
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {tSafe("admin.sliders.publish", "Publish")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* The workspace: the stage on the left — what you are looking at and
          the slides — and the inspector on the right, every setting in a
          named group, the rarely touched ones folded. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          {/* Over the canvas: which SIZE is being designed. One control,
              named for the frames it covers — the shop's frames themselves
              are a preview, opened when wanted, not a second switch. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {tSafe("admin.sliders.designFor", "Design for")}
              </span>
              <div
                className="flex overflow-hidden rounded-[8px] border border-border"
                role="group"
                aria-label={tSafe("admin.sliders.designFor", "Design for")}
              >
                {bands.map(([band, Icon]) => (
                  <button
                    key={band}
                    type="button"
                    onClick={() => setShape(band)}
                    aria-pressed={shape === band}
                    className={cn(
                      "flex h-8 items-center gap-1.5 border-r border-border px-2.5 text-xs font-medium transition last:border-r-0",
                      shape === band
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tSafe(`admin.sliders.shapes.${band}`, band)}
                  </button>
                ))}
              </div>
            </div>
            {shape !== "landscape" ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {tSafe(
                  "admin.sliders.bandHint",
                  "Starts from the desktop design. What you change here applies to this size only.",
                )}
              </p>
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {chrome === "inline" ? undoRedo : null}
              {multilingual ? (
                <div
                  className="flex items-center gap-0.5 rounded-[8px] border border-border bg-background p-0.5"
                  role="group"
                  aria-label={tSafe("admin.sliders.language", "Language")}
                >
                  <Languages className="mx-1 h-3.5 w-3.5 text-muted-foreground" />
                  {languages.map((code) => {
                    const translated =
                      code !== defaultLanguage &&
                      Boolean(active.translations?.[code] && Object.keys(active.translations[code]).length > 0);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setLang(code)}
                        aria-pressed={editingLang === code}
                        className={cn(
                          "relative rounded-[6px] px-2 py-1 text-[11px] font-semibold uppercase transition",
                          editingLang === code
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        {code}
                        {translated ? (
                          <span aria-hidden className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <Button
                type="button"
                variant={showPreview ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-1.5 rounded-[8px] text-xs"
                onClick={() => setShowPreview((open) => !open)}
                aria-pressed={showPreview}
              >
                <Eye className="h-3.5 w-3.5" />
                {tSafe("admin.sliders.preview.toggle", "Preview on the shop")}
              </Button>
            </div>
          </div>

          {/* The artboard: the band's real storefront frame, zoomed to fit.
              Inside the store surface (the active theme's variables) it wears
              the same fonts and button styling the storefront applies. */}
          <div
            className={cn("store-surface mx-auto w-full transition-all", storeSurface && "bg-transparent")}
            {...(storeSurface?.attributes ?? {})}
            style={storeSurface?.vars as React.CSSProperties | undefined}
          >
            <SlideCanvas
              slide={displaySlide ?? active}
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
              onCtaVariantChange={(element, variant) =>
                updateSlide(element === "cta2" ? { cta2Variant: variant } : { ctaVariant: variant })
              }
              onLinkChange={(element, link) =>
                updateSlide(element === "cta2" ? { link2: link } : { link })
              }
              onImageNudge={patchImage}
              renderAiAction={renderAiAction}
              labels={canvasLabels}
            />
          </div>

          {/* What can be said about the slide before it ships. */}
          <SlideWarningsStrip
            slide={active}
            shape={shape}
            labels={warningLabels}
            onFix={(patch) => updateSlide(patch)}
          />

          {/* The slide at the frames it lands in on the shop, live — shown
              on request, so the canvas stays the one picture to read. */}
          {showPreview ? (
            <div className="space-y-2 rounded-[10px] border border-border bg-muted/30 p-3">
              <p className="text-[11px] leading-snug text-muted-foreground">
                {tSafe(
                  "admin.sliders.preview.hint",
                  "How this slide lands in each frame on the shop, as you edit. Click a frame to design for its size.",
                )}
              </p>
              <SlidePreviewStrip
                slide={displaySlide ?? active}
                labels={{ startingAt: canvasLabels.startingAt, countdown: canvasLabels.countdown }}
                frameLabels={previewLabels}
                active={shape}
                onPick={setShape}
              />
            </div>
          ) : null}

          {/* The slides — nothing to pick between when there is one. */}
          {singleSlide ? null : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">
                {tSafe("admin.sliders.slidesHeading", "Slides")}
              </p>
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
                        onDuplicate={() => duplicateSlide(index)}
                        onRemove={() => removeSlide(index)}
                        duplicateLabel={tSafe("admin.sliders.duplicateSlide", "Duplicate slide")}
                        removeLabel={tSafe("admin.sliders.removeSlide", "Remove slide")}
                        stats={stats?.slides[slide.id]}
                        statsLabel={tSafe("admin.sliders.statsHint", "Views · click rate, last {days} days").replace("{days}", String(stats?.days ?? 30))}
                        scheduleBadge={
                          scheduleState(slide.schedule, new Date()) === "always"
                            ? null
                            : tSafe(`admin.sliders.schedule.state.${scheduleState(slide.schedule, new Date())}`, scheduleState(slide.schedule, new Date()))
                        }
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => clipboard.copySlide(active)}
                      className="flex h-24 w-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground"
                      title={tSafe("admin.sliders.clipboard.copySlideHint", "Copies this slide to paste into any slider, on any tab.")}
                    >
                      <ClipboardCopy className="h-4 w-4" />
                      {tSafe("admin.sliders.clipboard.copySlide", "Copy slide")}
                    </button>
                    {clipboard.slide && slides.length < MAX_SLIDES_PER_SLIDER ? (
                      <button
                        type="button"
                        onClick={pasteSlide}
                        className="flex h-24 w-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground"
                      >
                        <ClipboardPaste className="h-4 w-4" />
                        {tSafe("admin.sliders.clipboard.pasteSlide", "Paste slide")}
                      </button>
                    ) : null}
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
            </div>
          )}
        </div>

        {/* The inspector. Each group names what it holds and says in a line
            what it is for; the two a merchant reaches for first are open,
            the rest fold until wanted. Which LAYER the content group drives
            is whatever is selected on the canvas — you click the thing. */}
        <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
          {panel ? (
            <InspectorPanel
              key={panel}
              title={panelTitles[panel]}
              backLabel={tSafe("admin.sliders.inspector.back", "Back")}
              onBack={() => setPanel(null)}
            >
              {panelBody(panel)}
            </InspectorPanel>
          ) : (
          <div className="space-y-2 animate-in fade-in-0 slide-in-from-left-2 duration-200">
          <InspectorSection
            title={tSafe("admin.sliders.inspector.content", "Content")}
            hint={
              imageSelected
                ? tSafe(
                    "admin.sliders.inspector.imageHint",
                    "The artwork is selected. Click the copy on the canvas to get back to the text.",
                  )
                : tSafe(
                    "admin.sliders.inspector.contentHint",
                    "What the slide shows, and how the copy sits. Drag a chip to reorder; per size, a phone can drop a line.",
                  )
            }
            badge={
              imageSelected
                ? tSafe(
                    "admin.sliders.layerImage",
                    isBanner ? "Image" : "Product image",
                  )
                : undefined
            }
            open={openSection === "content"}
            onToggle={() => toggleSection("content")}
          >
            {imageSelected && imageLayout ? (
              <>
                {fieldRow(
                  tSafe("admin.sliders.scale", "Scale"),
                  imageLayout.scale,
                  "%",
                  5,
                  200,
                  (next) => patchImage({ scale: next }),
                )}
                {fieldRow(
                  tSafe("admin.sliders.rotation", "Rotation"),
                  imageLayout.rotation,
                  "°",
                  -180,
                  180,
                  (next) => patchImage({ rotation: next }),
                )}
                {/* Where the artwork sits against the copy: behind it, or
                    over its edge — the editorial look. */}
                <FieldRow label={tSafe("admin.sliders.artPlacement", "Placement")}>
                  <SegmentedGroup>
                    <SegmentedCell
                      icon={ArrowDownToLine}
                      active={!active.artInFront}
                      onClick={() => updateSlide({ artInFront: false })}
                      label={tSafe("admin.sliders.artBehind", "Artwork behind the copy")}
                    />
                    <SegmentedCell
                      icon={ArrowUpToLine}
                      active={active.artInFront}
                      onClick={() => updateSlide({ artInFront: true })}
                      label={tSafe("admin.sliders.artInFront", "Artwork in front of the copy")}
                    />
                  </SegmentedGroup>
                </FieldRow>
              </>
            ) : (
              <>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={reorderElements}
                >
                  <SortableContext items={active.order} strategy={horizontalListSortingStrategy}>
                    <div className="flex flex-wrap items-center gap-1">
                      {active.order
                        .filter((key) => !(isBanner && key === "price"))
                        .map((key) => (
                          <ElementChip
                            key={key}
                            id={key}
                            on={Boolean(bandElements?.[key])}
                            overridden={
                              shape !== "landscape" &&
                              active.elementsByShape?.[shape]?.[key] !== undefined
                            }
                            label={tSafe(`admin.sliders.elements.${key}`, ELEMENT_LABELS[key])}
                            onToggle={() => toggleElement(key)}
                          />
                        ))}
                      {/* Also reachable from the button itself on the canvas. */}
                      {bandElements?.cta ? (
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
                  </SortableContext>
                </DndContext>
                {/* Gap belongs to the copy stack; the inset from the slide's
                    edge is per band, because an inset that suits a 1248px
                    hero is a third of a phone. */}
                {fieldRow(
                  tSafe("admin.sliders.gap", "Gap"),
                  layout.gap,
                  "px",
                  0,
                  60,
                  (next) => patchLayout({ gap: next }),
                )}
                {fieldRow(
                  tSafe("admin.sliders.padding", "Padding"),
                  layout.padding,
                  "px",
                  0,
                  MAX_COPY_PADDING,
                  (next) => patchLayout({ padding: next }),
                )}
                {fieldRow(
                  tSafe("admin.sliders.scale", "Scale"),
                  layout.scale,
                  "%",
                  40,
                  200,
                  (next) => patchLayout({ scale: next }),
                )}
              </>
            )}
            <div className="space-y-1.5">
              <span className="text-xs font-medium">
                {tSafe("admin.sliders.align", "Align")}
              </span>
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
          </InspectorSection>

          <InspectorSection
            title={tSafe("admin.sliders.inspector.media", "Background & artwork")}
            hint={tSafe(
              "admin.sliders.inspector.mediaHint",
              "What is behind the copy, the product it sells, and a plate under the text for legibility.",
            )}
            open={openSection === "media"}
            onToggle={() => toggleSection("media")}
          >
            <FieldRow label={tSafe("admin.sliders.background", "Background")}>
              {panelButton("background", <><span
                      aria-hidden
                      className="h-4 w-6 shrink-0 rounded-[3px] border border-border"
                      style={backgroundSwatch(bandBackground ?? active.background)}
                    />
                    <span className="truncate">
                      {tSafe(
                        `admin.sliders.bg.${(bandBackground ?? active.background).type}`,
                        (bandBackground ?? active.background).type,
                      )}
                    </span></>)}
            </FieldRow>

            <FieldRow
              label={
                isBanner
                  ? tSafe("admin.sliders.image", "Image")
                  : tSafe("admin.sliders.product", "Product")
              }
            >
              {panelButton("product", <>{isBanner ? (
                      <ImagePlus className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Package className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">
                      {isBanner
                        ? bandArt
                          ? tSafe("admin.sliders.stateSet", "Set")
                          : tSafe("admin.sliders.stateNone", "None")
                        : active.productId
                          ? (products[active.productId]?.name ?? tSafe("admin.sliders.stateSet", "Set"))
                          : tSafe("admin.sliders.stateNone", "None")}
                    </span></>)}
            </FieldRow>

            <FieldRow label={tSafe("admin.sliders.plate.enabled", "Plate")}>
              {panelButton("plate", <><PanelBottom className="h-3.5 w-3.5 shrink-0" />
                    {active.plate
                      ? tSafe("admin.sliders.stateOn", "On")
                      : tSafe("admin.sliders.stateOff", "Off")}</>)}
            </FieldRow>
          </InspectorSection>

          <InspectorSection
            title={tSafe("admin.sliders.inspector.look", "Look & motion")}
            hint={tSafe(
              "admin.sliders.inspector.lookHint",
              "How the copy comes in, and ready-made looks to start from or carry to other slides.",
            )}
            open={openSection === "look"}
            onToggle={() => toggleSection("look")}
          >
            <FieldRow label={tSafe("admin.sliders.animation.title", "Animation")}>
              {panelButton("animation", <><Play className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {animationLabels.reveals[active.reveal] ?? active.reveal}
                    </span></>)}
            </FieldRow>
            <FieldRow label={tSafe("admin.sliders.templates.title", "Templates")}>
              {panelButton("templates", <><LayoutTemplate className="h-3.5 w-3.5 shrink-0" />
                    {tSafe("admin.sliders.templates.browse", "Browse")}</>)}
            </FieldRow>
            <FieldRow label={tSafe("admin.sliders.clipboard.style", "This look")}>
              <div className="flex w-36 gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 gap-1.5 rounded-[6px] px-2 text-xs"
                  onClick={() => clipboard.copyStyle(active)}
                  title={tSafe("admin.sliders.clipboard.copyStyleHint", "Copies this slide's look — layout, type, buttons, plate — to paste on any slide, in any slider.")}
                >
                  <ClipboardCopy className="h-3.5 w-3.5 shrink-0" />
                  {tSafe("admin.sliders.clipboard.copy", "Copy")}
                </Button>
                {clipboard.style ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 gap-1.5 rounded-[6px] px-2 text-xs"
                    onClick={pasteStyle}
                    title={tSafe("admin.sliders.clipboard.pasteStyle", "Paste style")}
                  >
                    <ClipboardPaste className="h-3.5 w-3.5 shrink-0" />
                    {tSafe("admin.sliders.clipboard.paste", "Paste")}
                  </Button>
                ) : null}
              </div>
            </FieldRow>
            {/* One look across the carousel. Off by default: a slider whose
                slides were each designed on their own should not be flattened
                the moment it is opened. */}
            {singleSlide ? null : (
              <div className="flex items-start justify-between gap-3 rounded-[6px] bg-muted/50 px-2.5 py-2">
                <div className="min-w-0">
                  <span className="text-xs font-medium">{matchStylesLabel}</span>
                  <p id={matchStylesHintId} className="text-[11px] leading-snug text-muted-foreground">
                    {matchStylesHint}
                  </p>
                </div>
                <Switch
                  checked={matchStyles}
                  onCheckedChange={toggleMatchStyles}
                  aria-label={matchStylesLabel}
                  aria-describedby={matchStylesHintId}
                />
              </div>
            )}
          </InspectorSection>

          <InspectorSection
            title={tSafe("admin.sliders.inspector.timing", "When it shows")}
            hint={tSafe(
              "admin.sliders.inspector.timingHint",
              "Run the slide only between dates, and point its countdown at a moment.",
            )}
            badge={
              scheduleNow === "always"
                ? undefined
                : tSafe(`admin.sliders.schedule.state.${scheduleNow}`, scheduleNow)
            }
            open={openSection === "timing"}
            onToggle={() => toggleSection("timing")}
          >
            <FieldRow label={tSafe("admin.sliders.schedule.title", "Schedule")}>
              {panelButton("schedule", <><CalendarClock className="h-3.5 w-3.5 shrink-0" />
                    {tSafe(`admin.sliders.schedule.state.${scheduleNow}`, scheduleNow)}</>)}
            </FieldRow>
            {active.elements.countdown ? (
              <FieldRow label={tSafe("admin.sliders.timer", "Timer")}>
                {panelButton("timer", <><Timer className="h-3.5 w-3.5 shrink-0" />
                      {active.countdownEndsAt
                        ? tSafe("admin.sliders.stateSet", "Set")
                        : tSafe("admin.sliders.stateNone", "None")}</>)}
              </FieldRow>
            ) : null}
          </InspectorSection>

          {/* The carousel's own settings — the whole slider's, not the
              slide's, which is why they sit apart from everything above. */}
          {singleSlide ? null : (
            <InspectorSection
              title={tSafe("admin.sliders.inspector.carousel", "Carousel")}
              hint={tSafe(
                "admin.sliders.inspector.carouselHint",
                "For the whole slider: how slides change, how long each holds, and the arrows and dots.",
              )}
              open={openSection === "carousel"}
              onToggle={() => toggleSection("carousel")}
            >
              <FieldRow label={tSafe("admin.sliders.transition", "Transition")}>
                <NativeSelect
                  value={slider.transition}
                  onChange={(event) =>
                    updateSlider({
                      transition: event.target.value === "fade" ? "fade" : "slide",
                    })
                  }
                  className="h-8 w-36 rounded-[6px] text-xs"
                  aria-label={tSafe("admin.sliders.transition", "Transition")}
                >
                  <option value="slide">
                    {tSafe("admin.sliders.transitions.slide", "Slide")}
                  </option>
                  <option value="fade">
                    {tSafe("admin.sliders.transitions.fade", "Fade")}
                  </option>
                </NativeSelect>
              </FieldRow>
              {/* How long each slide holds before the next one. */}
              {fieldRow(
                tSafe("admin.sliders.delay", "Delay"),
                slider.autoplaySeconds,
                "s",
                MIN_AUTOPLAY_SECONDS,
                MAX_AUTOPLAY_SECONDS,
                (next) => updateSlider({ autoplaySeconds: next }),
              )}
              <FieldRow label={tSafe("admin.sliders.controls.button", "Controls")}>
                {panelButton("controls", <><SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                      {tSafe("admin.sliders.controls.edit", "Arrows & dots")}</>)}
              </FieldRow>
            </InspectorSection>
          )}
          </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** The inspector's groups, by key; which are open is editor state. */
type InspectorSectionKey = "content" | "media" | "look" | "timing" | "carousel";

/** The settings that open as a panel of their own inside the inspector. */
type InspectorPanelKey =
  | "background"
  | "product"
  | "plate"
  | "animation"
  | "templates"
  | "schedule"
  | "timer"
  | "controls";

/**
 * A setting's own panel, in the inspector's place: the way back and the
 * title in its header, the fields under, sliding in from the right the way
 * a drill-down does. The inspector scrolls, the canvas stays.
 */
function InspectorPanel({
  title,
  backLabel,
  onBack,
  children,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-border bg-card animate-in fade-in-0 slide-in-from-right-2 duration-200">
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          className="grid h-7 w-7 place-items-center rounded-[6px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label={backLabel}
          title={backLabel}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-semibold">{title}</span>
      </div>
      <div className="px-3 py-3">{children}</div>
    </section>
  );
}

/**
 * One group of the inspector: a title that says what it holds, a line on
 * what it is for, and the controls — folded away until wanted, with a
 * badge for the state worth knowing while folded (a schedule that is on).
 */
function InspectorSection({
  title,
  hint,
  badge,
  open,
  onToggle,
  children,
}: {
  title: string;
  hint?: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-left transition hover:bg-accent/50"
      >
        <span className="flex-1 text-xs font-semibold">{title}</span>
        {badge ? (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            {badge}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="space-y-2.5 border-t border-border px-3 py-3">
          {hint ? (
            <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
          ) : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** One inspector row: its name on the left, its control on the right. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </div>
  );
}

/** One element's chip: switched by a click, moved by a drag. */
function ElementChip({
  id,
  on,
  overridden,
  label,
  onToggle,
}: {
  id: SlideElement;
  on: boolean;
  /** This band shows the element differently from landscape. */
  overridden: boolean;
  label: string;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onToggle}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative rounded-[6px] px-2.5 py-1.5 text-xs font-semibold transition",
        on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
        isDragging && "z-10 opacity-80",
      )}
      {...attributes}
      {...listeners}
    >
      {label}
      {overridden ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 ring-2 ring-background"
        />
      ) : null}
    </button>
  );
}

/** Views and click rate, compact. */
function formatStat(stat: { impressions: number; clicks: number }): string {
  const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const rate = stat.impressions > 0 ? (stat.clicks / stat.impressions) * 100 : 0;
  return `${compact.format(stat.impressions)} · ${rate.toFixed(1)}%`;
}

function SlideThumbnail({
  slide,
  selected,
  onSelect,
  onDuplicate,
  onRemove,
  duplicateLabel,
  removeLabel,
  stats,
  statsLabel,
  scheduleBadge,
}: {
  slide: SliderSlide;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  duplicateLabel: string;
  removeLabel: string;
  stats?: { impressions: number; clicks: number };
  statsLabel: string;
  scheduleBadge: string | null;
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
      {scheduleBadge ? (
        <span className="absolute left-1 top-1 z-10 rounded-sm bg-amber-500 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-black">
          {scheduleBadge}
        </span>
      ) : null}
      {stats ? (
        <span
          className="absolute bottom-1 left-1 z-10 rounded-sm bg-background/85 px-1 py-0.5 text-[8px] font-semibold tabular-nums text-foreground"
          title={statsLabel}
        >
          {formatStat(stats)}
        </span>
      ) : null}
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
      {/* Duplicate and remove, revealed on hover so the thumbnail stays a
          picture of the slide until it is being worked on. */}
      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover/thumb:opacity-100">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate();
          }}
          className="grid h-6 w-6 place-items-center rounded-md bg-white/85 text-muted-foreground shadow transition hover:text-foreground"
          aria-label={duplicateLabel}
          title={duplicateLabel}
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="grid h-6 w-6 place-items-center rounded-md bg-white/85 text-muted-foreground shadow transition hover:text-destructive"
          aria-label={removeLabel}
          title={removeLabel}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
