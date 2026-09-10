"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  Building2,
  Cookie,
  ExternalLink,
  FilePlus2,
  FileText,
  HelpCircle,
  LayoutGrid,
  Mail,
  PencilLine,
  PersonStanding,
  Plus,
  RotateCcw,
  Rows3,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, isRecord } from "@/lib/utils";
import {
  CONTENT_PAGE_KEYS,
  CONTENT_PAGE_META,
  normalizeContentPagesSettings,
  type ContentPageKey,
  type ContentPagesSettings,
} from "@/lib/site-config/content-pages-config";

type SettingsResponse = {
  success?: boolean;
  data?: {
    contentPages?: unknown;
  };
};

type ViewMode = "list" | "grid";
type StatusFilter = "all" | "visible" | "hidden";

const VIEW_MODE_STORAGE_KEY = "admin-pages-view-mode";
const VIEW_MODE_CHANGE_EVENT = "admin-pages-view-mode-change";

function subscribeToViewMode(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(VIEW_MODE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(VIEW_MODE_CHANGE_EVENT, callback);
  };
}

function getViewModeSnapshot(): ViewMode {
  return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "grid"
    ? "grid"
    : "list";
}

function getServerViewModeSnapshot(): ViewMode {
  return "list";
}

function setStoredViewMode(mode: ViewMode) {
  window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  window.dispatchEvent(new Event(VIEW_MODE_CHANGE_EVENT));
}

const PAGE_VISUALS: Record<
  ContentPageKey | "custom",
  { icon: LucideIcon; tile: string }
> = {
  terms: {
    icon: ScrollText,
    tile: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  privacy: {
    icon: ShieldCheck,
    tile: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  returns: {
    icon: RotateCcw,
    tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  cookies: {
    icon: Cookie,
    tile: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  accessibility: {
    icon: PersonStanding,
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  contact: {
    icon: Mail,
    tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  faq: {
    icon: HelpCircle,
    tile: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
  },
  about: {
    icon: Building2,
    tile: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  custom: {
    icon: FileText,
    tile: "bg-primary/10 text-primary",
  },
};

type PageEntry = {
  id: string;
  kind: "built-in" | "custom";
  visual: ContentPageKey | "custom";
  title: string;
  description: string;
  publicPath: string;
  editPath: string;
  visible: boolean;
  saving: boolean;
  updatedAt?: string;
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PageIconTile({
  visual,
  className,
}: {
  visual: ContentPageKey | "custom";
  className?: string;
}) {
  const { icon: Icon, tile } = PAGE_VISUALS[visual];
  return (
    <div
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
        tile,
        className,
      )}
    >
      <Icon className="h-4.5 w-4.5" />
    </div>
  );
}

function StatusBadge({
  visible,
  className,
}: {
  visible: boolean;
  className?: string;
}) {
  const t = useTranslations("admin.onlineStorePagesPage");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        visible
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          visible ? "bg-emerald-500" : "bg-muted-foreground/50",
        )}
      />
      {visible ? t("status.visible") : t("status.hidden")}
    </span>
  );
}

function PathChip({ path, className }: { path: string; className?: string }) {
  return (
    <span
      className={cn(
        "truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground",
        className,
      )}
    >
      {path}
    </span>
  );
}

function PageActions({
  entry,
  locale,
  onDelete,
}: {
  entry: PageEntry;
  locale: string;
  onDelete?: () => void;
}) {
  const t = useTranslations("admin.onlineStorePagesPage");
  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <Link
              href={entry.editPath}
              aria-label={t("aria.edit", { title: entry.title })}
            >
              <PencilLine className="h-4 w-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("actions.edit")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <Link
              href={`/${locale}${entry.publicPath}`}
              target="_blank"
              aria-label={t("aria.open", { title: entry.title })}
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("actions.openOnStorefront")}</TooltipContent>
      </Tooltip>

      {onDelete ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={onDelete}
              disabled={entry.saving}
              aria-label={t("aria.delete", { title: entry.title })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("actions.deletePage")}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function VisibilitySwitch({
  entry,
  onToggle,
}: {
  entry: PageEntry;
  onToggle: () => void;
}) {
  const t = useTranslations("admin.onlineStorePagesPage");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Switch
            checked={entry.visible}
            onCheckedChange={onToggle}
            disabled={entry.saving}
            aria-label={t("aria.toggleVisibility", { title: entry.title })}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {entry.visible ? t("actions.hideFromStorefront") : t("actions.showOnStorefront")}
      </TooltipContent>
    </Tooltip>
  );
}

function PageListRow({
  entry,
  locale,
  onToggleVisible,
  onDelete,
}: {
  entry: PageEntry;
  locale: string;
  onToggleVisible: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("admin.onlineStorePagesPage");
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/40 sm:px-4",
        entry.saving && "opacity-60",
      )}
    >
      <Link
        href={entry.editPath}
        className="group flex min-w-0 flex-1 items-center gap-3"
      >
        <PageIconTile visual={entry.visual} className="hidden sm:grid" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold leading-tight text-foreground group-hover:text-primary">
              {entry.title}
            </p>
            <PathChip path={entry.publicPath} className="hidden md:inline" />
          </div>
          <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
            {entry.description}
            {entry.updatedAt ? (
              <span> &middot; {t("updated", { date: formatUpdatedAt(entry.updatedAt) })}</span>
            ) : null}
          </p>
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-2.5">
        <StatusBadge visible={entry.visible} className="hidden lg:inline-flex" />
        <VisibilitySwitch entry={entry} onToggle={onToggleVisible} />
        <div className="hidden h-5 w-px bg-border sm:block" />
        <PageActions entry={entry} locale={locale} onDelete={onDelete} />
      </div>
    </div>
  );
}

function PageGridCard({
  entry,
  locale,
  onToggleVisible,
  onDelete,
}: {
  entry: PageEntry;
  locale: string;
  onToggleVisible: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("admin.onlineStorePagesPage");
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        entry.saving && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <PageIconTile visual={entry.visual} />
        <VisibilitySwitch entry={entry} onToggle={onToggleVisible} />
      </div>

      <Link href={entry.editPath} className="group mt-3 block min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[15px] font-semibold leading-tight text-foreground group-hover:text-primary">
            {entry.title}
          </p>
        </div>
        <PathChip path={entry.publicPath} className="mt-1.5 inline-block max-w-full" />
        <p className="mt-2 line-clamp-2 text-xs leading-snug text-muted-foreground">
          {entry.description}
        </p>
        {entry.updatedAt ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground/80">
            {t("updated", { date: formatUpdatedAt(entry.updatedAt) })}
          </p>
        ) : null}
      </Link>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
        <StatusBadge visible={entry.visible} />
        <PageActions entry={entry} locale={locale} onDelete={onDelete} />
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  shown,
  total,
  action,
}: {
  title: string;
  shown: number;
  total: number;
  action?: React.ReactNode;
}) {
  const t = useTranslations("admin.onlineStorePagesPage");
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {shown === total ? total : t("shownOfTotal", { shown, total })}
        </span>
      </div>
      {action}
    </div>
  );
}

