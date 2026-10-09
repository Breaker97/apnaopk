"use client";

import { useEffect, useRef, useState } from "react";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { purchaseButtonCss } from "@/lib/storefront/sections/product-detail-css";
import { useProductPurchase } from "./product-purchase";
import { QuantityStepper, QuoteButton, QuotePrice } from "./product-purchase-rows";

type ProductDetailsSection = "description" | "specifications" | "reviews";

/**
 * Where a tab leads, looked up from the strip's own home. The specification
 * table sits in the strip's section, or in its own `product-specification`
 * section when the template carries one — so it falls back to the id that
 * section publishes.
 */
function findSection(
  home: HTMLElement | null,
  target: ProductDetailsSection,
): HTMLElement | null {
  if (target === "reviews") return document.getElementById("reviews");
  const page = home?.closest("section");
  return (
    page?.querySelector<HTMLElement>(`[data-section="${target}"]`) ??
    (target === "specifications"
      ? document.getElementById("specifications")
      : null)
  );
}

/**
 * The Description / Specifications / Reviews strip under the buy box.
 *
 * It pins under the storefront header when its home slot scrolls past it —
 * and the product/name (left) and price/CTA (right) only exist while pinned.
 * Its pinned life is decoupled from its DOM parent on purpose: reviews render
 * as their own section further down the page and the strip must ride until
 * THAT section's end, which CSS sticky cannot do across section boundaries.
 * So while pinned the strip is position:fixed at its home slot's measured
 * left/width (the slot keeps its height so nothing jumps), and once the
 * reviews section's bottom passes the strip it slides away. Band changes go
 * through state; per-frame geometry writes go straight to the element.
 *
 * The sections it names are drawn on the server around it, so it finds them
 * in the page: the description and the inline specification table by their
 * `data-section`, a standalone specification section and the reviews by id.
 */
