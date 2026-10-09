"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * Floating "back to top" control for the storefront.
 *
 * It appears once the shopper has scrolled roughly a screenful — long
 * category grids and product pages are the reason it exists, and a button
 * that shows up after a nudge on a short page is just clutter. The threshold
 * is viewport-relative so it lands at the same visual moment on a phone and
 * on a desktop monitor.
 *
 * Lives in the layout's "extras" chrome group, so the focused-checkout mode
 * hides it along with the rest of the floating chrome. It shares the
 * bottom-end corner with the AI assistant's FAB; when that one is on and
 * pinned to the same side, a `:has()` rule in globals.css keyed on
 * `data-store-fab` stacks this button above it.
 */
export function ScrollToTop() {
  const t = useTranslations("common");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setVisible(window.scrollY > window.innerHeight * 0.9);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // The page can already be scrolled on mount — a reload restores the
    // offset, and a hash link lands mid-page without ever firing `scroll`.
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const scrollToTop = () => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      data-store-fab="scroll-top"
      onClick={scrollToTop}
      aria-label={t("scrollToTop")}
      // Stays mounted so it can fade rather than pop, and `inert` keeps the
      // faded-out button off the tab order and out of the a11y tree.
      inert={!visible}
      className={cn(
        // Cleared above the mobile bottom nav (its bar plus the safe-area
        // inset), which only exists below `xl`. One step behind the
        // assistant FAB's z-50 — that one is the primary action here.
        "fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] end-4 z-40 xl:bottom-6 sm:end-6",
        "flex size-11 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-lg backdrop-blur",
        "transition-[opacity,transform] duration-200 hover:bg-muted motion-reduce:transition-none",
        visible ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  );
}
