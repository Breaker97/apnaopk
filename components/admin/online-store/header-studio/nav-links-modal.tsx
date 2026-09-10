"use client";

import { useRef, useState } from "react";
import {
  CornerDownRight,
  GripVertical,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
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
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LinkGlyph } from "@/lib/site-config/header-link-glyphs";
import { AppImage } from "@/components/ui/app-image";
import { toast } from "@/components/ui/toast-notification";
import { uploadFile } from "@/lib/media-upload/direct-upload";
import {
  MAX_HEADER_NAV_LINKS,
  type HeaderNavLink,
  type HeaderNavMenu,
  HEADER_LINK_GLYPHS,
  glyphIcon,
  linkGlyph,
} from "@/lib/site-config/header-layout";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { NativeSelect } from "@/components/ui/native-select";
import {
  FieldCaption,
  LinkTargetField,
  SourcePicker,
  sourceOf,
  useCatalogue,
  type Catalogue,
  type LinkSource,
} from "@/components/admin/online-store/header-studio/link-source";
import { StudioModal } from "@/components/admin/online-store/header-studio/studio-modal";
import { cn } from "@/lib/utils";

/**
 * The Figma "Links" modal: the nav item's links, one level of nesting.
 *
 * It is the Tags modal's twin — same card, same numbering, same catalogue
 * pickers — because "a label and where it points" is the same job in both,
 * and a merchant who has filled one in should not have to learn the other.
 * What it adds is the glyph and the sub-links, which a tag has no room for.
 *
 * Edits apply straight to the layout tree: there is no separate save,
 * because the studio's Publish is the only save on the screen.
 */