export function PagesManager({
  locale,
  initialContentPages,
}: {
  locale: string;
  initialContentPages: ContentPagesSettings;
}) {
  const t = useTranslations("admin.onlineStorePagesPage");
  const { confirm } = useConfirmation();
  const [contentPages, setContentPages] = useState(initialContentPages);
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const viewMode = useSyncExternalStore(
    subscribeToViewMode,
    getViewModeSnapshot,
    getServerViewModeSnapshot,
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const setSaving = (key: string, value: boolean) => {
    setSavingKeys((prev) => ({ ...prev, [key]: value }));
  };

  const saveContentPages = async (
    data: Record<string, unknown>,
    successMessage: string,
  ) => {
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: "contentPages",
        data,
      }),
    });

    const payload = (await response.json()) as SettingsResponse;
    if (!response.ok || payload.success !== true || !isRecord(payload.data)) {
      throw new Error(t("toast.saveSettingsFailed"));
    }

    const normalized = normalizeContentPagesSettings(payload.data.contentPages);
    setContentPages(normalized);
    toast.success(successMessage);
  };

  const toggleBuiltInVisibility = async (
    pageKey: (typeof CONTENT_PAGE_KEYS)[number],
  ) => {
    const savingKey = `built-in-${pageKey}`;
    const nextVisible = !contentPages[pageKey].visible;
    const nextLabel = nextVisible ? t("status.visible") : t("status.hidden");

    try {
      setSaving(savingKey, true);
      await saveContentPages(
        {
          [pageKey]: {
            ...contentPages[pageKey],
            visible: nextVisible,
          },
        },
        t("toast.visibilityUpdated", {
          title: t(`builtIn.${pageKey}.title`),
          status: nextLabel,
        }),
      );
    } catch {
      toast.error(
        t("toast.visibilityUpdateFailed", {
          title: t(`builtIn.${pageKey}.title`),
        }),
      );
    } finally {
      setSaving(savingKey, false);
    }
  };

  const toggleCustomVisibility = async (pageId: string) => {
    const targetPage = contentPages.customPages.find((item) => item.id === pageId);
    if (!targetPage) return;

    const savingKey = `custom-${pageId}`;
    const nextVisible = !targetPage.visible;
    const now = new Date().toISOString();

    try {
      setSaving(savingKey, true);
      await saveContentPages(
        {
          customPages: contentPages.customPages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  visible: nextVisible,
                  updatedAt: now,
                }
              : page,
          ),
        },
        t("toast.visibilityUpdated", {
          title: targetPage.title,
          status: nextVisible ? t("status.visible") : t("status.hidden"),
        }),
      );
    } catch {
      toast.error(t("toast.visibilityUpdateFailed", { title: targetPage.title }));
    } finally {
      setSaving(savingKey, false);
    }
  };

  const deleteCustomPage = async (pageId: string) => {
    const page = contentPages.customPages.find((item) => item.id === pageId);
    if (!page) return;

    const confirmed = await confirm({
      title: t("confirm.deleteTitle"),
      description: t("confirm.deleteDescription", { title: page.title }),
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
      confirmVariant: "destructive",
      type: "danger",
    });
    if (!confirmed) return;

    const savingKey = `custom-${pageId}`;
    try {
      setSaving(savingKey, true);
      await saveContentPages(
        {
          customPages: contentPages.customPages.filter((item) => item.id !== pageId),
        },
        t("toast.deleted", { title: page.title }),
      );
    } catch {
      toast.error(t("toast.deleteFailed", { title: page.title }));
    } finally {
      setSaving(savingKey, false);
    }
  };

  const builtInEntries = useMemo<PageEntry[]>(
    () =>
      CONTENT_PAGE_KEYS.map((pageKey) => {
        const pageMeta = CONTENT_PAGE_META[pageKey];
        return {
          id: pageKey,
          kind: "built-in" as const,
          visual: pageKey,
          title: t(`builtIn.${pageKey}.title`),
          description: t(`builtIn.${pageKey}.description`),
          publicPath: pageMeta.publicPath,
          editPath: pageMeta.adminPath,
          visible: contentPages[pageKey].visible,
          saving: Boolean(savingKeys[`built-in-${pageKey}`]),
        };
      }),
    [contentPages, savingKeys, t],
  );

  const customEntries = useMemo<PageEntry[]>(
    () =>
      [...contentPages.customPages]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((page) => ({
          id: page.id,
          kind: "custom" as const,
          visual: "custom" as const,
          title: page.title,
          description: page.metaDescription || t("customFallbackDescription"),
          publicPath: `/pages/${page.handle}`,
          editPath: `/admin/online-store/pages/custom/${page.id}`,
          visible: page.visible,
          saving: Boolean(savingKeys[`custom-${page.id}`]),
          updatedAt: page.updatedAt,
        })),
    [contentPages.customPages, savingKeys, t],
  );

  const matchesFilters = (entry: PageEntry) => {
    if (statusFilter === "visible" && !entry.visible) return false;
    if (statusFilter === "hidden" && entry.visible) return false;

    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return true;
    return (
      entry.title.toLowerCase().includes(trimmed) ||
      entry.publicPath.toLowerCase().includes(trimmed) ||
      entry.description.toLowerCase().includes(trimmed)
    );
  };

  const filteredBuiltIn = builtInEntries.filter(matchesFilters);
  const filteredCustom = customEntries.filter(matchesFilters);

  const allEntries = [...builtInEntries, ...customEntries];
  const visibleCount = allEntries.filter((entry) => entry.visible).length;
  const hiddenCount = allEntries.length - visibleCount;
  const hasActiveFilters = statusFilter !== "all" || query.trim().length > 0;
  const noResults =
    hasActiveFilters && filteredBuiltIn.length === 0 && filteredCustom.length === 0;

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
  };

  const handleToggle = (entry: PageEntry) =>
    entry.kind === "built-in"
      ? void toggleBuiltInVisibility(entry.id as ContentPageKey)
      : void toggleCustomVisibility(entry.id);

  const renderEntries = (entries: PageEntry[]) => {
    if (viewMode === "grid") {
      return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => (
            <PageGridCard
              key={entry.id}
              entry={entry}
              locale={locale}
              onToggleVisible={() => handleToggle(entry)}
              onDelete={
                entry.kind === "custom"
                  ? () => void deleteCustomPage(entry.id)
                  : undefined
              }
            />
          ))}
        </div>
      );
    }

    return (
      <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {entries.map((entry) => (
          <PageListRow
            key={entry.id}
            entry={entry}
            locale={locale}
            onToggleVisible={() => handleToggle(entry)}
            onDelete={
              entry.kind === "custom"
                ? () => void deleteCustomPage(entry.id)
                : undefined
            }
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card px-5 py-5 shadow-sm md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground md:text-base">
              {t("description")}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" />
                <span className="font-semibold text-foreground">
                  {allEntries.length}
                </span>
                {t("summary.pages")}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="font-semibold text-foreground">
                  {visibleCount}
                </span>
                {t("status.visible")}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                <span className="font-semibold text-foreground">
                  {hiddenCount}
                </span>
                {t("status.hidden")}
              </span>
            </div>
          </div>

          <Button asChild className="w-full rounded-lg px-5 font-semibold sm:w-auto">
            <Link href="/admin/online-store/pages/new">
              <FilePlus2 className="h-4 w-4" />
              {t("actions.addPage")}
            </Link>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-4 px-4 pt-4 sm:px-5">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {t("storePages")}
          </h2>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setStoredViewMode("list")}
                  className={cn(
                    "grid size-8 place-items-center rounded-md transition-colors",
                    viewMode === "list"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-label={t("view.list")}
                >
                  <Rows3 className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("view.list")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setStoredViewMode("grid")}
                  className={cn(
                    "grid size-8 place-items-center rounded-md transition-colors",
                    viewMode === "grid"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-label={t("view.grid")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("view.grid")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex items-center gap-5 border-b border-border px-4 sm:px-5">
          {(
            [
              ["all", t("filters.all"), allEntries.length],
              ["visible", t("status.visible"), visibleCount],
              ["hidden", t("status.hidden"), hiddenCount],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={cn(
                "relative flex items-center gap-1.5 py-3 text-sm font-medium transition-colors",
                statusFilter === value
                  ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums",
                  statusFilter === value
                    ? "bg-foreground/10 text-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        <div className="px-4 py-3 sm:px-5">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-10 rounded-md border-border bg-muted/40 pl-10 pr-10 text-[15px] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t("actions.clearSearch")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        {!noResults && filteredBuiltIn.length > 0 ? (
          viewMode === "grid" ? (
            <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredBuiltIn.map((entry) => (
                <PageGridCard
                  key={entry.id}
                  entry={entry}
                  locale={locale}
                  onToggleVisible={() => handleToggle(entry)}
                />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-border/70 border-t border-border">
              {filteredBuiltIn.map((entry) => (
                <PageListRow
                  key={entry.id}
                  entry={entry}
                  locale={locale}
                  onToggleVisible={() => handleToggle(entry)}
                />
              ))}
            </div>
          )
        ) : null}
      </div>

      {noResults ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Search className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            {t("empty.noResultsTitle")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("empty.noResultsDescription")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-5 rounded-lg"
            onClick={clearFilters}
          >
            {t("actions.clearFilters")}
          </Button>
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <SectionHeading
              title={t("customPages")}
              shown={filteredCustom.length}
              total={customEntries.length}
              action={
                customEntries.length > 0 ? (
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <Link href="/admin/online-store/pages/new">
                      <Plus className="h-4 w-4" />
                      {t("actions.addPage")}
                    </Link>
                  </Button>
                ) : undefined
              }
            />

            {customEntries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                  <FilePlus2 className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-sm font-semibold text-foreground">
                  {t("empty.noCustomTitle")}
                </h3>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  {t("empty.noCustomDescription")}
                </p>
                <Button asChild size="sm" className="mt-5 rounded-lg">
                  <Link href="/admin/online-store/pages/new">
                    <FilePlus2 className="h-4 w-4" />
                    {t("actions.createFirstPage")}
                  </Link>
                </Button>
              </div>
            ) : filteredCustom.length > 0 ? (
              renderEntries(filteredCustom)
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("empty.noCustomResults")}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
