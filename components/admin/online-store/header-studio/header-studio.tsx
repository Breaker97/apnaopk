"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RotateCcw } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast-notification";
import {
  createHeaderItem,
  findHeaderItem,
  visibleColumns,
  type HeaderItemType,
  type HeaderLayout,
  type HeaderLayoutItem,
} from "@/lib/site-config/header-layout";
import { getDefaultHeaderLayout } from "@/lib/site-config/header-layout-default";
import {
  normalizeHeaderSettings,
  type HeaderSettings,
} from "@/lib/site-config/header-config";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import {
  readAnnouncement,
  writeAnnouncement,
  type AnnouncementDraft,
} from "@/components/admin/online-store/header-chrome-state";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { HeaderStudioSkeleton } from "@/components/admin/online-store/online-store-skeletons";
import { ItemDrawer } from "@/components/admin/online-store/header-studio/item-drawer";
import { StudioCanvas } from "@/components/admin/online-store/header-studio/canvas";
import {
  PropertyPanel,
  type StudioSelection,
} from "@/components/admin/online-store/header-studio/property-panel";
import { NavLinksModal } from "@/components/admin/online-store/header-studio/nav-links-modal";
import { TemplateDialog } from "@/components/admin/online-store/header-studio/template-dialog";
import {
  HeaderStudioPreview,
  type PreviewBrand,
} from "@/components/admin/online-store/header-studio/header-studio-preview";
import {
  addRow,
  findColumn,
  insertItem,
  moveItem,
  moveRow,
  patchColumn,
  patchItem,
  patchRow,
  removeItem,
  removeRow,
} from "@/components/admin/online-store/header-studio/mutations";
import { cn } from "@/lib/utils";
import {
  STUDIO_CONTROL_RADIUS,
  itemMeta,
} from "@/components/admin/online-store/header-studio/layout-style";

interface HeaderStudioProps {
  /**
   * The header group's draft sections. The announcement bar and top tags
   * live here, not in the header settings, and go live through the group's
   * own draft → publish gate.
   */
  initialChromeSections: SectionInstance[];
}

interface SettingsPayload {
  success?: boolean;
  data?: {
    header?: unknown;
    general?: Record<string, unknown>;
  };
}

type DragData =
  | { kind: "new"; itemType: HeaderItemType }
  | { kind: "item"; itemId: string; columnId: string }
  | { kind: "column"; columnId: string }
  | { kind: "row" };

/**
 * Only a row can land on a row, and only an item can land in a column —
 * without this filter the row's own sortable droppable, which wraps every
 * column, wins the closest-centre test and items never reach a column.
 *
 * Items then land ONLY under the pointer. Closest-centre would drop an item
 * into whichever column happened to be nearest, so releasing over the page
 * margin flung it into a column the merchant never pointed at. Rows keep
 * closest-centre: a row drag is a reorder along one axis, where snapping to
 * the nearest neighbour is the point. Keyboard dragging has no pointer, so
 * it falls back rather than becoming impossible.
 */
const collisionDetection: CollisionDetection = (args) => {
  const activeKind = (args.active.data.current as DragData | undefined)?.kind;
  const droppableContainers = args.droppableContainers.filter((container) => {
    const kind = (container.data.current as DragData | undefined)?.kind;
    return activeKind === "row"
      ? kind === "row"
      : kind === "column" || kind === "item";
  });
  if (activeKind !== "row" && args.pointerCoordinates) {
    return pointerWithin({ ...args, droppableContainers });
  }
  return closestCenter({ ...args, droppableContainers });
};

