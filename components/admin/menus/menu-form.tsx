"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  arrayMove,
} from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Eye,
  FolderTree,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast-notification";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { cn } from "@/lib/utils";

import {
  blankItem,
  buildCategorySyncDiff,
  buildItemIndex,
  categoryToMenuItem,
  ensureChildren,
  firstImageItemPath,
  firstItemPath,
  getMegaMenuDepthWarning,
  getMenuStats,
  makeId,
  mergeGeneratedCategoryItem,
  pathToItem,
  remapPathAfterReorder,
  replaceAtPath,
  stripTempIds,
  trimMegaMenuItems,
  type CategoryMenuNode,
  type Props,
  type MenuFormState,
  type MenuItem,
  type PendingCategorySync,
} from "@/components/admin/menus/menu-form/helpers";
import {
  ItemTree,
  MenuItemInspector,
  MenuSettingsPanel,
} from "@/components/admin/menus/menu-form/editor-panels";
import { MegaMenuPreview } from "@/components/admin/menus/menu-form/mega-builder";
import { MenuFormSkeleton } from "@/components/admin/online-store/online-store-skeletons";
import {
  MegaCategoryRail,
  MegaFlyoutCanvas,
  MegaSlotMeter,
  type MegaCanvasLabels,
} from "@/components/admin/menus/menu-form/mega-canvas";
import {
  MegaSyncView,
  type SyncLabels,
} from "@/components/admin/menus/menu-form/sync-view";
import { MAX_MEGA_MENU_DEPTH } from "@/lib/site-config/menu-depth";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

