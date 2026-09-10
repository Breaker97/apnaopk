"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  GripVertical,
  History,
  Loader2,
  Monitor,
  PanelRight,
  Plus,
  Smartphone,
  Trash2,
  Undo2,
  UploadCloud,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirmation-dialog";
import { toast } from "@/components/ui/toast-notification";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { apiClient, ApiClientError } from "@/lib/api/client";
import type { DemoModeState } from "@/lib/demo-mode-shared";
import { cn } from "@/lib/utils";
import type { PageSwitcher } from "@/lib/storefront/pages/page-switcher";
import type {
  BlockInstance,
  SectionCatalogEntry,
  SectionInstance,
} from "@/lib/storefront/sections/types";
import {
  MAX_SECTIONS_PER_PAGE,
  VARIANT_FIELD_KEY,
} from "@/lib/storefront/sections/types";
import {
  activeVariantKey,
  fieldsForVariant,
} from "@/lib/storefront/sections/variant-fields";
import {
  PREVIEW_SCROLL_MESSAGE,
  PREVIEW_SELECT_MESSAGE,
} from "@/components/store/section-preview-bridge";
import { BlockEditor } from "./block-editor";
import { SectionPreviewFrame } from "./section-preview-frame";
import { EditorGroup, FieldRenderer, humanize } from "./field-renderer";
import {
  buildInstanceFromCatalog,
  cloneSectionInstance,
} from "./instance-factory";
import { HistoryDialog } from "./history-dialog";
import { SaveSectionDialog } from "./save-section-dialog";
import {
  PageSwitcherSelect,
} from "./page-switcher-select";
import { SectionPickerDialog } from "./section-picker-dialog";
import { BrandListEditor } from "./brand-list-editor";
import { FeaturedCollectionEditor } from "./featured-collection-editor";
import { CountdownOfferEditor } from "./countdown-offer-editor";
import { CategoryListEditor } from "./category-list-editor";
import { ProductMainEditor } from "./product-main-editor";
import { HeroSliderStudio } from "./hero-slider-studio";
import { PromotionBannerStudio } from "./promotion-banner-studio";
import {
  PROMO_GRIDS,
  SLIDER_GRIDS,
  migratePromotionGridV1,
  migrateSlideshowV1,
} from "@/lib/storefront/sections/slider-grids";
import {
  useDraftAutosave,
  type DraftSaveResponse,
  type SaveState,
} from "./use-draft-autosave";

/**
 * The Customize page switcher: templates, landing pages, and the chrome
 * groups (header/footer) all re-route this same builder (`?page=<ref>`).
 */
/**
 * The theme-engine page builder: schema-driven inspectors over a sortable
 * section list, autosaving into the page's DRAFT. Publishing is an explicit
 * act — and for the home page, the first publish is also the moment this
 * document takes over from the legacy settings config on the storefront.
 * Landing pages use the same builder with their handle.
 */

