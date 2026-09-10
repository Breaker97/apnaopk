"use client";

import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
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
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  ImageIcon,
  Link2,
  Loader2,
  MoreHorizontal,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImageUploadField } from "@/components/admin/settings/fields/image-upload-field";
import { MegaPromoSlots } from "@/components/admin/menus/menu-form/promo-slot-field";
import { cn } from "@/lib/utils";
import {
  LOCATION_OPTIONS,
  MEGA_PROMO_MODES,
  buildPageResourceOptions,
  getMegaCategoryBudget,
  getMegaPromoMode,
  getApiItems,
  getResourceEndpoint,
  itemOrDescendantMatches,
  normalizeResourceOption,
  pathKey,
  pathsEqual,
  type MegaPromoMode,
  type MenuFormState,
  type MenuItem,
  type MenuLocation,
  type ResourceOption,
} from "@/components/admin/menus/menu-form/helpers";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { AppImage } from "@/components/ui/app-image";

function ResourcePicker({
  currentType,
  onPick,
}: {
  currentType: MenuItem["type"];
  onPick: (resource: ResourceOption) => void;
}) {
  const pickerTypes: Array<{ value: MenuItem["type"]; label: string }> = [
    { value: "page", label: "Page" },
    { value: "category", label: "Category" },
    { value: "collection", label: "Collection" },
    { value: "product", label: "Product" },
    { value: "brand", label: "Brand" },
    { value: "blog-post", label: "Blog post" },
  ];
  const initialType = pickerTypes.some((type) => type.value === currentType)
    ? currentType
    : "page";
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MenuItem["type"]>(initialType);
  const [query, setQuery] = useState("");
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Pages and the blog are static lists, filtered in place; everything else
  // is fetched below.
  useApplyOnChange([open, query, type], () => {
    if (!open) return;
    if (type === "page") {
      const normalizedQuery = query.trim().toLowerCase();
      setResources(
        buildPageResourceOptions().filter((page) =>
          [page.label, page.url, page.description]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery),
        ),
      );
      return;
    }
    if (type === "blog") {
      setResources([
        {
          id: "blog",
          label: "Blog",
          url: "/blog",
          type: "blog",
          subtitle: "Storefront page",
        },
      ]);
      return;
    }
    if (!getResourceEndpoint(type, query.trim())) setResources([]);
  });

  useEffect(() => {
    if (!open || type === "page" || type === "blog") return;
    const endpoint = getResourceEndpoint(type, query.trim());
    if (!endpoint) return;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(endpoint);
        const data = await response.json();
        const normalizedQuery = query.trim().toLowerCase();
        const options = getApiItems(data)
          .map((item) => normalizeResourceOption(type, item))
          .filter((item): item is ResourceOption => !!item)
          .filter((item) =>
            !normalizedQuery ||
            [item.label, item.url, item.description]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery),
          );
        setResources(options);
      } catch {
        setResources([]);
      } finally {
        setIsLoading(false);
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [open, query, type]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start gap-2">
          <PackageSearch className="h-4 w-4" />
          Choose resource
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-3">
        <div className="space-y-3">
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <Select
              value={type}
              onValueChange={(value) => {
                setType(value as MenuItem["type"]);
                setQuery("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pickerTypes.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search..."
              />
            </div>
          </div>
          <ScrollArea className="h-72 pr-2">
            {isLoading ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading
              </div>
            ) : resources.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No resources found.
              </div>
            ) : (
              <div className="space-y-1">
                {resources.map((resource) => (
                  <button
                    key={`${resource.type}:${resource.id}:${resource.url}`}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                    onClick={() => {
                      onPick(resource);
                      setOpen(false);
                    }}
                  >
                    <div className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/50">
                      {resource.image ? (
                        <AppImage
                          src={resource.image}
                          alt=""
                          fill
                          sizes="40px"
                          className="object-cover"
                        />
                      ) : (
                        <Link2 className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{resource.label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {resource.subtitle || resource.url}
                      </p>
                    </div>
                    <Check className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MenuSettingsPanel({
  form,
  setForm,
}: {
  form: MenuFormState;
  setForm: Dispatch<SetStateAction<MenuFormState>>;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Label>Name *</Label>
        <Input
          className="mt-1"
          value={form.name}
          onChange={(event) =>
            setForm((previous) => ({ ...previous, name: event.target.value }))
          }
        />
      </div>
      <div>
        <Label>Handle</Label>
        <Input
          className="mt-1"
          value={form.handle}
          placeholder="auto-generated from name"
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              handle: event.target.value
                .toLowerCase()
                .replace(/\s+/g, "-")
                .replace(/[^a-z0-9-]/g, ""),
            }))
          }
        />
      </div>
      <div>
        <Label>Location</Label>
        <Select
          value={form.location}
          onValueChange={(value) =>
            setForm((previous) => ({
              ...previous,
              location: value as MenuLocation,
            }))
          }
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Description</Label>
        <Textarea
          className="mt-1"
          rows={3}
          value={form.description}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              description: event.target.value,
            }))
          }
        />
      </div>
      <div className="flex items-center justify-between rounded-md border p-3">
        <Label className="m-0">Active</Label>
        <Switch
          checked={form.isActive}
          onCheckedChange={(value) =>
            setForm((previous) => ({ ...previous, isActive: value }))
          }
        />
      </div>
    </div>
  );
}

export function MenuItemInspector({
  item,
  ancestors = [],
  path,
  depth,
  location,
  locale,
  onChange,
  onAddChild,
}: {
  item: MenuItem | null;
  /** Root-to-parent chain — the mega panel quotes the category budget. */
  ancestors?: MenuItem[];
  path: number[] | null;
  depth: number;
  location: MenuLocation;
  locale: string;
  onChange: (patch: Partial<MenuItem>) => void;
  onAddChild: () => void;
}) {
  const isMegaMenu = location === "header-mega";

  if (!item || !path) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {isMegaMenu
          ? "Pick a category, group, or link above to edit it."
          : "Select a menu item to edit its label, link, image, and promo settings."}
      </div>
    );
  }

  // The mega menu has three fixed levels, each of which renders a different
  // handful of fields on the storefront. Showing all twelve at every level is
  // what made this form hard to read, so each level gets only what it uses.
  if (isMegaMenu) {
    return (
      <MegaItemFields
        item={item}
        ancestors={ancestors}
        depth={depth}
        path={path}
        locale={locale}
        onChange={onChange}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.label || "Untitled item"}</p>
          <p className="text-xs text-muted-foreground">{`Level ${depth}`}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onAddChild}>
          <Plus className="mr-1 h-4 w-4" />
          Child
        </Button>
      </div>

      <Separator />

      <div>
        <Label>Label *</Label>
        <Input
          className="mt-1"
          value={item.label}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </div>
      <div>
        <Label>URL</Label>
        <div className="relative mt-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={item.url}
            placeholder="/products or https://..."
            onChange={(event) => onChange({ url: event.target.value })}
          />
        </div>
      </div>
      <ResourcePicker
        currentType={item.type}
        onPick={(resource) =>
          onChange({
            label: resource.label,
            url: resource.url,
            type: resource.type,
            image: resource.image || item.image,
            description: resource.description || item.description,
            target: resource.url.startsWith("http") ? "_blank" : "_self",
          })
        }
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Link type</Label>
          <Select
            value={item.type}
            onValueChange={(value) => onChange({ type: value as MenuItem["type"] })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">Custom URL</SelectItem>
              <SelectItem value="page">Page</SelectItem>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="category">Category</SelectItem>
              <SelectItem value="collection">Collection</SelectItem>
              <SelectItem value="brand">Brand</SelectItem>
              <SelectItem value="blog">Blog</SelectItem>
              <SelectItem value="blog-post">Blog post</SelectItem>
              <SelectItem value="external">External</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Open in</Label>
          <Select
            value={item.target}
            onValueChange={(value) =>
              onChange({ target: value as MenuItem["target"] })
            }
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_self">Same tab</SelectItem>
              <SelectItem value="_blank">New tab</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Description</Label>
        <Textarea
          className="mt-1"
          rows={2}
          value={item.description || ""}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>
      <div>
        <Label>Badge text</Label>
        <Input
          className="mt-1"
          placeholder="New, Sale..."
          value={item.badge || ""}
          onChange={(event) => onChange({ badge: event.target.value })}
        />
      </div>
      <ImageUploadField
        id={`menu-item-image-${pathKey(path)}`}
        label="Icon / image"
        value={item.image || ""}
        onChange={(value) => onChange({ image: value })}
        previewAlt={item.label || "Menu item image"}
        previewClassName="h-full w-full object-contain"
      />
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label className="m-0">Featured</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            The first featured item with an image becomes the right-side panel.
          </p>
        </div>
        <Switch
          checked={!!item.isFeatured}
          onCheckedChange={(value) => onChange({ isFeatured: value })}
        />
      </div>
    </div>
  );
}