export function MenuForm({ menuId }: Props) {
  const t = useTranslations("admin.menuForm");
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = typeof params.locale === "string" ? params.locale : "en";
  const basePath = `/${locale}/admin/online-store/menus`;

  const [form, setForm] = useState<MenuFormState>({
    name: "",
    handle: "",
    location: "custom",
    description: "",
    isActive: true,
    items: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(!!menuId);
  const [isSyncingCategories, setIsSyncingCategories] = useState(false);
  const [activePath, setActivePath] = useState<number[] | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [pendingSync, setPendingSync] = useState<PendingCategorySync | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  // Build, sync and settings each get the whole container: the canvas needs
  // the width, and sync is a screen of its own rather than a side panel.
  const [view, setView] = useState<"build" | "sync" | "settings">("build");
  const [showPreview, setShowPreview] = useState(false);
  const [showFormula, setShowFormula] = useState(false);
  // The raw category tree behind the sync screen — the merged menu items lose
  // the levels past three, and those are exactly what has to be shown as
  // skipped rather than silently dropped.
  const [syncSource, setSyncSource] = useState<CategoryMenuNode[]>([]);
  const [syncFailed, setSyncFailed] = useState(false);

  const toggleCollapse = (key: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (!menuId) return;
    (async () => {
      setIsFetching(true);
      try {
        const res = await fetch(`/api/menus/${menuId}`);
        const data = await res.json();
        if (data.success) {
          const m = data.data;
          const items = ensureChildren(m.items || []);
          setForm({
            name: m.name,
            handle: m.handle,
            location: m.location,
            description: m.description || "",
            isActive: m.isActive,
            items,
          });
          setActivePath(firstImageItemPath(items) || firstItemPath(items));
        }
      } catch {
        toast.error(t("toast.loadFailed"));
      } finally {
        setIsFetching(false);
      }
    })();
  }, [menuId, t]);

  const updateAt = (path: number[], updater: (item: MenuItem) => MenuItem) => {
    setForm((prev) => {
      const next = structuredClone(prev) as MenuFormState;
      const target = pathToItem(next.items, path);
      if (target) {
        const updated = updater(target);
        replaceAtPath(next.items, path, updated);
      }
      return next;
    });
  };

  const removeAt = (path: number[]) => {
    setForm((prev) => {
      const next = structuredClone(prev) as MenuFormState;
      const parent = path.length === 1 ? next.items : pathToItem(next.items, path.slice(0, -1))?.children;
      if (parent) parent.splice(path[path.length - 1], 1);
      return next;
    });
  };

  const moveAt = (path: number[], direction: "up" | "down") => {
    setForm((prev) => {
      const next = structuredClone(prev) as MenuFormState;
      const parentPath = path.slice(0, -1);
      const idx = path[path.length - 1];
      const parent =
        parentPath.length === 0
          ? next.items
          : pathToItem(next.items, parentPath)?.children;
      if (!parent) return next;
      const swap = direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= parent.length) return next;
      [parent[idx], parent[swap]] = [parent[swap], parent[idx]];
      return next;
    });
  };

  const duplicateAt = (path: number[]) => {
    if (form.location === "header-mega" && path.length > MAX_MEGA_MENU_DEPTH) {
      toast.error(t("toast.maxDepth"));
      return;
    }

    const newPath = [...path];
    setForm((prev) => {
      const next = structuredClone(prev) as MenuFormState;
      const parentPath = path.slice(0, -1);
      const idx = path[path.length - 1];
      const parent =
        parentPath.length === 0
          ? next.items
          : pathToItem(next.items, parentPath)?.children;
      if (!parent?.[idx]) return prev;
      const copy = structuredClone(parent[idx]) as MenuItem;
      const refreshIds = (item: MenuItem, isRoot = false): MenuItem => ({
        ...item,
        _id: makeId(),
        label: isRoot ? `${item.label} copy` : item.label,
        children: (item.children || []).map((child) => refreshIds(child)),
      });
      let duplicate = refreshIds(copy, true);
      if (prev.location === "header-mega") {
        const allowedDepth = MAX_MEGA_MENU_DEPTH - parentPath.length;
        const scopedTrimmed = trimMegaMenuItems([duplicate], allowedDepth);
        duplicate = scopedTrimmed.items[0] || duplicate;
        if (scopedTrimmed.trimmedCount > 0) {
          toast.info(
            t("toast.duplicateTrimmed", { depth: MAX_MEGA_MENU_DEPTH }),
          );
        }
      }
      parent.splice(idx + 1, 0, duplicate);
      newPath[newPath.length - 1] = idx + 1;
      return next;
    });
    setActivePath(newPath);
  };

  const reorderAt = (parentPath: number[], fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setForm((prev) => {
      const next = structuredClone(prev) as MenuFormState;
      const parent =
        parentPath.length === 0
          ? next.items
          : pathToItem(next.items, parentPath)?.children;
      if (!parent) return prev;
      const reordered = arrayMove(parent, fromIndex, toIndex);
      parent.splice(0, parent.length, ...reordered);
      return next;
    });
    setActivePath((current) =>
      remapPathAfterReorder(current, parentPath, fromIndex, toIndex),
    );
  };

  const addChild = (path: number[] | null) => {
    if (form.location === "header-mega" && path && path.length >= MAX_MEGA_MENU_DEPTH) {
      toast.error(t("toast.maxDepth"));
      return;
    }

    const newPath = !path
      ? [form.items.length]
      : [...path, (pathToItem(form.items, path)?.children || []).length];

    setForm((prev) => {
      const next = structuredClone(prev) as MenuFormState;
      if (!path) {
        next.items.push(blankItem());
      } else {
        const parent = pathToItem(next.items, path);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(blankItem());
        }
      }
      return next;
    });
    setActivePath(newPath);
  };

  // In-flight guard for the request itself; `isSyncingCategories` is the
  // spinner and is set by whoever starts a run (the button, or render below).
  const syncInFlightRef = useRef(false);
  const runCategorySync = useCallback(() => {
    if (syncInFlightRef.current) return Promise.resolve();
    syncInFlightRef.current = true;
    const request = async () => {
      const res = await fetch("/api/categories?status=active");
      const result = await res.json();
      return (Array.isArray(result?.data) ? result.data : []) as CategoryMenuNode[];
    };
    return request()
      .then((categories) => {
        setSyncSource(categories);
        const items: MenuItem[] = categories.map((category: CategoryMenuNode) =>
          categoryToMenuItem(category),
        );
        const trimmed = trimMegaMenuItems(items);

        if (items.length === 0) {
          toast.error(t("toast.noActiveCategories"));
          return;
        }

        const currentByResource = buildItemIndex(form.items);
        const mergedItems = trimmed.items.map((item) =>
          mergeGeneratedCategoryItem(item, currentByResource),
        );

        setPendingSync({
          items: mergedItems,
          diff: buildCategorySyncDiff(form.items, trimmed.items),
          trimmedCount: trimmed.trimmedCount,
        });
        toast.success(
          trimmed.trimmedCount > 0
            ? t("toast.syncPreviewTrimmed", { depth: MAX_MEGA_MENU_DEPTH })
            : t("toast.syncPreviewReady"),
        );
      })
      .catch(() => {
        setSyncFailed(true);
        toast.error(t("toast.syncFailed"));
      })
      .finally(() => {
        syncInFlightRef.current = false;
        setIsSyncingCategories(false);
      });
  }, [form.items, t]);
  const syncCategoriesToMegaMenu = useCallback(() => {
    if (syncInFlightRef.current) return Promise.resolve();
    setIsSyncingCategories(true);
    return runCategorySync();
  }, [runCategorySync]);

  const applyPendingSync = () => {
    if (!pendingSync) return;
    setForm((prev) => ({
      ...prev,
      location: "header-mega",
      items: pendingSync.items,
    }));
    setActivePath(firstImageItemPath(pendingSync.items) || firstItemPath(pendingSync.items));
    setPendingSync(null);
    toast.success(t("toast.syncApplied"));
  };

  const menuStats = useMemo(() => getMenuStats(form.items), [form.items]);
  const isMegaMenu = form.location === "header-mega";
  const depthWarning = useMemo(
    () => (isMegaMenu ? getMegaMenuDepthWarning(form.items) : null),
    [form.items, isMegaMenu],
  );
  const activeItem = useMemo(
    () => (activePath ? pathToItem(form.items, activePath) : null),
    [activePath, form.items],
  );
  // Root-to-parent chain: a column or link quotes its category's budget, and
  // the inspector shows the trail it sits in.
  const activeAncestors = useMemo(() => {
    if (!activePath) return [];
    const chain: MenuItem[] = [];
    for (let depth = 1; depth < activePath.length; depth += 1) {
      const node = pathToItem(form.items, activePath.slice(0, depth));
      if (node) chain.push(node);
    }
    return chain;
  }, [activePath, form.items]);
  const activeDepth = activePath ? activePath.length : 0;

  // Sync only exists for mega menus, so changing the location away from one
  // must not strand the form on a tab that no longer renders.
  useApplyOnChange([isMegaMenu, view], () => {
    if (!isMegaMenu && view === "sync") setView("build");
  });

  // Opening the sync screen should already show the mapping, so the fetch runs
  // on arrival rather than behind a button. One attempt only — a failed fetch
  // waits for the explicit refresh instead of retrying on every render.
  useApplyOnChange([view, pendingSync, syncFailed], () => {
    if (view === "sync" && !pendingSync && !syncFailed) {
      setIsSyncingCategories(true);
    }
  });
  useEffect(() => {
    if (view !== "sync" || pendingSync || syncFailed) return;
    void runCategorySync();
  }, [view, pendingSync, syncFailed, runCategorySync]);

  const selectItem = (path: number[]) => {
    setActivePath(path);
  };

  const editItem = (path: number[]) => {
    setActivePath(path);
    setView("build");
  };

  const activeCategoryIndex = activePath?.[0] ?? null;
  const activeCategory =
    activeCategoryIndex === null ? null : form.items[activeCategoryIndex] || null;

  const onSubmit = async () => {
    if (!form.name.trim()) {
      toast.error(t("toast.nameRequired"));
      return;
    }
    setIsLoading(true);
    try {
      const url = menuId ? `/api/menus/${menuId}` : "/api/menus";
      const method = menuId ? "PUT" : "POST";
      const rawItems = isMegaMenu ? trimMegaMenuItems(form.items) : null;
      const cleanItems = stripTempIds(rawItems ? rawItems.items : form.items);
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, items: cleanItems }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        toast.success(
          rawItems?.trimmedCount
            ? t("toast.savedTrimmed", { depth: MAX_MEGA_MENU_DEPTH })
            : menuId
              ? t("toast.updated")
              : t("toast.created"),
        );
        router.push(basePath);
      } else {
        const validationDetails =
          result.errors && typeof result.errors === "object"
            ? Object.entries(result.errors as Record<string, string[]>)
                .flatMap(([field, messages]) =>
                  messages.map((message) => `${field}: ${message}`),
                )
                .slice(0, 3)
                .join("; ")
            : "";
        toast.error(
          validationDetails ||
            result.error ||
            result.message ||
            t("toast.saveFailed"),
        );
      }
    } catch {
      toast.error(t("toast.genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  // Same placeholder as the menu routes' `loading.tsx`.
  if (isFetching) return <MenuFormSkeleton />;

  const canvasLabels: MegaCanvasLabels = {
    rail: t("mega.categories"),
    addCategory: t("mega.addCategory"),
    synced: t("canvas.synced"),
    manual: t("canvas.manual"),
    emptyRail: t("mega.emptyCategories"),
    formulaTitle: t("formula.title"),
    formulaL1: t("formula.l1"),
    formulaL2: t("formula.l2"),
    formulaL3: t("formula.l3"),
    formulaL4: t("formula.l4"),
    formulaHint: t("formula.hint"),
    formulaSync: t("views.sync"),
    formulaManual: t("formula.manual"),
    pickCategory: t("mega.pickCategory"),
    panelFor: t("canvas.panelFor"),
    addColumn: t("canvas.addColumn"),
    addLink: t("canvas.addLink"),
    neverBlocked: t("canvas.neverBlocked"),
    belowFold: (count: number) => t("canvas.belowFold", { count }),
    parkedTitle: (count: number) => t("canvas.parkedTitle", { count }),
    parkedHint: (limit: number) => t("canvas.parkedHint", { limit }),
    moveIn: t("canvas.moveIn"),
    remove: t("canvas.remove"),
    addBanner: t("canvas.addBanner"),
    addCard: t("canvas.addCard"),
    viewAll: t("mega.viewAllCategories"),
    untitled: t("canvas.untitled"),
  };

  const syncLabels: SyncLabels = {
    title: t("views.sync"),
    subtitle: t("sync.subtitle"),
    source: t("sync.source"),
    sourceCount: (rows: number, skipped: number) =>
      t("sync.sourceCount", { rows, skipped }),
    refresh: t("sync.refresh"),
    loading: t("sync.loading"),
    empty: t("sync.empty"),
    notMega: t("sync.notMega"),
    setMega: t("sync.setMega"),
    apply: t("sync.apply"),
    discard: t("sync.discard"),
    applyHint: t("sync.applyHint"),
    keepsTitle: t("sync.keepsTitle"),
    keeps: [t("sync.keeps1"), t("sync.keeps2"), t("sync.keeps3")],
    roleRail: t("sync.roleRail"),
    roleColumn: t("sync.roleColumn"),
    roleLink: t("sync.roleLink"),
    roleSkipped: t("sync.roleSkipped"),
    stateAdded: t("sync.stateAdded"),
    stateUpdated: t("sync.stateUpdated"),
    stateRemoved: t("sync.stateRemoved"),
    stateUnchanged: t("sync.stateUnchanged"),
    stateSkipped: t("sync.stateSkipped"),
    removedTitle: (count: number) => t("sync.removedTitle", { count }),
  };

  return (
    <div
      className={cn(
        "-mx-2 w-full space-y-4 md:mx-0",
        // The mega builder is a three-column workspace and wants the whole
        // screen; the tree editor still reads better capped.
        isMegaMenu ? "max-w-none" : "mx-auto max-w-6xl",
      )}
    >
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={form.name || (menuId ? t("editTitle") : t("addTitle"))}
        status={
          <Badge variant={form.isActive ? "default" : "outline"}>
            {form.isActive ? t("status.active") : t("status.inactive")}
          </Badge>
        }
        actions={
          <>
            <Button onClick={onSubmit} disabled={isLoading} size="sm">
              {isLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {t("actions.save")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
              {t("actions.back")}
            </Button>
          </>
        }
      />

      <Tabs
        value={view}
        onValueChange={(value) => setView(value as typeof view)}
        className="gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList
            className={cn(
              "grid h-auto w-full max-w-md gap-1 p-1",
              isMegaMenu ? "grid-cols-3" : "grid-cols-2",
            )}
          >
            <TabsTrigger value="build" className="h-9 gap-1.5">
              <FolderTree className="h-3.5 w-3.5" />
              {t("views.build")}
            </TabsTrigger>
            {isMegaMenu ? (
              <TabsTrigger value="sync" className="h-9 gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                {t("views.sync")}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="settings" className="h-9 gap-1.5">
              <Settings2 className="h-3.5 w-3.5" />
              {t("views.settings")}
            </TabsTrigger>
          </TabsList>

          {isMegaMenu && view === "build" ? (
            <div className="flex flex-wrap items-center gap-3">
              <MegaSlotMeter
                category={activeCategory}
                label={t("canvas.slots")}
                summary={(links: number) => t("canvas.slotSummary", { links })}
              />
              <Button
                type="button"
                size="sm"
                variant={showPreview ? "secondary" : "outline"}
                aria-pressed={showPreview}
                className="gap-1.5"
                onClick={() => setShowPreview((prev) => !prev)}
              >
                <Eye className="h-3.5 w-3.5" />
                {t("canvas.storefront")}
              </Button>
            </div>
          ) : null}
        </div>

        <TabsContent value="build" className="space-y-4">
          {isMegaMenu ? (
            <Card className="gap-0 overflow-hidden p-0 xl:h-[calc(100vh-13rem)]">
              <div className="grid h-full min-h-0 xl:grid-cols-[15rem_minmax(0,1fr)_22rem]">
                <MegaCategoryRail
                  items={form.items}
                  activeIndex={activeCategoryIndex}
                  labels={canvasLabels}
                  showFormula={showFormula}
                  onSelect={selectItem}
                  onAdd={() => {
                    setShowFormula(false);
                    addChild(null);
                  }}
                  onRemove={removeAt}
                  onReorder={reorderAt}
                  onToggleFormula={() => setShowFormula((prev) => !prev)}
                  onGoToSync={() => {
                    setShowFormula(false);
                    setView("sync");
                  }}
                />

                <MegaFlyoutCanvas
                  category={activeCategory}
                  categoryIndex={activeCategoryIndex}
                  activePath={activePath}
                  labels={canvasLabels}
                  onSelect={selectItem}
                  onAdd={addChild}
                  onRemove={removeAt}
                  onReorder={reorderAt}
                />

                <div className="min-h-0 overflow-y-auto border-t p-4 xl:border-s xl:border-t-0">
                  <MenuItemInspector
                    item={activeItem}
                    ancestors={activeAncestors}
                    path={activePath}
                    depth={activeDepth}
                    location={form.location}
                    locale={locale}
                    onChange={(patch) => {
                      if (!activePath) return;
                      updateAt(activePath, (item) => ({ ...item, ...patch }));
                    }}
                    onAddChild={() => {
                      if (activePath) addChild(activePath);
                    }}
                  />
                </div>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
              <Card className="flex min-h-0 flex-col gap-2 overflow-hidden xl:h-[calc(100vh-14rem)]">
                <CardHeader className="shrink-0 gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{t("structure.title")}</CardTitle>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="secondary" className="gap-1">
                          <FolderTree className="h-3.5 w-3.5" />
                          {t("structure.items", { count: menuStats.total })}
                        </Badge>
                        <Badge variant="outline">
                          {t("structure.levels", { count: menuStats.maxDepth || 0 })}
                        </Badge>
                        <Badge variant="outline">
                          {t("structure.images", { count: menuStats.imageCount })}
                        </Badge>
                        {menuStats.missingUrlCount > 0 ? (
                          <Badge variant="destructive">
                            {t("structure.missingUrls", {
                              count: menuStats.missingUrlCount,
                            })}
                          </Badge>
                        ) : null}
                        {depthWarning ? (
                          <Badge variant="destructive">
                            {t("structure.tooDeep", {
                              count: depthWarning.trimmedCount,
                            })}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => addChild(null)}>
                      <Plus className="mr-1 h-4 w-4" /> {t("actions.addItem")}
                    </Button>
                  </div>
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      value={itemSearch}
                      onChange={(event) => setItemSearch(event.target.value)}
                      placeholder={t("searchPlaceholder")}
                    />
                  </div>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 overflow-hidden">
                  {form.items.length === 0 ? (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {t("emptyItems")}
                    </div>
                  ) : (
                    <ScrollArea className="h-full min-h-0 pr-3">
                      <ItemTree
                        items={form.items}
                        path={[]}
                        query={itemSearch.trim()}
                        activePath={activePath}
                        collapsedIds={collapsedIds}
                        onToggleCollapse={toggleCollapse}
                        onSelect={selectItem}
                        onEdit={editItem}
                        onRemove={removeAt}
                        onMove={moveAt}
                        onDuplicate={duplicateAt}
                        onReorder={reorderAt}
                        onAddChild={(p) => addChild(p)}
                      />
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>

              <Card className="gap-2 xl:sticky xl:top-24 xl:self-start">
                <CardHeader>
                  <CardTitle>{t("tabs.item")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <MenuItemInspector
                    item={activeItem}
                    ancestors={activeAncestors}
                    path={activePath}
                    depth={activeDepth}
                    location={form.location}
                    locale={locale}
                    onChange={(patch) => {
                      if (!activePath) return;
                      updateAt(activePath, (item) => ({ ...item, ...patch }));
                    }}
                    onAddChild={() => {
                      if (activePath) addChild(activePath);
                    }}
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {isMegaMenu && showPreview ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("mega.preview")}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t("mega.previewHint")}
                </p>
              </CardHeader>
              <CardContent>
                <MegaMenuPreview
                  items={form.items}
                  railLabel={t("mega.categories")}
                  viewAllLabel={t("mega.viewAllCategories")}
                  viewAllShortLabel={t("mega.viewAll")}
                  emptyLabel={t("emptyItems")}
                />
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {isMegaMenu ? (
          <TabsContent value="sync">
            <Card className="overflow-hidden p-0">
              <MegaSyncView
                isMegaMenu={isMegaMenu}
                isSyncing={isSyncingCategories}
                source={syncSource}
                pendingSync={pendingSync}
                labels={syncLabels}
                onRefresh={() => {
                  setSyncFailed(false);
                  syncCategoriesToMegaMenu();
                }}
                onApply={() => {
                  applyPendingSync();
                  setView("build");
                }}
                onDiscard={() => setPendingSync(null)}
                onSetMegaLocation={() =>
                  setForm((prev) => ({ ...prev, location: "header-mega" }))
                }
              />
            </Card>
          </TabsContent>
        ) : null}

        <TabsContent value="settings">
          <Card className="gap-2">
            <CardHeader>
              <CardTitle>{t("views.settings")}</CardTitle>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="secondary" className="gap-1">
                  <FolderTree className="h-3.5 w-3.5" />
                  {t("structure.items", { count: menuStats.total })}
                </Badge>
                <Badge variant="outline">
                  {t("structure.images", { count: menuStats.imageCount })}
                </Badge>
                {menuStats.missingUrlCount > 0 ? (
                  <Badge variant="destructive">
                    {t("structure.missingUrls", {
                      count: menuStats.missingUrlCount,
                    })}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="max-w-2xl">
              <MenuSettingsPanel form={form} setForm={setForm} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
