"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AppImage } from "@/components/ui/app-image";
import { LinkGlyphIcon } from "@/lib/site-config/header-link-glyphs";
import { linkGlyph } from "@/lib/site-config/header-layout";
import type {
  HeaderNavLink,
  HeaderNavMenu,
} from "@/lib/site-config/header-layout";
import { cn } from "@/lib/utils";

const CLOSE_DELAY = 120;

/** See collections-menu.tsx: a square tile cropping wide art needs more
 * width than the tile itself, before density is even counted. */
const TILE_SIZES = "256px";
const TILE_SOURCE_PX = 512;

/**
 * A nav link with sub-links: the label as a trigger, the children in a
 * panel beneath it. Opens on hover and on click, and closes a beat after
 * the pointer leaves so crossing the gap into the panel does not shut it.
 *
 * Two designs, chosen per link in the Header Studio: the plain LIST, and
 * the GRID — every child a tile with its artwork and a line of copy, for a
 * Collections menu where the pictures are the navigation.
 */
export function NavDropdown({
  label,
  children,
  hrefFor,
  labelStyle,
  icon,
  menu = "list",
  onNavigate,
}: {
  label: ReactNode;
  children: HeaderNavLink[];
  hrefFor: (url: string) => string;
  labelStyle?: CSSProperties;
  icon?: ReactNode;
  /** The design the panel wears — see the component doc. */
  menu?: HeaderNavMenu;
  onNavigate?: () => void;
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

  const isGrid = menu === "grid";
  // Two columns for a short menu, three once it would otherwise run down the
  // page. Capped there: a four-across panel outgrows the header on a laptop.
  const columns = children.length <= 4 ? 2 : 3;

  const close = () => {
    setOpen(false);
    onNavigate?.();
  };

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
          {icon}
          {label}
          <ChevronDown
            className={`h-3.5 w-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        onMouseEnter={show}
        onMouseLeave={hide}
        className={cn(
          "rounded-t-none rounded-b-md border-0 bg-popover text-popover-foreground shadow-[0_18px_40px_rgba(15,23,42,0.12)]",
          isGrid
            ? "w-[min(90vw,var(--nav-grid-w))] p-3"
            : "w-56 p-2",
        )}
        style={
          isGrid
            ? ({ "--nav-grid-w": `${columns * 250}px` } as CSSProperties)
            : undefined
        }
      >
        {isGrid ? (
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {children.map((child) => (
              <Link
                key={child.id}
                href={hrefFor(child.url)}
                onClick={close}
                className="group/tile flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted"
              >
                <NavTileArt icon={child.icon} label={child.label} />
                <span className="flex min-w-0 flex-col">
                  {/* Two lines, not one: a collection called "Headphones &
                      Audio Accessories" truncated to "Headphones & Au…" is
                      the failure this design exists to avoid. */}
                  <span className="line-clamp-2 text-sm font-semibold leading-snug transition-colors group-hover/tile:text-primary">
                    {child.label || "Link"}
                  </span>
                  {child.description ? (
                    <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                      {child.description}
                    </span>
                  ) : null}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          children.map((child) => (
            <Link
              key={child.id}
              href={hrefFor(child.url)}
              onClick={close}
              className="flex items-center rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              {child.label || "Link"}
            </Link>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A tile's artwork: the link's uploaded image, its built-in glyph, or — with
 * neither — the first letter on a tinted plate. A missing picture must not
 * collapse the row to a different height from its neighbours.
 */
function NavTileArt({ icon, label }: { icon: string; label: string }) {
  const glyph = linkGlyph(icon);
  const box =
    "grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-muted";

  if (icon && !glyph) {
    return (
      <span className={box}>
        <AppImage
          src={icon}
          alt=""
          width={TILE_SOURCE_PX}
          height={TILE_SOURCE_PX}
          sizes={TILE_SIZES}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }
  if (glyph) {
    return (
      <span className={box}>
        <LinkGlyphIcon icon={icon} className="h-5 w-5 text-muted-foreground" />
      </span>
    );
  }
  return (
    <span className={cn(box, "text-base font-semibold text-muted-foreground")}>
      {(label.trim()[0] ?? "•").toUpperCase()}
    </span>
  );
}
