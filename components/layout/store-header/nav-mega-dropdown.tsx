"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import type { HeaderMenuItem } from "@/lib/site-config/header-config";
import { splitMegaDropdown } from "@/lib/site-config/header-menu-panels";
import { cn } from "@/lib/utils";

/** Sweeping across the nav must not flash every panel on the way. */
const OPEN_DELAY = 90;
/** Room to cross from the label, down past the row's padding, into the panel. */
const CLOSE_DELAY = 160;

/**
 * A nav link whose dropdown is a whole menu — Lanvin's WOMEN: a panel the
 * width of the page, headed columns of links, and a picture at the end.
 *
 * The menu is a navigation menu linked to the link in the Header Studio;
 * `splitMegaDropdown` decides which of its items are columns and which are
 * pictures. The panel is portaled to the body and pinned under the HEADER,
 * not under the label: it spans the page, so it cannot hang off a trigger
 * that sits somewhere in the middle of a row — and a row with a backdrop
 * blur would otherwise become the containing block for a fixed panel and
 * clip it to the row.
 */
export function NavMegaDropdown({
  label,
  icon,
  labelStyle,
  items,
}: {
  label: ReactNode;
  icon?: ReactNode;
  labelStyle?: CSSProperties;
  items: HeaderMenuItem[];
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(0);
  const { columns, promos } = splitMegaDropdown(items);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  const measure = useCallback(() => {
    const header = triggerRef.current?.closest("header");
    const bottom = header?.getBoundingClientRect().bottom;
    if (typeof bottom === "number") setTop(Math.round(bottom));
  }, []);

  const show = (immediate = false) => {
    clearTimers();
    const run = () => {
      measure();
      setOpen(true);
    };
    if (immediate) run();
    else openTimer.current = setTimeout(run, OPEN_DELAY);
  };

  const hide = () => {
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };

  useEffect(() => clearTimers, []);

  // The panel is pinned to where the header's bottom edge WAS; once the page
  // moves that is wrong, and a menu is not what a scrolling shopper is doing.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (columns.length === 0 && promos.length === 0) return null;

  const panel = open ? (
    <div
      role="region"
      onMouseEnter={() => show(true)}
      onMouseLeave={hide}
      className="fixed inset-x-0 z-[60] border-t border-b border-border/60 bg-popover text-popover-foreground shadow-[0_24px_40px_-24px_rgba(15,23,42,0.18)] animate-in fade-in-0 slide-in-from-top-1 duration-150"
      style={{ top }}
    >
      <div className="container mx-auto flex gap-10 px-4 py-10">
        <div
          className="grid min-w-0 flex-1 gap-x-10 gap-y-8"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))`,
          }}
        >
          {columns.map((column, index) => (
            <div key={`${column.title}-${index}`} className="min-w-0">
              {column.href ? (
                <Link
                  href={column.href}
                  target={column.target}
                  onClick={() => setOpen(false)}
                  className="mb-4 block text-[11px] font-medium uppercase tracking-[0.14em] transition-opacity hover:opacity-70"
                >
                  {column.title}
                </Link>
              ) : (
                <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.14em]">
                  {column.title}
                </p>
              )}
              {column.links.length > 0 ? (
                <ul className="flex flex-col gap-2.5">
                  {column.links.map((link, linkIndex) => (
                    <li key={`${link.href}-${link.label}-${linkIndex}`}>
                      <Link
                        href={link.href}
                        target={link.target}
                        onClick={() => setOpen(false)}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>

        {promos.length > 0 ? (
          <div
            className={cn(
              "hidden shrink-0 gap-4 xl:flex",
              promos.length > 1 ? "w-[30rem]" : "w-[20rem]",
            )}
          >
            {promos.map((promo, index) => (
              <Link
                key={`${promo.image}-${index}`}
                href={promo.href}
                target={promo.target}
                onClick={() => setOpen(false)}
                className="group flex min-w-0 flex-1 flex-col gap-2"
              >
                <span className="relative block aspect-[4/5] overflow-hidden bg-muted">
                  <AppImage
                    src={promo.image}
                    alt={promo.label}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    sizes="320px"
                  />
                </span>
                {promo.label ? (
                  <span className="text-xs uppercase tracking-[0.12em]">
                    {promo.label}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onMouseEnter={() => show()}
        onMouseLeave={hide}
        onClick={() => (open ? setOpen(false) : show(true))}
        className="relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap transition-opacity hover:opacity-75"
        style={labelStyle}
      >
        {icon}
        {label}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 opacity-60 transition-transform",
            open && "rotate-180",
          )}
        />
        {/* The underline Lanvin draws under the open section. */}
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-2 left-0 h-px w-full origin-left bg-current transition-transform duration-200",
            open ? "scale-x-100" : "scale-x-0",
          )}
        />
      </button>
      {panel && typeof document !== "undefined"
        ? createPortal(panel, document.body)
        : null}
    </>
  );
}