const MEGA_LEVELS = [
  {
    role: "Category",
    hint: "A row in the left rail. Hovering it opens this category's panel.",
  },
  {
    role: "Column",
    hint: "A column heading inside the panel.",
  },
  {
    role: "Link",
    hint: "A link under its group heading. This is the last level.",
  },
] as const;

/**
 * One inspector, three shapes. The level a merchant picked decides which
 * fields exist and which budget is quoted back, so nothing renders a control
 * the storefront would ignore at that depth.
 */
function MegaItemFields({
  item,
  ancestors,
  depth,
  path,
  locale,
  onChange,
}: {
  item: MenuItem;
  /** Root-to-parent chain, so the panel can quote the category's budget. */
  ancestors: MenuItem[];
  depth: number;
  path: number[];
  locale: string;
  onChange: (patch: Partial<MenuItem>) => void;
}) {
  const level = MEGA_LEVELS[Math.min(depth, MEGA_LEVELS.length) - 1];
  const isCategory = depth === 1;
  const isColumn = depth === 2;
  const isLink = depth === 3;
  const promoMode = getMegaPromoMode(item);

  // Every number on this panel belongs to the category at the top of the
  // chain — never to the item's immediate parent, which for a link is a
  // column and has no budget of its own.
  const category = isCategory ? item : ancestors[0] || null;
  const budget = getMegaCategoryBudget(category);
  const columnCount = (category?.children || []).length;

  const showsSideBanner = isCategory && promoMode === "side";
  const showsBottomCards = isCategory && promoMode === "bottom";

  const linkCount = (item.children || []).length;
  const columnIndex = isColumn ? path[1] ?? 0 : -1;
  const linkIndex = isLink ? path[2] ?? 0 : -1;
  const isParkedColumn = isColumn && columnIndex >= budget.groupLimit;
  const isPastFold = isLink && linkIndex >= budget.linkLimit;
  const hiddenLinks = Math.max(linkCount - budget.linkLimit, 0);
  // Sync stamps its own resource type, so anything else was typed in here.
  const isSynced = item.type === "category";

  const trail = [...ancestors, item]
    .map((node) => node.label.trim() || "Untitled")
    .join(" \u203a ");

  return (
    <div className="space-y-4">
      <div className="min-w-0 space-y-1 border-b pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          {level.role}
        </p>
        <p className="truncate text-[15px] font-semibold leading-tight">
          {item.label.trim() || "Untitled"}
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {isCategory ? "Row in the header rail \u00b7 opens this panel" : trail}
        </p>
        {isCategory ? (
          <span
            className={cn(
              "mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
              isSynced
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {isSynced ? "Synced from Categories" : "Added by hand"}
          </span>
        ) : null}
      </div>

      <div>
        <Label>{isLink ? "Link text" : `${level.role} name`} *</Label>
        <Input
          className="mt-1"
          value={item.label}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </div>

      <div>
        <Label>Links to</Label>
        <div className="relative mt-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={item.url}
            placeholder="/products?category=phones"
            onChange={(event) => onChange({ url: event.target.value })}
          />
        </div>
      </div>

      <ResourcePicker
        currentType={item.type}
        onPick={(resource) =>
          onChange({
            label: resource.label,
            url: resource.url,
            type: resource.type,
            target: resource.url.startsWith("http") ? "_blank" : "_self",
          })
        }
      />

      {isLink ? (
        <div>
          <Label>Badge</Label>
          <Input
            className="mt-1"
            placeholder="New, Sale..."
            value={item.badge || ""}
            onChange={(event) => onChange({ badge: event.target.value })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Small pill beside the link. Leave empty for none.
          </p>
        </div>
      ) : null}

      {isCategory ? (
        <PanelLayoutPicker
          value={promoMode}
          onChange={(value) => onChange({ promoMode: value })}
        />
      ) : null}

      {isCategory ? (
        <BudgetPanel
          rows={[
            { label: "Grid", value: `${budget.columns} \u00d7 ${budget.rows}` },
            {
              label: "Columns drawn",
              value: `${Math.min(columnCount, budget.groupLimit)} / ${budget.groupLimit}`,
            },
            { label: "Links per column", value: `${budget.linkLimit}` },
            {
              label: "Parked",
              value: `${Math.max(columnCount - budget.groupLimit, 0)}`,
              warn: columnCount > budget.groupLimit,
            },
          ]}
        />
      ) : null}

      {isColumn ? (
        <BudgetPanel
          rows={[
            {
              label: "Links in this column",
              value: `${linkCount} / ${budget.linkLimit}`,
              warn: linkCount > budget.linkLimit,
            },
            {
              label: "Column position",
              value: isParkedColumn
                ? "parked"
                : `${columnIndex + 1} of ${budget.groupLimit}`,
              warn: isParkedColumn,
            },
            {
              label: "Budget set by",
              value:
                MEGA_PROMO_MODES.find(
                  (mode) => mode.value === getMegaPromoMode(category),
                )?.label || "No promo",
            },
          ]}
        />
      ) : null}

      {isLink ? (
        <BudgetPanel
          rows={[
            {
              label: "Position in column",
              value: `${linkIndex + 1} of ${budget.linkLimit}`,
              warn: isPastFold,
            },
          ]}
        />
      ) : null}

      {/* Both promo modes hand off to the same block: it owns the slots, the
          AI Studio wiring each frame needs, and the notes that say what the
          storefront will draw from what is filled in. */}
      {showsSideBanner || showsBottomCards ? (
        <MegaPromoSlots
          item={item}
          path={path}
          locale={locale}
          mode={showsSideBanner ? "side" : "bottom"}
          onChange={onChange}
        />
      ) : null}

      {isParkedColumn ? (
        <InspectorWarning>
          {`Past the panel's ${budget.groupLimit} slots — saved, but not drawn. Drag it up, or use “Move into panel”.`}
        </InspectorWarning>
      ) : null}

      {isColumn && hiddenLinks > 0 ? (
        <InspectorWarning>
          {hiddenLinks === 1
            ? "1 link sits below the fold. It stays saved and reachable through “View all”."
            : `${hiddenLinks} links sit below the fold. They stay saved and reachable through “View all”.`}
        </InspectorWarning>
      ) : null}

      {isPastFold ? (
        <InspectorWarning>
          {`Position ${linkIndex + 1} is below the fold of a ${budget.linkLimit}-link column. Drag it higher to have it drawn.`}
        </InspectorWarning>
      ) : null}

      <div>
        <Label>Open in</Label>
        <Select
          value={item.target}
          onValueChange={(value) =>
            onChange({ target: value as MenuItem["target"] })
          }
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_self">Same tab</SelectItem>
            <SelectItem value="_blank">New tab</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * The promo choice is a layout decision — a side banner costs two of the four
 * columns — so it is picked from three drawings of the resulting panel rather
 * than from a dropdown that hides the trade until after the click.
 */
function PanelLayoutPicker({
  value,
  onChange,
}: {
  value: MegaPromoMode;
  onChange: (value: MegaPromoMode) => void;
}) {
  const hint = MEGA_PROMO_MODES.find((mode) => mode.value === value)?.hint;

  return (
    <div>
      <Label>Panel layout</Label>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        {MEGA_PROMO_MODES.map((mode) => {
          const isActive = mode.value === value;
          return (
            <button
              key={mode.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(mode.value)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-2 text-[11px] font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                  : "text-muted-foreground hover:border-primary/40",
              )}
            >
              <LayoutDiagram mode={mode.value} isActive={isActive} />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>
      {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function LayoutDiagram({
  mode,
  isActive,
}: {
  mode: MegaPromoMode;
  isActive: boolean;
}) {
  const frame = cn(
    "grid h-8 w-full gap-0.5 rounded p-1",
    isActive ? "bg-background" : "bg-muted",
  );
  const cell = "block rounded-[2px] bg-muted-foreground/30";
  const promo = "block rounded-[2px] bg-primary";

  if (mode === "side") {
    return (
      <span className={cn(frame, "grid-cols-[1fr_1fr_0.8rem]")} aria-hidden>
        <i className={cell} />
        <i className={cell} />
        <i className={promo} />
      </span>
    );
  }

  if (mode === "bottom") {
    return (
      <span
        className={cn(frame, "grid-cols-4 grid-rows-[1fr_0.45rem]")}
        aria-hidden
      >
        <i className={cell} />
        <i className={cell} />
        <i className={cell} />
        <i className={cell} />
        <i className={cn(promo, "col-span-2")} />
        <i className={cn(promo, "col-span-2")} />
      </span>
    );
  }

  return (
    <span className={cn(frame, "grid-cols-4")} aria-hidden>
      <i className={cell} />
      <i className={cell} />
      <i className={cell} />
      <i className={cell} />
    </span>
  );
}

function BudgetPanel({
  rows,
}: {
  rows: { label: string; value: string; warn?: boolean }[];
}) {
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
        >
          <span>{row.label}</span>
          <b
            className={cn(
              "font-mono font-semibold tabular-nums",
              row.warn ? "text-amber-600" : "text-foreground",
            )}
          >
            {row.value}
          </b>
        </div>
      ))}
    </div>
  );
}

function InspectorWarning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

export function ItemTree({
  items,
  path,
  query,
  activePath,
  collapsedIds,
  onToggleCollapse,
  onSelect,
  onEdit,
  onRemove,
  onMove,
  onDuplicate,
  onReorder,
  onAddChild,
}: {
  items: MenuItem[];
  path: number[];
  query: string;
  activePath: number[] | null;
  collapsedIds: Set<string>;
  onToggleCollapse: (key: string) => void;
  onSelect: (path: number[]) => void;
  onEdit: (path: number[]) => void;
  onRemove: (path: number[]) => void;
  onMove: (path: number[], dir: "up" | "down") => void;
  onDuplicate: (path: number[]) => void;
  onReorder: (parentPath: number[], fromIndex: number, toIndex: number) => void;
  onAddChild: (path: number[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const sortableIds = items.map((_, idx) => pathKey([...path, idx]));
  const dragDisabled = !!query;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = sortableIds.indexOf(String(active.id));
    const toIndex = sortableIds.indexOf(String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    onReorder(path, fromIndex, toIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <ul className={cn("space-y-1", path.length > 0 && "ml-6 mt-1 border-l pl-4")}>
          {items.map((it, idx) => {
            const childPath = [...path, idx];
            const isVisible = itemOrDescendantMatches(it, query);
            if (!isVisible) return null;
            return (
              <SortableMenuItemRow
                key={`${path.join("-")}-${idx}-${it._id || it.label}`}
                id={pathKey(childPath)}
                item={it}
                childPath={childPath}
                query={query}
                activePath={activePath}
                collapsedIds={collapsedIds}
                onToggleCollapse={onToggleCollapse}
                dragDisabled={dragDisabled}
                onSelect={onSelect}
                onEdit={onEdit}
                onRemove={onRemove}
                onMove={onMove}
                onDuplicate={onDuplicate}
                onReorder={onReorder}
                onAddChild={onAddChild}
              />
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableMenuItemRow({
  id,
  item,
  childPath,
  query,
  activePath,
  collapsedIds,
  onToggleCollapse,
  dragDisabled,
  onSelect,
  onEdit,
  onRemove,
  onMove,
  onDuplicate,
  onReorder,
  onAddChild,
}: {
  id: string;
  item: MenuItem;
  childPath: number[];
  query: string;
  activePath: number[] | null;
  collapsedIds: Set<string>;
  onToggleCollapse: (key: string) => void;
  dragDisabled: boolean;
  onSelect: (path: number[]) => void;
  onEdit: (path: number[]) => void;
  onRemove: (path: number[]) => void;
  onMove: (path: number[], dir: "up" | "down") => void;
  onDuplicate: (path: number[]) => void;
  onReorder: (parentPath: number[], fromIndex: number, toIndex: number) => void;
  onAddChild: (path: number[]) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: dragDisabled });
  const hasChildren = (item.children || []).length > 0;
  const isActive = pathsEqual(childPath, activePath);
  const collapseKey = item._id ?? pathKey(childPath);
  // A search query force-expands every branch so matches stay visible.
  const isCollapsed = hasChildren && !query && collapsedIds.has(collapseKey);
  // Mega menus are built in the three-pane builder now, so this tree only ever
  // renders the free-form locations — no depth roles or caps to explain.
  const roleLabel = `L${childPath.length}`;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li ref={setNodeRef} style={style} className={cn(isDragging && "relative z-10")}>
      <div
        className={cn(
          "group flex items-center justify-between gap-2 rounded-md border bg-card px-2 py-2",
          isActive && "border-primary bg-primary/5 shadow-sm",
          isDragging && "opacity-70 shadow-md",
        )}
      >
        <button
          type="button"
          disabled={dragDisabled}
          {...attributes}
          {...listeners}
          className="grid h-8 w-6 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          title={dragDisabled ? "Clear search to drag" : "Drag to reorder"}
          aria-label={`Drag ${item.label || "menu item"} to reorder`}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleCollapse(collapseKey)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            title={isCollapsed ? "Expand" : "Collapse"}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${item.label || "menu item"}`}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="h-6 w-6 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onSelect(childPath)}
        >
          <span className="truncate text-sm font-medium">{item.label}</span>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {roleLabel}
          </Badge>
          <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
            {item.type === "blog-post" ? "Post" : item.type}
          </Badge>
          {item.image || item.icon ? (
            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          {item.isFeatured ? (
            <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />
          ) : null}
          {item.badge ? (
            <Badge variant="secondary" className="text-[10px]">
              {item.badge}
            </Badge>
          ) : null}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2"
            onClick={() => onAddChild(childPath)}
            title="Child"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden text-xs xl:inline">Child</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="More actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(childPath)}>
                <Pencil className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onMove(childPath, "up")}>
                <ArrowUp className="h-4 w-4" />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onMove(childPath, "down")}>
                <ArrowDown className="h-4 w-4" />
                Move down
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(childPath)}>
                <Copy className="h-4 w-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onRemove(childPath)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {hasChildren && !isCollapsed ? (
        <ItemTree
          items={item.children}
          path={childPath}
          query={query}
          activePath={activePath}
          collapsedIds={collapsedIds}
          onToggleCollapse={onToggleCollapse}
          onSelect={onSelect}
          onEdit={onEdit}
          onRemove={onRemove}
          onMove={onMove}
          onDuplicate={onDuplicate}
          onReorder={onReorder}
          onAddChild={onAddChild}
        />
      ) : null}
    </li>
  );
}