export function ProductSectionTabs({
  sectionTargets,
}: {
  /**
   * Which sections the strip may send the shopper to, besides the
   * description. A section the page does not draw gets no tab.
   */
  sectionTargets: { specifications: boolean; reviews: boolean };
}) {
  const {
    product,
    detail,
    tf,
    formatDisplayPrice,
    displayedPrice,
    quoteOnly,
    cartButtonText,
    buyButtonText,
    purchaseShut,
    handleAddToCart,
    handleBuyNow,
  } = useProductPurchase();
  const { visibility: vis, style: sty } = detail;
  const homeRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  const [released, setReleased] = useState(false);
  const [activeSection, setActiveSection] =
    useState<ProductDetailsSection>("description");

  useEffect(() => {
    const home = homeRef.current;
    const bar = barRef.current;
    if (!home || !bar) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const header = document.querySelector<HTMLElement>(
        "[data-sticky-header]",
      );
      const offset = header?.offsetHeight ?? 64;
      const homeRect = home.getBoundingClientRect();
      const barHeight = bar.offsetHeight;
      const isStuck = homeRect.top <= offset;
      // The strip rides only as far as the reviews section. A template
      // without one falls back to the details section — the old boundary.
      const bound =
        document.getElementById("reviews") ?? home.closest("section");
      const isReleased = Boolean(
        isStuck &&
        bound &&
        bound.getBoundingClientRect().bottom <= offset + barHeight,
      );

      if (isStuck) {
        // The bar's -mx-4 bleed still applies under position:fixed, so the
        // measured slot width is widened by both margins to keep the fixed
        // box exactly where the in-flow box was.
        const marginX = parseFloat(getComputedStyle(bar).marginLeft) || 0;
        home.style.height = `${barHeight}px`;
        bar.style.position = "fixed";
        bar.style.top = `${offset}px`;
        bar.style.left = `${homeRect.left}px`;
        bar.style.width = `${homeRect.width - 2 * marginX}px`;
      } else {
        home.style.height = "";
        bar.style.position = "";
        bar.style.top = "";
        bar.style.left = "";
        bar.style.width = "";
      }
      setStuck(isStuck && !isReleased);
      setReleased(isReleased);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const scrollToSection = (target: ProductDetailsSection) => {
    const el = findSection(homeRef.current, target);
    if (!el) return;
    setActiveSection(target);
    const header = document.querySelector<HTMLElement>("[data-sticky-header]");
    const offset = (header?.offsetHeight ?? 64) + 24;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  };

  useEffect(() => {
    const home = homeRef.current;
    const desc = findSection(home, "description");
    if (!desc) return;

    const targets: Element[] = [desc];
    const spec = findSection(home, "specifications");
    const reviews = findSection(home, "reviews");
    if (spec) targets.push(spec);
    if (reviews) targets.push(reviews);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const target = visible.target as HTMLElement;
        const id = target.dataset.section ?? target.id;
        if (
          id === "description" ||
          id === "specifications" ||
          id === "reviews"
        ) {
          setActiveSection(id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
    // The sections are drawn with the page, so the observer subscribes once.
  }, []);

  // One tab per section the page draws. The description always renders;
  // the spec table and the reviews thread only when the template keeps them
  // (see `sectionTargets`), so a tab never scrolls to nothing.
  const sectionTabs: { id: ProductDetailsSection; label: string }[] = [
    { id: "description", label: tf("product.description", "Description") },
    ...(sectionTargets.specifications
      ? [
          {
            id: "specifications" as const,
            label: tf("product.specifications", "Specifications"),
          },
        ]
      : []),
    ...(sectionTargets.reviews
      ? [{ id: "reviews" as const, label: tf("product.reviews", "Reviews") }]
      : []),
  ];

  return (
    // The home slot: where the strip lives un-pinned, and the height
    // placeholder while the strip rides fixed. The pinned strip shrinks a
    // step and the product (left) and price/CTA (right) slide in; scrolling
    // back up reverses it. It slides away once the reviews section ends
    // (see the effect above).
    <div ref={homeRef} className="mb-8">
      <div
        ref={barRef}
        className={cn(
          "z-30 -mx-4 border-b border-border bg-background/95 px-4 backdrop-blur-xl transition-[transform,opacity] duration-300",
          released && "pointer-events-none -translate-y-full opacity-0",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 transition-[padding] duration-300",
            stuck ? "py-2" : "py-4",
          )}
        >
          <div
            inert={!stuck}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 transition-all duration-300",
              stuck
                ? "translate-x-0 opacity-100"
                : "pointer-events-none -translate-x-3 opacity-0",
            )}
          >
            <span className="relative hidden h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted sm:block">
              <AppImage
                src={product.previewImage}
                alt=""
                fill
                sizes="44px"
                className="object-contain"
              />
            </span>
            <span className="hidden min-w-0 truncate text-sm font-semibold text-foreground md:block">
              {product.name}
            </span>
          </div>

          <nav
            className={cn(
              "flex shrink-0 items-center justify-center gap-6 font-semibold transition-all duration-300 sm:gap-10",
              stuck ? "text-xs" : "text-sm",
            )}
          >
            {sectionTabs.map(({ id, label }) => (
              <button
                key={`minimal-tab-${id}`}
                type="button"
                onClick={() => scrollToSection(id)}
                className={cn(
                  "transition-colors",
                  activeSection === id
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {id === "reviews" && (product.reviewCount ?? 0) > 0
                  ? ` (${product.reviewCount})`
                  : ""}
              </button>
            ))}
          </nav>

          <div
            inert={!stuck}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-end gap-2.5 transition-all duration-300",
              stuck
                ? "translate-x-0 opacity-100"
                : "pointer-events-none translate-x-3 opacity-0",
            )}
          >
            {quoteOnly ? (
              <QuotePrice className="hidden text-base font-bold text-foreground sm:block" />
            ) : (
              <span className="hidden text-base font-bold text-foreground sm:block">
                {formatDisplayPrice(displayedPrice)}
              </span>
            )}
            {/* The buy box's own controls at the bar's size: the same
                Buttons settings decide which button shows, what it says and
                how it looks, and the stepper rides along only where the buy
                box has one. */}
            {quoteOnly ? (
              <QuoteButton
                className="hidden h-9 px-4 text-xs font-bold sm:inline-flex"
                style={{ borderRadius: sty.cartRadius }}
              />
            ) : (
              <>
                {vis.quantity ? <QuantityStepper compact /> : null}
                {sty.actions === "buy" ? (
                  <Button
                    size="sm"
                    className="hidden h-9 px-4 text-xs font-bold sm:inline-flex"
                    style={purchaseButtonCss(sty, "buy", "compact")}
                    onClick={handleBuyNow}
                    disabled={purchaseShut}
                  >
                    {buyButtonText}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="hidden h-9 bg-foreground px-4 text-xs font-bold text-background hover:bg-foreground/90 sm:inline-flex"
                    style={purchaseButtonCss(sty, "cart", "compact")}
                    onClick={handleAddToCart}
                    disabled={purchaseShut}
                  >
                    {cartButtonText}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
