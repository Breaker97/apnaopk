"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, ArrowRight, Images } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const CLOSE_DELAY = 120;

/**
 * What to ask the image optimizer for behind a 56px tile.
 *
 * NOT 56. The tile is square and the art is cropped to fill it
 * (`object-cover`), while collection banners are wide — a 2:1 image has to
 * be scaled up by its aspect ratio before it covers a square, on top of the
 * screen's own pixel density. Asking for the tile's width served a file the
 * browser then enlarged ~1.75x, which is the blur. This asks for enough
 * that a banner up to about 2:1 still lands sharp, and it is stated as a
 * flat width rather than the tile's own: a browser that resolves the srcset
 * before it knows the pixel density would otherwise pick the 1x candidate
 * and leave the tile soft on exactly the screens this is for.
 */
const TILE_SIZES = "256px";
/** The intrinsic-ratio hint; `sizes` above is what picks the file. */
const TILE_SOURCE_PX = 512;

interface CollectionsMenuEntry {
  id: string;
  title: string;
  href: string;
  image: string;
  description: string;
}

/**
 * The header's Collections menu: the store's own collections as a grid of
 * thumbnails. Unlike a nav link's dropdown, nothing here is typed by hand —
 * the entries come from the catalogue, so a collection published this
 * morning is in the header this morning.
 *
 * Opens on hover and on click, and closes a beat after the pointer leaves,
 * so crossing the gap from the trigger into the panel does not shut it.
 */
export function CollectionsMenu({
  label,
  labelStyle,
  showChevron,
  columns,
  showDescription,
  collections,
  viewAllHref,
  viewAllLabel,
}: {
  label: string;
  labelStyle?: CSSProperties;
  showChevron: boolean;
  columns: number;
  showDescription: boolean;
  collections: CollectionsMenuEntry[];
  /** Empty hides the row. */
  viewAllHref: string;
  viewAllLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };

  // Never more columns than there are collections: three tracks holding two
  // tiles leaves a hole where the third should be.
  const cols = Math.max(1, Math.min(columns, collections.length));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap transition-opacity hover:opacity-75"
          style={labelStyle}
        >
          {label}
          {showChevron ? (
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 opacity-60 transition-transform",
                open && "rotate-180",
              )}
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="w-[min(92vw,var(--collections-w))] rounded-t-none rounded-b-md border-0 bg-popover p-3 text-popover-foreground shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
        style={{ "--collections-w": `${cols * 250}px` } as CSSProperties}
      >
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {collections.map((collection) => (
            <Link
              key={collection.id}
              href={collection.href}
              onClick={() => setOpen(false)}
              className="group/tile flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted"
            >
              <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
                {collection.image ? (
                  <AppImage
                    src={collection.image}
                    alt=""
                    width={TILE_SOURCE_PX}
                    height={TILE_SOURCE_PX}
                    sizes={TILE_SIZES}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Images className="h-5 w-5 text-muted-foreground" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                {/* Two lines: a collection called "Headphones & Audio
                    Accessories" cut to "Headphones & Au…" is the failure a
                    thumbnail menu exists to avoid. */}
                <span className="line-clamp-2 text-sm font-semibold leading-snug transition-colors group-hover/tile:text-primary">
                  {collection.title}
                </span>
                {showDescription && collection.description ? (
                  <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                    {collection.description}
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </div>
        {viewAllHref ? (
          <Link
            href={viewAllHref}
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border-t border-border/60 px-3 pb-1 pt-3 text-sm font-semibold transition-colors hover:text-primary"
          >
            {viewAllLabel}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