export function StorePageBuilder({
  locale,
  handle,
  heading,
  switcher,
  initialSections,
  initialIsPublished,
  initialHasUnpublishedChanges,
  catalog,
  languages,
  defaultLanguage,
  demoMode,
}: {
  locale: string;
  /** Page ref — "home", "template:<type>", or a landing page handle. */
  handle: string;
  /** Overrides the default "Home Page" heading (landing pages, templates). */
  heading?: string;
  /** Renders the Customize page switcher when provided. */
  switcher?: PageSwitcher;
  initialSections: SectionInstance[];
  initialIsPublished: boolean;
  initialHasUnpublishedChanges: boolean;
  catalog: SectionCatalogEntry[];
  languages: string[];
  defaultLanguage: string;
  /**
   * On a demo deployment every edit here stays in the browser: the server
   * refuses the writes, so the builder must not pretend otherwise.
   */
  demoMode: DemoModeState;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);

  const isHome = handle === "home";
  const isGroup = handle.startsWith("group:");
  const isTemplate = isHome || handle.startsWith("template:");

  /**
   * Every call that would reach the database goes through this first. It
   * returns true when the caller must stop — the server would refuse anyway,
   * and saying so up front beats a failed request the visitor has to decode.
   */
  const refusedByDemo = () => {
    if (!demoMode.enabled) return false;
    toast.info(demoMode.message);
    return true;
  };

  const [sections, setSections] = useState(initialSections);
  const isPageFull = sections.length >= MAX_SECTIONS_PER_PAGE;
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(
    initialHasUnpublishedChanges,
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Where the picker inserts: set by the divider that opened it. Null means
  // append (the always-visible bottom divider).
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    "publish" | "discard" | null
  >(null);
  const [busyAction, setBusyAction] = useState<"publish" | "discard" | null>(
    null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveToLibrary, setSaveToLibrary] = useState<SectionInstance | null>(
    null,
  );
  const previewFrame = useRef<HTMLIFrameElement | null>(null);

  const catalogByType = useMemo(
    () => new Map(catalog.map((entry) => [entry.type, entry])),
    [catalog],
  );

  // ---- draft autosave -----------------------------------------------------
  // The serial save pipeline (debounce, coalescing, abort, unload flush)
  // lives in its own hook so its concurrency rules are unit-testable.
  const { saveState, flush, adoptServerSections } = useDraftAutosave({
    handle,
    sections,
    onSaved: (result) => {
      setIsPublished(result.isPublished);
      setHasUnpublishedChanges(result.hasUnpublishedChanges);
      // The embedded preview shows the draft — refresh it on every save.
      setPreviewNonce((nonce) => nonce + 1);
    },
    onError: (message) => toast.error(message),
    fallbackErrorMessage: tSafe(
      "admin.storeBuilder.saveFailed",
      "Saving the draft failed",
    ),
    disabled: demoMode.enabled,
  });

  // ---- embedded preview ---------------------------------------------------
  // The iframe hits the preview route (sets the draft cookie, redirects to
  // the page); the bridge on the storefront side posts clicks back here.
  const previewSrc = `/api/admin/store-pages/preview?locale=${locale}&handle=${handle}&r=${previewNonce}`;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; id?: string } | null;
      if (data?.type !== PREVIEW_SELECT_MESSAGE || !data.id) return;
      setExpandedId(data.id);
      document
        .getElementById(`section-row-${data.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const selectSection = (id: string | null) => {
    setExpandedId(id);
    if (id && previewOpen) {
      previewFrame.current?.contentWindow?.postMessage(
        { type: PREVIEW_SCROLL_MESSAGE, id },
        window.location.origin,
      );
    }
  };

  // Preview is a URL (/draft/…), not a browser state — closing the panel
  // has nothing to clean up.
  const closePreview = () => setPreviewOpen(false);

  /**
   * The storefront's own render of one section, at the top of its editor.
   * Only where it says something: a spacer has nothing to show, a chrome
   * group previews as a whole (header and footer draw around the page, not
   * in it), and the studios with a canvas of their own already show theirs.
   */
  const sectionPreview = (section: SectionInstance) => {
    if (isGroup || section.type === "gap") return null;
    return (
      <SectionPreviewFrame
        locale={locale}
        handle={handle}
        sectionId={section.id}
        nonce={previewNonce}
        title={tSafe("admin.storeBuilder.sectionEditor.preview", "Preview")}
        hint={
          // Demo deployments never save, so the frame can never refresh —
          // "updates after each save" would be a promise the build cannot
          // keep, and every edit would look like a broken preview.
          demoMode.enabled
            ? tSafe(
                "admin.storeBuilder.sectionEditor.previewDemoHint",
                "The storefront's render. Edits will not appear here: this demo store never saves.",
              )
            : tSafe(
                "admin.storeBuilder.sectionEditor.previewHint",
                "The storefront's render, with your live data. Updates after each save.",
              )
        }
        emptyLabel={tSafe(
          "admin.storeBuilder.sectionEditor.previewEmpty",
          "Nothing to show yet — this section renders once it has content or data.",
        )}
      />
    );
  };

  /**
   * The same frame, narrowed to ONE block of a section — what a block list
   * shows beside each row so a merchant sees that row alone.
   */
  const blockPreview = (section: SectionInstance, blockId: string) => {
    if (isGroup || section.type === "gap") return null;
    return (
      <SectionPreviewFrame
        locale={locale}
        handle={handle}
        sectionId={section.id}
        blockId={blockId}
        nonce={previewNonce}
        title={tSafe("admin.storeBuilder.sectionEditor.rowPreview", "Row preview")}
        emptyLabel={tSafe(
          "admin.storeBuilder.sectionEditor.previewEmpty",
          "Nothing to show yet — this section renders once it has content or data.",
        )}
      />
    );
  };

  // ---- section operations -------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSections((current) => {
      const from = current.findIndex((section) => section.id === active.id);
      const to = current.findIndex((section) => section.id === over.id);
      if (from < 0 || to < 0) return current;
      return arrayMove(current, from, to);
    });
  };

  const openPickerAt = (index: number | null) => {
    setInsertIndex(index);
    setPickerOpen(true);
  };

  const insertInstance = (instance: SectionInstance) => {
    setSections((current) => {
      const at =
        insertIndex === null
          ? current.length
          : Math.min(insertIndex, current.length);
      const next = [...current];
      next.splice(at, 0, instance);
      return next;
    });
    setExpandedId(instance.id);
  };

  const updateSection = (id: string, patch: Partial<SectionInstance>) => {
    setSections((current) =>
      current.map((section) =>
        section.id === id ? { ...section, ...patch } : section,
      ),
    );
  };

  // Field edits merge against CURRENT state, never a render closure. TipTap
  // fires its first onUpdate from a stale render (useEditor captures the
  // callback at creation), and a closure-spread merge there wiped sibling
  // fields — the heading you just typed, erased by the body editor mounting.
  const updateSectionSetting = (id: string, key: string, value: unknown) => {
    setSections((current) =>
      current.map((section) =>
        section.id === id
          ? { ...section, settings: { ...section.settings, [key]: value } }
          : section,
      ),
    );
  };

  const updateSectionBlocks = (
    id: string,
    updater: (blocks: BlockInstance[]) => BlockInstance[],
  ) => {
    setSections((current) =>
      current.map((section) =>
        section.id === id
          ? { ...section, blocks: updater(section.blocks ?? []) }
          : section,
      ),
    );
  };

  const runLifecycle = async (action: "publish" | "discard") => {
    if (refusedByDemo()) return;
    setBusyAction(action);
    try {
      // Flush any pending edit first so the action sees the latest draft —
      // and ABORT if it cannot be flushed: publishing a stale server draft
      // while the builder shows newer content would be a silent lie.
      const flushed = await flush();
      if (!flushed) return; // the hook already reported the failure

      if (action === "publish") {
        const result = await apiClient.post<DraftSaveResponse>(
          `/api/admin/store-pages/${handle}/publish`,
        );
        setIsPublished(true);
        setHasUnpublishedChanges(result.hasUnpublishedChanges);
        toast.success(
          tSafe("admin.storeBuilder.published", "Home page published"),
        );
      } else {
        const result = await apiClient.post<
          DraftSaveResponse & { sections: SectionInstance[] }
        >(`/api/admin/store-pages/${handle}/discard`);
        adoptServerSections(); // restoring is not a new edit
        setSections(result.sections);
        setHasUnpublishedChanges(false);
        toast.success(
          tSafe("admin.storeBuilder.discarded", "Draft restored to published"),
        );
      }
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : tSafe("admin.storeBuilder.actionFailed", "The action failed"),
      );
    } finally {
      setBusyAction(null);
    }
  };

  // Publish the sticky page bar's height so section headers stick under it.
  const pageBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = pageBarRef.current;
    const root = bar?.parentElement;
    if (!bar || !root) return;
    const publish = () =>
      root.style.setProperty(
        "--builder-bar-h",
        `${Math.round(bar.getBoundingClientRect().height)}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // ---- render -------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* The page bar — title left, page switcher / save state / preview /
          discard / publish right — one compact row pinned under the
          dashboard header; its measured height feeds the section headers
          so they stack beneath it. */}
      <div
        ref={pageBarRef}
        className="sticky top-[var(--dashboard-header-height,4rem)] z-30 -mx-6 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-6 py-2"
      >
        {/* The heading IS the page switcher: one name for the page, and
            picking another name is how you go there. */}
        {switcher ? (
          <PageSwitcherSelect
            switcher={switcher}
            locale={locale}
            variant="title"
            className="max-w-[60vw] sm:max-w-none"
          />
        ) : (
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {heading ?? tSafe("admin.storeBuilder.title", "Home Page")}
          </h1>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <SaveStateBadge state={saveState} tSafe={tSafe} />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={tSafe("admin.storeBuilder.history", "Version history")}
            onClick={() => setHistoryOpen(true)}
          >
            <History className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={previewOpen ? "secondary" : "outline"}
            className="hidden gap-1.5 xl:inline-flex"
            onClick={() =>
              previewOpen ? closePreview() : setPreviewOpen(true)
            }
          >
            <PanelRight className="h-4 w-4" />
            {tSafe("admin.storeBuilder.livePreview", "Live preview")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              window.open(
                `/api/admin/store-pages/preview?locale=${locale}&handle=${handle}`,
                "_blank",
                "noopener",
              )
            }
          >
            <ExternalLink className="h-4 w-4" />
            {tSafe("admin.storeBuilder.preview", "Preview")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            // Demo keeps both buttons live even with nothing to publish:
            // greyed-out controls read as a broken page, whereas a click that
            // explains itself is the point of the demo.
            disabled={
              busyAction !== null ||
              (!demoMode.enabled && (!isPublished || !hasUnpublishedChanges))
            }
            onClick={() => {
              if (refusedByDemo()) return;
              setConfirmAction("discard");
            }}
          >
            <Undo2 className="h-4 w-4" />
            {tSafe("admin.storeBuilder.discard", "Discard")}
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            disabled={
              busyAction !== null ||
              (!demoMode.enabled && isPublished && !hasUnpublishedChanges)
            }
            onClick={() => {
              if (refusedByDemo()) return;
              setConfirmAction("publish");
            }}
          >
            {busyAction === "publish" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            {tSafe("admin.storeBuilder.publish", "Publish")}
          </Button>
        </div>
      </div>

      {demoMode.enabled ? (
        <div className="flex items-start gap-2 rounded-md border border-blue-300/60 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900 dark:border-blue-500/30 dark:bg-blue-950/40 dark:text-blue-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {demoMode.message}
        </div>
      ) : null}

      {!isPublished ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {isHome
            ? tSafe(
                "admin.storeBuilder.cutoverNote",
                "The storefront still shows the previous home page configuration. Your first publish switches it to this builder for good.",
              )
            : isGroup
              ? tSafe(
                  "admin.storeBuilder.groupCutoverNote",
                  "The storefront renders the standard header and footer until your first publish switches this group to the builder for good.",
                )
              : isTemplate
                ? tSafe(
                    "admin.storeBuilder.templateCutoverNote",
                    "The storefront renders the built-in default template until your first publish switches it to this builder for good.",
                  )
                : tSafe(
                    "admin.storeBuilder.landingUnpublishedNote",
                    "This page is not live yet. Publish it to put it at /pages/{handle}.",
                    { handle },
                  )}
        </div>
      ) : hasUnpublishedChanges ? (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {tSafe(
            "admin.storeBuilder.unpublishedNote",
            "You have unpublished changes. Shoppers keep seeing the last published version until you publish.",
          )}
        </div>
      ) : null}

      <div
        className={cn(
          previewOpen &&
            "xl:grid xl:grid-cols-[minmax(400px,34rem)_1fr] xl:items-start xl:gap-5",
        )}
      >
        <div className="space-y-4">
      {/* Pinned id: dnd-kit's useUniqueId is a module-level counter, so an
          SSR'd context without one hydrates with a mismatched
          aria-describedby (the bug the previous builder pinned its id for). */}
      <DndContext
        id={`store-page-builder-${handle}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sections.map((section) => section.id)}
          strategy={verticalListSortingStrategy}
        >
          <div>
            {sections.map((section, index) => {
              const entry = catalogByType.get(section.type);
              return (
                <Fragment key={section.id}>
                <SortableSectionRow
                  section={section}
                  entry={entry}
                  expanded={expandedId === section.id}
                  tSafe={tSafe}
                  onToggleExpanded={() =>
                    selectSection(
                      expandedId === section.id ? null : section.id,
                    )
                  }
                  onSaveToLibrary={() => setSaveToLibrary(section)}
                  onToggleVisible={() =>
                    updateSection(section.id, { visible: !section.visible })
                  }
                  onRemove={() =>
                    setSections((current) =>
                      current.filter(
                        (candidate) => candidate.id !== section.id,
                      ),
                    )
                  }
                >
                  {entry?.type === "header-bar" ||
                  entry?.type === "footer-bar" ? (
                    /* The bars' own settings (layout, colors, menus, widgets)
                       stay with the classic forms — deep-link instead of
                       duplicating that UI here. */
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {tSafe(
                          "admin.storeBuilder.chromeCoreHint",
                          "This section's layout, colors, and menus are managed in its settings form.",
                        )}
                      </p>
                      <Button asChild type="button" variant="outline" className="gap-1.5">
                        <a
                          href={`/${locale}/admin/online-store/menus/${entry.type === "header-bar" ? "header" : "footer"}`}
                        >
                          <ExternalLink className="h-4 w-4" />
                          {entry.type === "header-bar"
                            ? tSafe(
                                "admin.storeBuilder.openHeaderSettings",
                                "Open header settings",
                              )
                            : tSafe(
                                "admin.storeBuilder.openFooterSettings",
                                "Open footer settings",
                              )}
                        </a>
                      </Button>
                    </div>
                  ) : entry?.type === "brand-list" ? (
                    /* The Figma "Brands" panel: Template dropdown + compact
                       brand rows — not the generic variant/block inspector. */
                    <BrandListEditor
                      entry={entry}
                      sectionId={section.id}
                      settings={section.settings}
                      blocks={section.blocks ?? []}
                      onSettingChange={(key, value) =>
                        updateSectionSetting(section.id, key, value)
                      }
                      onBlocksChange={(updater) =>
                        updateSectionBlocks(section.id, updater)
                      }
                      locale={locale}
                    />
                  ) : entry?.type === "category-list" ? (
                    /* Template button + real storefront preview instead of
                       the inline design thumbnails and locale tab strip. */
                    <CategoryListEditor
                      entry={entry}
                      settings={section.settings}
                      onSettingChange={(key, value) =>
                        updateSectionSetting(section.id, key, value)
                      }
                      locale={locale}
                      defaultLanguage={defaultLanguage}
                    />
                  ) : entry?.type === "product-main" ? (
                    /* Gallery-layout tiles, the grouped "Order" row editor,
                       and the Visibility + Style panels. The buy-box design
                       follows the active theme — no template picker. */
                    <div className="space-y-5">
                      {sectionPreview(section)}
                      <ProductMainEditor
                        settings={section.settings}
                        onSettingChange={(key, value) =>
                          updateSectionSetting(section.id, key, value)
                        }
                      />
                    </div>
                  ) : entry?.type === "featured-collection" ? (
                    /* Title + collection rows: each row labeled with its
                       picked collection's name, and the feature slot takes
                       an image or a saved slider through one dialog. */
                    <div className="space-y-5">
                    {/* No section preview: every row previews itself under
                        its own fields, and a stack of all of them on top is
                        the same content twice. */}
                    <FeaturedCollectionEditor
                      entry={entry}
                      sectionId={section.id}
                      settings={section.settings}
                      blocks={section.blocks ?? []}
                      onSettingChange={(key, value) =>
                        updateSectionSetting(section.id, key, value)
                      }
                      onBlocksChange={(updater) =>
                        updateSectionBlocks(section.id, updater)
                      }
                      locale={locale}
                      languages={languages}
                      defaultLanguage={defaultLanguage}
                      renderBlockPreview={(blockId) =>
                        blockPreview(section, blockId)
                      }
                    />
                    </div>
                  ) : entry?.type === "countdown-offer" ? (
                    /* Layout tiles, then copy and paint, then the deals —
                       a picker that offers only products on sale, capped
                       at the layout's slot count. */
                    <div className="space-y-5">
                      {sectionPreview(section)}
                      <CountdownOfferEditor
                        entry={entry}
                        variant={activeVariantKey(entry, section.settings)}
                        settings={section.settings}
                        onSettingChange={(key, value) =>
                          updateSectionSetting(section.id, key, value)
                        }
                        languages={languages}
                        defaultLanguage={defaultLanguage}
                        locale={locale}
                        sectionId={section.id}
                      />
                    </div>
                  ) : entry?.type === "promotion-banner" ? (
                    /* The full slider editor, inline — the banner's slides
                       live in THIS section's settings, not the global
                       slider library. */
                    <PromotionBannerStudio
                      settings={section.settings}
                      onSettingChange={(key, value) =>
                        updateSectionSetting(section.id, key, value)
                      }
                      locale={locale}
                      defaultLanguage={defaultLanguage}
                    />
                  ) : entry?.type === "slideshow" ||
                    entry?.type === "promotion-grid" ? (
                    // Both are grids of cells, so both use the same studio —
                    // only the grid list and the migration differ.
                    <HeroSliderStudio
                      sectionId={section.id}
                      sectionType={entry.type}
                      grids={
                        entry.type === "promotion-grid"
                          ? PROMO_GRIDS
                          : SLIDER_GRIDS
                      }
                      migrate={
                        entry.type === "promotion-grid"
                          ? migratePromotionGridV1
                          : migrateSlideshowV1
                      }
                      settings={section.settings}
                      blocks={section.blocks ?? []}
                      onSettingChange={(key, value) =>
                        updateSectionSetting(section.id, key, value)
                      }
                      onBlocksChange={(updater) =>
                        updateSectionBlocks(section.id, updater)
                      }
                      locale={locale}
                    />
                  ) : entry ? (
                    <div className="space-y-5">
                      {sectionPreview(section)}
                      {/* The design (variant) picker is hidden for now —
                          stored variants still render and still gate which
                          fields appear below; only the switcher UI is gone. */}
                      {/* Fields the chosen design ignores are hidden, not
                          disabled — a control that changes nothing reads as
                          broken. Their stored values stay put. */}
                      {fieldsForVariant(
                        entry.fields.filter(
                          (field) => field.key !== VARIANT_FIELD_KEY,
                        ),
                        activeVariantKey(entry, section.settings),
                      ).length > 0 ? (
                        <EditorGroup
                          title={tSafe(
                            "admin.storeBuilder.sectionEditor.settings",
                            "Settings",
                          )}
                        >
                          <FieldRenderer
                            fields={fieldsForVariant(
                              entry.fields.filter(
                                (field) => field.key !== VARIANT_FIELD_KEY,
                              ),
                              activeVariantKey(entry, section.settings),
                            )}
                            settings={section.settings}
                            onChange={(key, value) =>
                              updateSectionSetting(section.id, key, value)
                            }
                            languages={languages}
                            defaultLanguage={defaultLanguage}
                            imageContext={{
                              locale,
                              sectionType: section.type,
                              sectionId: section.id,
                            }}
                          />
                        </EditorGroup>
                      ) : null}
                      {entry.blocks.length > 0 ? (
                        <EditorGroup
                          title={tSafe(
                            `admin.storeBuilder.blockGroups.${entry.blocks[0].type}`,
                            `${humanize(entry.blocks[0].type)}s`,
                          )}
                          count={(section.blocks ?? []).length}
                          hint={tSafe(
                            "admin.storeBuilder.sectionEditor.blocksHint",
                            "Drag to reorder. Open a row to edit it.",
                          )}
                        >
                          <BlockEditor
                            entry={entry}
                            variant={activeVariantKey(entry, section.settings)}
                            sectionId={section.id}
                            blocks={section.blocks ?? []}
                            onChange={(updater) =>
                              updateSectionBlocks(section.id, updater)
                            }
                            languages={languages}
                            defaultLanguage={defaultLanguage}
                            locale={locale}
                          />
                        </EditorGroup>
                      ) : null}
                    </div>
                  ) : null}
                </SortableSectionRow>
                  {/* Insert point between two sections — invisible until the
                      merchant hovers the gap. The gap itself doubles as the
                      breathing room between cards. */}
                  {index < sections.length - 1 ? (
                    <AddBlockDivider
                      label={tSafe("admin.storeBuilder.addBlockCta", "Add Block")}
                      onClick={() => openPickerAt(index + 1)}
                      disabled={isPageFull}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* The cap is a WRITE rule (write.ts), so it has to hold here too —
          otherwise the 26th section is accepted by the editor and refused by
          the autosave, and the merchant meets the limit as a failed save
          with their work apparently at risk. The Electronics starter is 17
          sections deep, so this is eight additions away, not theoretical. */}
      <AddBlockDivider
        alwaysVisible
        label={tSafe("admin.storeBuilder.addBlockCta", "Add Block")}
        onClick={() => openPickerAt(null)}
        disabled={isPageFull}
      />
      {isPageFull ? (
        <p className="text-center text-xs text-muted-foreground">
          {tSafe(
            "admin.storeBuilder.pageFull",
            "This page is full — remove a section to add another.",
          )}
        </p>
      ) : null}
        </div>

        {previewOpen ? (
          <div className="sticky top-4 hidden xl:block">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  {tSafe("admin.storeBuilder.livePreview", "Live preview")}
                </span>
                <div className="flex items-center gap-1">
                  {(
                    [
                      { key: "desktop", icon: Monitor },
                      { key: "mobile", icon: Smartphone },
                    ] as const
                  ).map(({ key, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={previewDevice === key}
                      onClick={() => setPreviewDevice(key)}
                      className={cn(
                        "rounded p-1.5 transition-colors",
                        previewDevice === key
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-center bg-muted/40">
                <iframe
                  ref={previewFrame}
                  key={previewNonce}
                  src={previewSrc}
                  title={tSafe("admin.storeBuilder.livePreview", "Live preview")}
                  className={cn(
                    "h-[calc(100vh-9rem)] border-0 bg-background transition-[width]",
                    previewDevice === "mobile" ? "w-[390px]" : "w-full",
                  )}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <SectionPickerDialog
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setInsertIndex(null);
        }}
        catalog={catalog}
        existingTypes={sections.map((section) => section.type)}
        onPick={(entry, settingsOverride) => {
          const instance = buildInstanceFromCatalog(entry);
          if (settingsOverride) {
            // The Hero Slider wizard's grid/width/height choices ride along.
            instance.settings = { ...instance.settings, ...settingsOverride };
          }
          insertInstance(instance);
        }}
        onPickSaved={(section) => {
          insertInstance(cloneSectionInstance(section));
        }}
        onDeleteRefused={refusedByDemo}
      />

      <SaveSectionDialog
        section={saveToLibrary}
        onOpenChange={(open) => {
          if (!open) setSaveToLibrary(null);
        }}
        tSafe={tSafe}
        onSaveRefused={refusedByDemo}
      />

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        handle={handle}
        tSafe={tSafe}
        onRestore={(restored) => {
          setSections(restored);
          setExpandedId(null);
          setHistoryOpen(false);
          toast.success(
            tSafe(
              "admin.storeBuilder.restoredToDraft",
              "Version restored to the draft — review it, then publish.",
            ),
          );
        }}
      />

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction === "discard"
            ? tSafe("admin.storeBuilder.discardTitle", "Discard draft changes?")
            : isHome
              ? tSafe("admin.storeBuilder.publishTitle", "Publish home page?")
              : tSafe(
                  "admin.storeBuilder.publishPageTitle",
                  "Publish this page?",
                )
        }
        description={
          confirmAction === "discard"
            ? tSafe(
                "admin.storeBuilder.discardDescription",
                "Your draft goes back to the last published version. This cannot be undone.",
              )
            : tSafe(
                "admin.storeBuilder.publishDescription",
                "The current draft replaces what shoppers see on the storefront.",
              )
        }
        confirmText={
          confirmAction === "discard"
            ? tSafe("admin.storeBuilder.discard", "Discard")
            : tSafe("admin.storeBuilder.publish", "Publish")
        }
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (action) void runLifecycle(action);
        }}
      />
    </div>
  );
}

/**
 * The blue "Add Block" capsule over a full-width rule. Between sections the
 * strip is a slim 10px — the actual breathing room between cards — and the
 * capsule OVERLAPS the neighbouring cards when it appears (the whole zone,
 * capsule included, is invisible until hovered but still catches the
 * pointer, so the seam itself is the hot zone). The bottom instance is
 * always shown at full height.
 */
function AddBlockDivider({
  label,
  onClick,
  disabled,
  alwaysVisible = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  alwaysVisible?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center",
        // z-20 lifts the overflowing capsule above BOTH neighbouring cards —
        // the one after this divider paints later in the DOM and would
        // otherwise cover the capsule's bottom half.
        alwaysVisible ? "h-12" : "z-20 h-2.5",
        !alwaysVisible &&
          "opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-primary"
      />
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="relative z-10 inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {label}
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function SaveStateBadge({
  state,
  tSafe,
}: {
  state: SaveState;
  tSafe: ReturnType<typeof createTSafe>;
}) {
  if (state === "idle") return null;
  const map = {
    dirty: {
      icon: Loader2,
      spin: false,
      label: tSafe("admin.storeBuilder.pending", "Unsaved…"),
    },
    saving: {
      icon: Loader2,
      spin: true,
      label: tSafe("admin.storeBuilder.saving", "Saving…"),
    },
    saved: {
      icon: CheckCircle2,
      spin: false,
      label: tSafe("admin.storeBuilder.saved", "Draft saved"),
    },
    error: {
      icon: AlertCircle,
      spin: false,
      label: tSafe("admin.storeBuilder.saveFailed", "Saving the draft failed"),
    },
  }[state];
  const Icon = map.icon;
  return (
    <Badge
      variant={state === "error" ? "destructive" : "secondary"}
      className="gap-1.5 rounded-md px-2.5 py-1"
    >
      <Icon className={cn("h-3.5 w-3.5", map.spin && "animate-spin")} />
      {map.label}
    </Badge>
  );
}

function SortableSectionRow({
  section,
  entry,
  expanded,
  tSafe,
  onToggleExpanded,
  onToggleVisible,
  onRemove,
  onSaveToLibrary,
  children,
}: {
  section: SectionInstance;
  entry: SectionCatalogEntry | undefined;
  expanded: boolean;
  tSafe: ReturnType<typeof createTSafe>;
  onToggleExpanded: () => void;
  onToggleVisible: () => void;
  onRemove: () => void;
  onSaveToLibrary: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });

  const name = entry
    ? tSafe(`admin.storeBuilder.sections.${entry.type}.name`, entry.name)
    : section.type;
  const description = entry
    ? tSafe(
        `admin.storeBuilder.sections.${entry.type}.description`,
        entry.description,
      )
    : tSafe(
        "admin.storeBuilder.unknownSection",
        "This section type is not in the current catalog.",
      );

  return (
    <Card
      ref={setNodeRef}
      id={`section-row-${section.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "gap-0 rounded-md p-0",
        isDragging && "z-10 shadow-lg",
        !section.visible && "opacity-60",
      )}
    >
      {/* An expanded section can run several screens of settings; its
          title, collapse chevron and actions stay pinned under the dashboard
          header so the merchant always knows what they are editing and can
          fold or delete it without scrolling back up. */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-4 py-3.5",
          expanded &&
            entry &&
            "sticky top-[calc(var(--dashboard-header-height,4rem)+var(--builder-bar-h,0px))] z-20 rounded-t-md border-b border-border bg-card",
        )}
      >
        <button
          type="button"
          className="cursor-grab touch-none p-1 text-muted-foreground"
          {...attributes}
          {...listeners}
          aria-label="Reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          disabled={!entry}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {description}
            </span>
          </span>
          {entry ? (
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          ) : null}
        </button>

        {entry?.locked ? (
          <Badge variant="outline" className="hidden rounded-md sm:inline-flex">
            {tSafe("admin.storeBuilder.requiredSection", "Required")}
          </Badge>
        ) : entry?.singleton ? (
          <Badge variant="outline" className="hidden rounded-md sm:inline-flex">
            {tSafe("admin.storeBuilder.singleton", "Single use")}
          </Badge>
        ) : null}

        {/* Core sections stay: no library copies, no visibility toggle, no
            delete — the write gate refuses all three server-side anyway. */}
        {!entry?.locked ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={onSaveToLibrary}
            aria-label={tSafe("admin.storeBuilder.saveToLibrary", "Save to library")}
          >
            <Bookmark className="h-4 w-4" />
          </Button>
        ) : null}
        {!entry?.locked ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={onToggleVisible}
            aria-label={tSafe("admin.storeBuilder.toggleVisibility", "Toggle visibility")}
          >
            {section.visible ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </Button>
        ) : null}
        {!entry?.locked ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
            onClick={onRemove}
            aria-label={tSafe("admin.storeBuilder.removeSection", "Remove section")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {expanded && entry ? (
        <div className="p-4">{children}</div>
      ) : null}
    </Card>
  );
}