export function NavLinksModal({
  open,
  onOpenChange,
  links,
  onChange,
  tSafe,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: HeaderNavLink[];
  onChange: (links: HeaderNavLink[]) => void;
  tSafe: TSafe;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const catalogue = useCatalogue(open);

  const updateLink = (id: string, patch: Partial<HeaderNavLink>) => {
    onChange(
      links.map((link) => (link.id === id ? { ...link, ...patch } : link)),
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = links.findIndex((link) => link.id === active.id);
    const to = links.findIndex((link) => link.id === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(links, from, to));
  };

  return (
    <StudioModal
      open={open}
      onOpenChange={onOpenChange}
      title={tSafe("admin.headerStudio.links.title", "Links")}
      description={tSafe(
        "admin.headerStudio.links.description",
        "Drag to reorder. A link with sub-links opens as a dropdown on the storefront.",
      )}
      action={
        <Button
          type="button"
          disabled={links.length >= MAX_HEADER_NAV_LINKS}
          onClick={() => onChange([...links, newLink()])}
        >
          {tSafe("admin.headerStudio.links.addLink", "Add Link")}
          <Plus className="h-4 w-4" />
        </Button>
      }
      footer={
        <span className="text-xs text-muted-foreground">
          {tSafe("admin.headerStudio.links.count", "{count} of {max} links", {
            count: links.length,
            max: MAX_HEADER_NAV_LINKS,
          })}
        </span>
      }
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={links.map((link) => link.id)}
          strategy={verticalListSortingStrategy}
        >
          <div
            className={cn(
              "space-y-3 rounded-[12px] border bg-muted/50 p-3",
              links.length === 0 && "hidden",
            )}
          >
            {links.map((link, index) => (
              <SortableLinkCard
                key={link.id}
                link={link}
                index={index}
                catalogue={catalogue}
                tSafe={tSafe}
                onChange={(patch) => updateLink(link.id, patch)}
                onRemove={() =>
                  onChange(links.filter((entry) => entry.id !== link.id))
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {links.length === 0 ? (
        <p className="rounded-[4px] border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {tSafe(
            "admin.headerStudio.links.empty",
            "No links yet. Add links like Phone, Camera or Shoes.",
          )}
        </p>
      ) : null}
    </StudioModal>
  );
}

function newLink(): HeaderNavLink {
  return {
    id: crypto.randomUUID(),
    label: "",
    url: "",
    icon: "",
    description: "",
    menu: "list",
    children: [],
  };
}

function SortableLinkCard({
  link,
  index,
  catalogue,
  onChange,
  onRemove,
  tSafe,
}: {
  link: HeaderNavLink;
  index: number;
  catalogue: Catalogue;
  onChange: (patch: Partial<HeaderNavLink>) => void;
  onRemove: () => void;
  tSafe: TSafe;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: link.id });

  const updateChild = (id: string, patch: Partial<HeaderNavLink>) => {
    onChange({
      children: link.children.map((child) =>
        child.id === id ? { ...child, ...patch } : child,
      ),
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "overflow-hidden rounded-[12px] border border-border/80 bg-card shadow-sm",
        isDragging && "opacity-70 ring-2 ring-primary/40",
      )}
    >
      <LinkCardBody
        link={link}
        catalogue={catalogue}
        tSafe={tSafe}
        onChange={onChange}
        onRemove={onRemove}
        badge={
          <>
            <button
              type="button"
              ref={setActivatorNodeRef}
              aria-label={tSafe(
                "admin.headerStudio.links.reorder",
                "Reorder link",
              )}
              className="cursor-grab text-muted-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
              {index + 1}
            </span>
          </>
        }
      />

      {/* The dropdown this link opens, one level deep — deeper renders
          nowhere, so the normalizer drops it. */}
      {link.children.length ? (
        <div className="space-y-2 border-t bg-muted/30 p-3 pl-6">
          {/* The design the dropdown wears. Grid turns each sub-link into a
              tile with its image and blurb, which is what a Collections
              menu wants and what a column of labels throws away. */}
          <div className="flex items-center justify-between gap-3 pb-1">
            <FieldCaption>
              {tSafe("admin.headerStudio.links.menu", "Dropdown design")}
            </FieldCaption>
            <NativeSelect
              size="sm"
              value={link.menu}
              aria-label={tSafe(
                "admin.headerStudio.links.menu",
                "Dropdown design",
              )}
              onChange={(event) =>
                onChange({ menu: event.target.value as HeaderNavMenu })
              }
              className="w-36"
            >
              <option value="list">
                {tSafe("admin.headerStudio.links.menuList", "List")}
              </option>
              <option value="grid">
                {tSafe("admin.headerStudio.links.menuGrid", "Image grid")}
              </option>
            </NativeSelect>
          </div>
          {link.children.map((child, childIndex) => (
            <div
              key={child.id}
              className="overflow-hidden rounded-[8px] border border-border/70 bg-card"
            >
              <LinkCardBody
                link={child}
                catalogue={catalogue}
                tSafe={tSafe}
                compact
                withDescription={link.menu === "grid"}
                onChange={(patch) => updateChild(child.id, patch)}
                onRemove={() =>
                  onChange({
                    children: link.children.filter(
                      (entry) => entry.id !== child.id,
                    ),
                  })
                }
                badge={
                  <>
                    <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground/70" />
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                      {index + 1}.{childIndex + 1}
                    </span>
                  </>
                }
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="border-t px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-1 text-xs font-semibold"
          onClick={() => onChange({ children: [...link.children, newLink()] })}
        >
          {tSafe("admin.headerStudio.links.addSubLink", "Add sub-link")}
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * One link's card — the header strip (glyph, name, source, trash) over the
 * label and target fields. Shared by a top-level link and a sub-link, which
 * differ only in how they are numbered and how much room they have.
 */
function LinkCardBody({
  link,
  catalogue,
  onChange,
  onRemove,
  badge,
  compact,
  withDescription,
  tSafe,
}: {
  link: HeaderNavLink;
  catalogue: Catalogue;
  onChange: (patch: Partial<HeaderNavLink>) => void;
  onRemove: () => void;
  badge: React.ReactNode;
  compact?: boolean;
  /** The grid design draws a line of copy under the label; the list does not. */
  withDescription?: boolean;
  tSafe: TSafe;
}) {
  // Seeded from the url, then owned by the row: a merchant who switches to
  // "Category" and has not picked one yet still sees the category list.
  const [source, setSource] = useState<LinkSource>(() => sourceOf(link.url));
  const labelCaption = tSafe("admin.headerStudio.links.label", "Label");
  const linkCaption = tSafe("admin.headerStudio.tags.linksTo", "Links to");

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 border-b px-3 py-2",
          compact ? "bg-muted/20" : "bg-muted/40",
        )}
      >
        {badge}
        <IconUploadButton
          icon={link.icon}
          tSafe={tSafe}
          onChange={(icon) => onChange({ icon })}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {link.label.trim() ||
            tSafe("admin.headerStudio.links.untitled", "Untitled")}
        </span>

        <SourcePicker
          value={source}
          tSafe={tSafe}
          compact={compact}
          onChange={(next) => {
            setSource(next);
            // A link from another source no longer applies.
            if (next !== sourceOf(link.url)) onChange({ url: "" });
          }}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={tSafe("admin.headerStudio.links.remove", "Remove link")}
          onClick={onRemove}
          className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <label className="flex min-w-0 flex-col gap-1">
          <FieldCaption>{labelCaption}</FieldCaption>
          <Input
            value={link.label}
            placeholder={tSafe(
              "admin.headerStudio.links.labelPlaceholder",
              "e.g. Collections",
            )}
            onChange={(event) => onChange({ label: event.target.value })}
            className="h-9"
          />
        </label>
        <div className="flex min-w-0 flex-col gap-1">
          <FieldCaption>{linkCaption}</FieldCaption>
          <LinkTargetField
            source={source}
            url={link.url}
            label={link.label}
            catalogue={catalogue}
            tSafe={tSafe}
            onChange={onChange}
          />
        </div>
        {withDescription ? (
          <label className="flex min-w-0 flex-col gap-1 sm:col-span-2">
            <FieldCaption>
              {tSafe("admin.headerStudio.links.blurb", "Description")}
            </FieldCaption>
            <Input
              value={link.description}
              maxLength={160}
              placeholder={tSafe(
                "admin.headerStudio.links.blurbPlaceholder",
                "One line under the label — optional",
              )}
              onChange={(event) =>
                onChange({ description: event.target.value })
              }
              className="h-9"
            />
          </label>
        ) : null}
      </div>
    </>
  );
}

/**
 * The link's icon: one of the built-in glyphs, or an uploaded image. The
 * glyphs come first because they are what utility links wear — an order
 * box, a feed, a phone — and an upload is the exception for a brand mark.
 */
function IconUploadButton({
  icon,
  onChange,
  tSafe,
}: {
  icon: string;
  onChange: (icon: string) => void;
  tSafe: TSafe;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const glyph = linkGlyph(icon);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const result = await uploadFile(file, { customPath: "header/" });
      onChange(result.url);
    } catch {
      toast.error(
        tSafe("admin.headerStudio.links.uploadFailed", "Icon upload failed"),
      );
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="relative shrink-0">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={tSafe("admin.headerStudio.links.icon", "Link icon")}
            disabled={isUploading}
            className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-[4px] border bg-background text-muted-foreground hover:bg-muted"
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : glyph ? (
              <LinkGlyph glyph={glyph} className="h-4 w-4 text-foreground" />
            ) : icon ? (
              <AppImage
                src={icon}
                alt=""
                width={20}
                height={20}
                className="h-4 w-4 object-contain"
                fallback={<ImagePlus className="h-3.5 w-3.5" />}
              />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 space-y-2 p-2">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tSafe("admin.headerStudio.links.glyphs", "Built-in icons")}
          </p>
          <div className="grid grid-cols-5 gap-1">
            {HEADER_LINK_GLYPHS.map((key) => {
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={key}
                  onClick={() => onChange(glyphIcon(key))}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-[4px] border hover:bg-muted",
                    glyph === key && "border-primary bg-primary/10 text-primary",
                  )}
                >
                  <LinkGlyph glyph={key} className="h-4 w-4" />
                </button>
              );
            })}
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 flex-1 text-xs"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {tSafe("admin.headerStudio.links.uploadIcon", "Upload image")}
            </Button>
            {icon ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onChange("")}
              >
                {tSafe("admin.headerStudio.links.noIcon", "No icon")}
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
    </div>
  );
}