export function HeaderStudio({ initialChromeSections }: HeaderStudioProps) {
  const t = useTranslations();
  // Memoised on `t`: the load effect depends on it, and a fresh closure per
  // render would refetch the settings forever.
  const tSafe = useMemo(() => createTSafe(t), [t]);

  const [header, setHeader] = useState<HeaderSettings | null>(null);
  const [initialHeader, setInitialHeader] = useState<HeaderSettings | null>(
    null,
  );
  const [brand, setBrand] = useState<PreviewBrand>({
    storeName: "",
    logoUrl: "",
    darkLogoUrl: "",
  });
  const [defaultLanguage, setDefaultLanguage] = useState("en");
  const [chromeSections, setChromeSections] = useState<SectionInstance[]>(
    initialChromeSections,
  );
  const [initialChrome, setInitialChrome] = useState<SectionInstance[]>(
    initialChromeSections,
  );
  const [selection, setSelection] = useState<StudioSelection>(null);
  const [linksItemId, setLinksItemId] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Whether the preview is pinned. A sentinel sits just above it in the
  // flow: while the two are touching the preview is in its own place, and
  // once the sentinel has scrolled above the preview's sticky top the
  // preview has stuck. Read on scroll rather than from an observer because
  // the pinned position is a CSS variable this code should not have to
  // convert.
  const previewSentinel = useRef<HTMLDivElement | null>(null);
  const previewSection = useRef<HTMLElement | null>(null);
  const [previewStuck, setPreviewStuck] = useState(false);
  useEffect(() => {
    let frame = 0;
    // Sticking SHRINKS the bar (the title row goes), which shortens the page
    // and moves the very gap this reads. A single threshold therefore
    // oscillates on the spot: stuck → shorter → unstuck → taller → stuck.
    // Two thresholds and a settle window break that loop — the bar has to
    // travel a real distance to change state, and its own reflow is ignored.
    const STICK_AT = 6;
    const RELEASE_AT = 1;
    let settleUntil = 0;
    const update = () => {
      frame = 0;
      const sentinel = previewSentinel.current;
      const section = previewSection.current;
      if (!sentinel || !section) return;
      if (performance.now() < settleUntil) return;
      const gap =
        section.getBoundingClientRect().top -
        sentinel.getBoundingClientRect().bottom;
      setPreviewStuck((current) => {
        const next = current ? gap > RELEASE_AT : gap > STICK_AT;
        if (next !== current) settleUntil = performance.now() + 250;
        return next;
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [isLoading]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/admin/settings", { method: "GET" });
        const payload = (await response.json()) as SettingsPayload;
        if (!response.ok || payload.success !== true) throw new Error("failed");

        const parsed = normalizeHeaderSettings(payload.data?.header);
        const general = payload.data?.general;
        setHeader(parsed);
        setInitialHeader(parsed);
        setBrand({
          storeName:
            typeof general?.storeName === "string"
              ? general.storeName.trim()
              : "",
          logoUrl:
            typeof general?.logoUrl === "string" ? general.logoUrl.trim() : "",
          darkLogoUrl:
            typeof general?.darkModeLogoUrl === "string"
              ? general.darkModeLogoUrl.trim()
              : "",
        });
        if (
          typeof general?.defaultLanguage === "string" &&
          general.defaultLanguage.trim()
        ) {
          setDefaultLanguage(general.defaultLanguage.trim().toLowerCase());
        }
      } catch {
        toast.error(
          tSafe(
            "admin.headerStudio.toast.loadFailed",
            "Could not load the header settings",
          ),
        );
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [tSafe]);

  const layout = header?.builder ?? null;

  const announcement = useMemo(
    () => readAnnouncement(chromeSections, defaultLanguage),
    [chromeSections, defaultLanguage],
  );

  const patchAnnouncement = (patch: Partial<AnnouncementDraft>) => {
    setChromeSections((prev) =>
      writeAnnouncement(
        prev,
        { ...readAnnouncement(prev, defaultLanguage), ...patch },
        defaultLanguage,
      ),
    );
  };

  const isHeaderDirty = useMemo(
    () =>
      header !== null &&
      initialHeader !== null &&
      JSON.stringify(header) !== JSON.stringify(initialHeader),
    [header, initialHeader],
  );
  const isChromeDirty = useMemo(
    () => JSON.stringify(chromeSections) !== JSON.stringify(initialChrome),
    [chromeSections, initialChrome],
  );
  const isDirty = isHeaderDirty || isChromeDirty;

  const setLayout = (next: HeaderLayout) => {
    setHeader((prev) => (prev ? { ...prev, builder: next } : prev));
  };

  // The one switch behind every shopper-location surface: the header's
  // "Deliver to", the listing sidebars' Location group, the nearest-first
  // collection points at checkout. It lives on the header settings for
  // historical reasons and is edited here because this is where a merchant
  // sees the header change.
  const setShowLocation = (showLocationPicker: boolean) => {
    setHeader((prev) =>
      prev
        ? { ...prev, widgets: { ...prev.widgets, showLocationPicker } }
        : prev,
    );
  };

  const selected = useMemo(() => {
    if (!layout || !selection) {
      return { row: null, column: null, item: null };
    }
    if (selection.kind === "row") {
      return {
        row: layout.rows.find((row) => row.id === selection.rowId) ?? null,
        column: null,
        item: null,
      };
    }
    if (selection.kind === "column") {
      return {
        row: layout.rows.find((row) => row.id === selection.rowId) ?? null,
        column: findColumn(layout, selection.columnId),
        item: null,
      };
    }
    if (selection.kind === "item") {
      const found = findHeaderItem(layout, selection.itemId);
      return {
        row: found?.row ?? null,
        column: found?.column ?? null,
        item: found?.item ?? null,
      };
    }
    // The chrome rows are not in the tree; their state rides in separately.
    return { row: null, column: null, item: null };
  }, [layout, selection]);

  /** Where a clicked drawer chip lands: the selection, else the last row. */
  const targetColumnId = useMemo(() => {
    if (!layout) return null;
    if (selection?.kind === "column") return selection.columnId;
    if (selection?.kind === "item") {
      return findHeaderItem(layout, selection.itemId)?.column.id ?? null;
    }
    const lastRow = layout.rows[layout.rows.length - 1];
    if (!lastRow) return null;
    const columns = visibleColumns(lastRow);
    return columns[columns.length - 1]?.id ?? null;
  }, [layout, selection]);

  const addItemToColumn = (
    columnId: string,
    type: HeaderItemType,
    index?: number,
  ) => {
    if (!layout) return;
    const item = createHeaderItem(type);
    const next = insertItem(layout, columnId, item, index);
    if (!findHeaderItem(next, item.id)) {
      toast.error(
        tSafe(
          "admin.headerStudio.toast.columnFull",
          "That column is full — remove an item first",
        ),
      );
      return;
    }
    setLayout(next);
    setSelection({ kind: "item", itemId: item.id });
    // A dropped "Deliver to" block renders nothing until shopper location is
    // on, so placing one is taken as asking for it — otherwise the chip sits
    // on the canvas and the storefront shows nothing, with no hint why.
    if (type === "location") setShowLocation(true);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDrag((event.active.data.current as DragData | undefined) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!layout || !over) return;

    const from = active.data.current as DragData | undefined;
    const to = over.data.current as DragData | undefined;
    if (!from || !to) return;

    if (from.kind === "row") {
      if (to.kind !== "row") return;
      setLayout(moveRow(layout, String(active.id), String(over.id)));
      return;
    }

    const columnId = to.kind === "column" || to.kind === "item" ? to.columnId : null;
    if (!columnId) return;

    // Dropping onto an item inserts before it; dropping on the column
    // appends.
    const index =
      to.kind === "item"
        ? (findColumn(layout, columnId)?.items.findIndex(
            (item) => item.id === to.itemId,
          ) ?? undefined)
        : undefined;

    if (from.kind === "new") {
      addItemToColumn(columnId, from.itemType, index === -1 ? undefined : index);
      return;
    }

    if (from.kind === "item") {
      setLayout(
        moveItem(layout, from.itemId, columnId, index === -1 ? undefined : index),
      );
    }
  };

  const save = async () => {
    if (!header) return;
    try {
      setIsSaving(true);

      if (isHeaderDirty) {
        const normalized = normalizeHeaderSettings(header);
        const response = await fetch("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: "header", data: normalized }),
        });
        const payload = (await response.json()) as SettingsPayload;
        if (!response.ok || payload.success !== true) {
          throw new Error("failed");
        }

        const saved = normalizeHeaderSettings(
          payload.data?.header ?? normalized,
        );
        setHeader(saved);
        setInitialHeader(saved);
      }

      if (isChromeDirty) {
        // Draft save, then publish: the announcement bar and top tags are
        // instances on the header group document, which goes live through
        // the same draft → publish gate Customize uses.
        const draftResponse = await fetch(
          "/api/admin/store-pages/group:header",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sections: chromeSections }),
          },
        );
        if (!draftResponse.ok) throw new Error("failed");
        const publishResponse = await fetch(
          "/api/admin/store-pages/group:header/publish",
          { method: "POST" },
        );
        if (!publishResponse.ok) throw new Error("failed");
        setInitialChrome(chromeSections);
      }

      toast.success(
        tSafe("admin.headerStudio.toast.published", "Header published"),
      );
    } catch {
      toast.error(
        tSafe("admin.headerStudio.toast.saveFailed", "Could not save the header"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Same placeholder as `menus/header/loading.tsx`.
  if (isLoading || !header || !layout) return <HeaderStudioSkeleton />;

  const linksItem = linksItemId
    ? findHeaderItem(layout, linksItemId)?.item
    : null;

  return (
    <div className={cn("mx-auto w-full max-w-7xl", STUDIO_CONTROL_RADIUS)}>
      <div>
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={tSafe("admin.headerStudio.title", "Header Studio")}
        status={
          <Badge variant={isDirty ? "secondary" : "default"}>
            {isDirty
              ? tSafe("admin.headerStudio.status.draft", "Draft")
              : tSafe("admin.headerStudio.status.published", "Published")}
          </Badge>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!isDirty || isSaving}
              onClick={() => {
                setHeader(initialHeader);
                setChromeSections(initialChrome);
                setSelection(null);
              }}
            >
              {tSafe("admin.headerStudio.actions.discard", "Discard")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isSaving}
              onClick={() => {
                setLayout(getDefaultHeaderLayout());
                setSelection(null);
              }}
            >
              <RotateCcw className="h-4 w-4" />
              {tSafe("admin.headerStudio.actions.defaults", "Defaults")}
            </Button>
            <Button size="sm" disabled={isSaving || !isDirty} onClick={save}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {tSafe("admin.headerStudio.actions.publish", "Publish")}
            </Button>
          </>
        }
      />
      </div>

      {/* Preview: what the storefront will paint. Pinned under the
          dashboard header so a property change lower on the page is seen
          the moment it is made — the whole point of editing beside a
          preview. Once stuck it sheds its title and template button and
          pulls in tight: pinned, it is a reference strip, not a section. */}
      <div ref={previewSentinel} aria-hidden />
      <section
        ref={previewSection}
        className={cn(
          "sticky top-[var(--dashboard-header-height,4rem)] z-20 -mx-1 bg-background px-1 transition-[padding]",
          // A rule only while the preview is actually pinned, where it
          // separates the bar from content sliding under it. Sitting at rest
          // above the Layout section's own rule, it drew two lines across
          // the page with nothing between them.
          previewStuck ? "border-b pb-2 pt-1.5" : "space-y-3 pb-4 pt-2",
        )}
      >
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3",
            previewStuck && "hidden",
          )}
        >
          <h2 className="text-base font-semibold">
            {tSafe("admin.headerStudio.preview.title", "Header Preview")}
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="border-primary text-primary hover:text-primary"
            onClick={() => setTemplateOpen(true)}
          >
            {tSafe("admin.headerStudio.preview.template", "Select from template")}
          </Button>
        </div>

        <HeaderStudioPreview
          layout={layout}
          brand={brand}
          announcement={announcement}
          showLocation={header.widgets.showLocationPicker}
        />
      </section>

      {/* Storefront options the layout tree does not carry. */}
      <section className="mt-8 flex flex-wrap items-start justify-between gap-4 rounded-[12px] border bg-card p-4 shadow-xs">
        <div className="min-w-0 max-w-2xl space-y-0.5">
          <h2 className="text-base font-semibold">
            {tSafe("admin.headerStudio.location.title", "Shopper location")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {tSafe(
              "admin.headerStudio.location.description",
              "Lets shoppers say where they are. Adds a “Deliver to” control to the header, a Location filter with “Pickup near me” to the product listings, and carries the place into checkout — city pre-filled, nearest collection point first. For marketplaces whose sellers span more than one city.",
            )}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-3 text-sm font-medium">
          {tSafe("admin.headerStudio.location.toggle", "Show shopper location")}
          <Switch
            checked={header.widgets.showLocationPicker}
            onCheckedChange={setShowLocation}
            aria-label={tSafe(
              "admin.headerStudio.location.toggle",
              "Show shopper location",
            )}
          />
        </label>
      </section>

      {/* Builder: the drawer, the canvas and the property panel. */}
      <section className="mt-10 space-y-4">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold">
            {tSafe("admin.headerStudio.builder.title", "Layout")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {tSafe(
              "admin.headerStudio.builder.hint",
              "Drag an item into a column, or select a column and click an item. Select anything to edit it on the right.",
            )}
          </p>
        </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <ItemDrawer
          tSafe={tSafe}
          canAdd={targetColumnId !== null}
          onAdd={(type) => {
            if (!targetColumnId) return;
            addItemToColumn(targetColumnId, type);
          }}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <StudioCanvas
            layout={layout}
            selection={selection}
            announcement={announcement}
            tSafe={tSafe}
            onSelect={setSelection}
            onToggleAnnouncement={(enabled) => patchAnnouncement({ enabled })}
            onAddRow={() => setLayout(addRow(layout))}
            onRemoveRow={(rowId) => {
              setLayout(removeRow(layout, rowId));
              setSelection(null);
            }}
            onRemoveItem={(itemId) => {
              setLayout(removeItem(layout, itemId));
              setSelection(null);
            }}
          />

          <div className="lg:sticky lg:top-24 lg:self-start">
            <PropertyPanel
              tSafe={tSafe}
              selection={selection}
              row={selected.row}
              column={selected.column}
              item={selected.item}
              announcement={announcement}
              onPatchAnnouncement={patchAnnouncement}
              onPatchRow={(rowId, patch) =>
                setLayout(patchRow(layout, rowId, patch))
              }
              onPatchColumn={(columnId, patch) =>
                setLayout(patchColumn(layout, columnId, patch))
              }
              onPatchItem={(itemId, patch) =>
                setLayout(patchItem(layout, itemId, patch))
              }
              onRemoveRow={(rowId) => {
                setLayout(removeRow(layout, rowId));
                setSelection(null);
              }}
              onRemoveItem={(itemId) => {
                setLayout(removeItem(layout, itemId));
                setSelection(null);
              }}
              onEditLinks={setLinksItemId}
            />
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag ? <DragChip drag={activeDrag} layout={layout} /> : null}
        </DragOverlay>
      </DndContext>
      </section>

      <TemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        brand={brand}
        tSafe={tSafe}
        onSelect={(_key, next) => {
          setLayout(next);
          setSelection(null);
          setTemplateOpen(false);
        }}
      />

      {linksItem && linksItem.type === "nav" ? (
        <NavLinksModal
          open
          onOpenChange={(open) => {
            if (!open) setLinksItemId(null);
          }}
          links={linksItem.links}
          tSafe={tSafe}
          onChange={(links) =>
            setLayout(patchItem(layout, linksItem.id, { links }))
          }
        />
      ) : null}
    </div>
  );
}

/** What follows the cursor: the chip for whatever is being dragged. */
function DragChip({
  drag,
  layout,
}: {
  drag: DragData;
  layout: HeaderLayout;
}) {
  let item: HeaderLayoutItem | null = null;
  if (drag.kind === "item") {
    item = findHeaderItem(layout, drag.itemId)?.item ?? null;
  }

  const type =
    drag.kind === "new" ? drag.itemType : item ? item.type : null;
  if (!type) return null;

  const meta = itemMeta(type);
  const Icon = meta.icon;

  return (
    <div className="flex h-9 items-center gap-2 rounded-[4px] border bg-background px-3 text-xs font-medium shadow-lg">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      {meta.label}
    </div>
  );
}
