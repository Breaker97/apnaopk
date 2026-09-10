"use client";

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Illustrated mini-previews for the section picker (the Figma tiles):
 * abstract CSS sketches of what each section renders, drawn from a small
 * primitive kit so they stay consistent and theme-aware. Types without a
 * scene fall back to the caller's icon.
 */

function Line({ w = "w-8", strong = false }: { w?: string; strong?: boolean }) {
  return (
    <span
      className={cn(
        "block h-1 rounded-full",
        w,
        strong ? "bg-foreground/70" : "bg-foreground/25",
      )}
    />
  );
}

function ImgBlock({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative block overflow-hidden rounded-[3px] bg-foreground/15",
        className,
      )}
    >
      <span className="absolute -left-1 -top-1 h-[200%] w-[60%] rotate-12 bg-foreground/10" />
    </span>
  );
}

function ProductCard() {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <ImgBlock className="aspect-square w-full" />
      <Line w="w-3/4" strong />
      <Line w="w-1/2" />
    </span>
  );
}

function CardRow({ count = 4 }: { count?: number }) {
  return (
    <span className="flex gap-1.5">
      {Array.from({ length: count }).map((_, index) => (
        <ProductCard key={index} />
      ))}
    </span>
  );
}

function Chip({ w = "w-6" }: { w?: string }) {
  return <span className={cn("block h-2 rounded-full bg-foreground/20", w)} />;
}

function Cta() {
  return <span className="block h-2 w-7 rounded-[3px] bg-primary/70" />;
}

const SCENES: Record<string, () => React.ReactNode> = {
  slideshow: () => (
    <div className="relative h-full w-full">
      <ImgBlock className="h-full w-full" />
      <div className="absolute left-2 top-1/2 flex -translate-y-1/2 flex-col gap-1">
        <Line w="w-10" strong />
        <Line w="w-7" />
        <Cta />
      </div>
      <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
        <span className="h-1 w-2.5 rounded-full bg-foreground/60" />
        <span className="h-1 w-1 rounded-full bg-foreground/25" />
        <span className="h-1 w-1 rounded-full bg-foreground/25" />
      </div>
    </div>
  ),
  "promotion-banner": () => (
    <div className="flex h-full items-center gap-2 rounded-[3px] bg-primary/15 px-2">
      <div className="flex flex-1 flex-col gap-1">
        <Line w="w-12" strong />
        <Line w="w-8" />
      </div>
      <Cta />
    </div>
  ),
  "promotion-grid": () => (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-1">
      <ImgBlock className="col-span-2 row-span-2" />
      <ImgBlock />
      <ImgBlock />
    </div>
  ),
  "countdown-offer": () => (
    <div className="flex h-full items-center gap-2 rounded-[3px] bg-foreground/8 px-2">
      <div className="flex flex-1 flex-col gap-1">
        <Line w="w-11" strong />
        <Line w="w-7" />
      </div>
      <div className="flex gap-0.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="grid h-4 w-4 place-items-center rounded-[3px] bg-foreground/70"
          >
            <span className="h-0.5 w-2 rounded-full bg-background/90" />
          </span>
        ))}
      </div>
    </div>
  ),
  "coupon-banner": () => (
    <div className="grid h-full place-items-center">
      <span className="flex items-center gap-2 rounded-[4px] border border-dashed border-foreground/50 px-3 py-1.5">
        <Line w="w-8" strong />
        <Cta />
      </span>
    </div>
  ),
  "product-grid": () => <CardRow />,
  "product-browser": () => (
    <div className="flex h-full gap-1.5">
      <div className="flex w-5 shrink-0 flex-col gap-1 rounded-[3px] bg-foreground/8 p-1">
        <Line w="w-full" />
        <Line w="w-2/3" />
        <Line w="w-full" />
        <Line w="w-2/3" />
      </div>
      <div className="grid flex-1 grid-cols-3 gap-1">
        {Array.from({ length: 6 }).map((_, index) => (
          <ImgBlock key={index} className="h-full w-full" />
        ))}
      </div>
    </div>
  ),
  "product-group": () => (
    <div className="flex h-full flex-col gap-1.5">
      <div className="flex gap-1">
        <Chip w="w-8" />
        <Chip w="w-6" />
        <Chip w="w-6" />
      </div>
      <CardRow />
    </div>
  ),
  "featured-collection": () => (
    <div className="flex h-full gap-1.5">
      <span className="flex w-2/5 flex-col justify-between rounded-[3px] bg-primary/15 p-1.5">
        <Line w="w-3/4" strong />
        <Cta />
      </span>
      <CardRow count={3} />
    </div>
  ),
  "sponsored-rail": () => (
    <div className="relative h-full">
      <CardRow />
      <span className="absolute right-0 top-0 rounded-full bg-amber-400/80 px-1 text-[6px] font-bold leading-[10px] text-black">
        AD
      </span>
    </div>
  ),
  "category-list": () => (
    <div className="flex h-full items-center justify-between gap-1.5 px-1">
      {Array.from({ length: 5 }).map((_, index) => (
        <span key={index} className="flex flex-1 flex-col items-center gap-1">
          <span className="aspect-square w-full max-w-7 rounded-full bg-foreground/15" />
          <Line w="w-3/4" />
        </span>
      ))}
    </div>
  ),
  // ---- variant scenes ("type:variant") — every design a section offers
  // must have its own picture, or the variant picker shows identical tiles
  // and tells the merchant nothing (test-enforced). ----
  "category-list:cards": () => (
    <div className="flex h-full items-center justify-between gap-1.5 px-1">
      {Array.from({ length: 4 }).map((_, index) => (
        <span key={index} className="flex flex-1 flex-col gap-1">
          <ImgBlock className="aspect-square w-full" />
          <Line w="w-3/4" />
        </span>
      ))}
    </div>
  ),
  "category-list:circles": () => (
    <div className="flex h-full items-center justify-between gap-1.5 px-1">
      {Array.from({ length: 5 }).map((_, index) => (
        <span key={index} className="flex flex-1 flex-col items-center gap-1">
          <span className="aspect-square w-full max-w-7 rounded-full bg-foreground/15" />
          <Line w="w-3/4" />
        </span>
      ))}
    </div>
  ),
  heading: () => (
    <div className="grid h-full place-items-center">
      <Line w="w-16" strong />
    </div>
  ),
  // Two neighbouring blocks with the empty run between them — the gap itself.
  gap: () => (
    <div className="flex h-full flex-col justify-between py-0.5">
      <span className="block h-2.5 w-full rounded-[3px] bg-foreground/15" />
      <span className="mx-auto w-2/3 border-t border-dashed border-foreground/30" />
      <span className="block h-2.5 w-full rounded-[3px] bg-foreground/15" />
    </div>
  ),
  "heading:plain": () => (
    <div className="flex h-full items-center px-1">
      <Line w="w-14" strong />
    </div>
  ),
  "heading:two-tone": () => (
    <div className="grid h-full place-items-center">
      <span className="flex items-center gap-1.5">
        <Line w="w-8" />
        <Line w="w-10" strong />
      </span>
    </div>
  ),
  "promotion-grid:bento": () => (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-1">
      <ImgBlock className="col-span-2 row-span-2" />
      <ImgBlock />
      <ImgBlock />
    </div>
  ),
  "promotion-grid:split": () => (
    <div className="grid h-full grid-cols-4 grid-rows-2 gap-1">
      <ImgBlock className="row-span-2" />
      <ImgBlock />
      <ImgBlock />
      <ImgBlock className="row-span-2" />
      <ImgBlock className="col-span-2" />
    </div>
  ),
  "product-group:standard": () => (
    <div className="flex h-full flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Line w="w-9" strong />
        <span className="flex gap-1">
          <Chip w="w-7" />
          <Chip w="w-5" />
          <Chip w="w-5" />
        </span>
      </div>
      <CardRow />
    </div>
  ),
  "product-group:centered": () => (
    <div className="flex h-full flex-col items-center gap-1.5">
      <Line w="w-10" strong />
      <span className="flex justify-center gap-1">
        <Chip w="w-7" />
        <Chip w="w-5" />
        <Chip w="w-5" />
      </span>
      <CardRow />
    </div>
  ),
  "brand-list:cards": () => (
    <div className="flex h-full items-center justify-between gap-1.5 px-1">
      {Array.from({ length: 5 }).map((_, index) => (
        <span
          key={index}
          className="grid aspect-square flex-1 place-items-center rounded-[4px] border border-foreground/20"
        >
          <Line w="w-1/2" strong />
        </span>
      ))}
    </div>
  ),
  "brand-list:strip": () => (
    <div className="flex h-full items-center justify-between gap-3 px-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <Line key={index} w="w-8" strong />
      ))}
    </div>
  ),
  "countdown-offer:banner": () => (
    <div className="flex h-full items-center gap-2 rounded-[3px] bg-foreground/8 px-2">
      <div className="flex flex-1 flex-col gap-1">
        <Line w="w-11" strong />
        <Line w="w-7" />
      </div>
      <div className="flex gap-0.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="grid h-4 w-4 place-items-center rounded-[3px] bg-foreground/70"
          >
            <span className="h-0.5 w-2 rounded-full bg-background/90" />
          </span>
        ))}
      </div>
    </div>
  ),
  "countdown-offer:deals-panel": () => (
    // The DEALS design: violet field, white countdown chips, then the
    // 2 + featured + 2 product arrangement (drawn as side | large | side).
    <div className="flex h-full flex-col gap-1 overflow-hidden rounded-[3px] bg-gradient-to-b from-indigo-800 to-purple-800 p-1.5">
      <div className="flex items-center gap-1">
        <span className="block h-1.5 w-7 rounded-full bg-white/90" />
        <span className="ml-auto flex gap-0.5">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="block h-3 w-2.5 rounded-[2px] bg-white/90"
            />
          ))}
        </span>
        <span className="block h-2 w-6 rounded-full bg-white/30" />
      </div>
      <div className="grid flex-1 grid-cols-[1fr_1.5fr_1fr] gap-1">
        <div className="grid grid-rows-2 gap-1">
          <span className="block rounded-[2px] bg-white/90" />
          <span className="block rounded-[2px] bg-white/90" />
        </div>
        <span className="block rounded-[3px] bg-white" />
        <div className="grid grid-rows-2 gap-1">
          <span className="block rounded-[2px] bg-white/90" />
          <span className="block rounded-[2px] bg-white/90" />
        </div>
      </div>
    </div>
  ),
  "category-mosaic": () => (
    <div className="grid h-full grid-cols-3 gap-1">
      <ImgBlock className="col-span-2" />
      <div className="grid grid-rows-2 gap-1">
        <ImgBlock />
        <ImgBlock />
      </div>
    </div>
  ),
  "collection-list": () => (
    <div className="grid h-full grid-cols-3 gap-1.5">
      {[0, 1, 2].map((index) => (
        <span key={index} className="flex flex-col gap-1">
          <ImgBlock className="flex-1" />
          <Line w="w-2/3" strong />
        </span>
      ))}
    </div>
  ),
  "brand-list": () => (
    <div className="flex h-full items-center justify-between gap-1.5 px-1">
      {Array.from({ length: 5 }).map((_, index) => (
        <span
          key={index}
          className="grid aspect-square flex-1 place-items-center rounded-[4px] border border-foreground/20"
        >
          <Line w="w-1/2" strong />
        </span>
      ))}
    </div>
  ),
  "image-text": () => (
    <div className="flex h-full items-center gap-2">
      <ImgBlock className="h-full w-2/5" />
      <div className="flex flex-1 flex-col gap-1">
        <Line w="w-3/4" strong />
        <Line w="w-full" />
        <Line w="w-5/6" />
        <Cta />
      </div>
    </div>
  ),
  "rich-text": () => (
    <div className="flex h-full flex-col items-center justify-center gap-1">
      <Line w="w-1/2" strong />
      <Line w="w-3/4" />
      <Line w="w-2/3" />
    </div>
  ),
  "image-gallery": () => (
    <div className="grid h-full grid-cols-3 gap-1">
      {[0, 1, 2].map((index) => (
        <ImgBlock key={index} />
      ))}
    </div>
  ),
  "blog-posts": () => (
    <div className="grid h-full grid-cols-3 gap-1.5">
      {[0, 1, 2].map((index) => (
        <span key={index} className="flex flex-col gap-1">
          <ImgBlock className="flex-1" />
          <Line w="w-full" strong />
          <Line w="w-2/3" />
        </span>
      ))}
    </div>
  ),
  testimonials: () => (
    <div className="grid h-full grid-cols-2 gap-1.5">
      {[0, 1].map((index) => (
        <span
          key={index}
          className="flex flex-col gap-1 rounded-[4px] bg-foreground/8 p-1.5"
        >
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-full bg-foreground/30" />
            <Line w="w-6" strong />
          </span>
          <Line w="w-full" />
          <Line w="w-4/5" />
        </span>
      ))}
    </div>
  ),
  "service-benefits": () => (
    <div className="flex h-full items-center justify-between gap-1.5">
      {Array.from({ length: 4 }).map((_, index) => (
        <span key={index} className="flex flex-1 flex-col items-center gap-1">
          <span className="h-4 w-4 rounded-full bg-primary/30" />
          <Line w="w-3/4" strong />
          <Line w="w-1/2" />
        </span>
      ))}
    </div>
  ),
  faq: () => (
    <div className="flex h-full flex-col justify-center gap-1">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="flex items-center justify-between rounded-[3px] bg-foreground/8 px-1.5 py-1"
        >
          <Line w={index === 0 ? "w-2/3" : "w-1/2"} strong />
          <span className="text-[8px] leading-none text-foreground/50">+</span>
        </span>
      ))}
    </div>
  ),
  "vendor-list": () => (
    <div className="grid h-full grid-cols-3 gap-1.5">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="flex flex-col items-center gap-1 rounded-[4px] border border-foreground/15 p-1.5"
        >
          <span className="h-4 w-4 rounded-full bg-foreground/25" />
          <Line w="w-3/4" strong />
          <Line w="w-1/2" />
        </span>
      ))}
    </div>
  ),
  "become-vendor": () => (
    <div className="flex h-full items-center gap-2 rounded-[3px] bg-primary/15 px-2">
      <div className="flex flex-1 flex-col gap-1">
        <Line w="w-12" strong />
        <Line w="w-9" />
      </div>
      <Cta />
    </div>
  ),
  // The Minimal buy box (Figma 774:4992): breadcrumb over hairline row
  // groups with the paired dark CTA + primary Buy Now under them. One scene
  // only — the buy-box design is theme-driven, not a variant.
  "product-main": () => (
    <div className="flex h-full gap-2">
      <ImgBlock className="h-full w-2/5" />
      <div className="flex flex-1 flex-col gap-[3px]">
        <Line w="w-1/2" />
        <Line w="w-3/4" strong />
        <span className="flex items-center justify-between border-b border-foreground/15 pb-[3px]">
          <Line w="w-1/4" strong />
        </span>
        <span className="flex items-center justify-between border-b border-foreground/15 pb-[3px]">
          <Line w="w-1/5" />
          <span className="flex gap-0.5">
            <Chip w="w-3" />
            <Chip w="w-3" />
          </span>
        </span>
        <span className="mt-auto flex gap-1">
          <span className="h-2 flex-1 rounded-[2px] bg-foreground/70" />
          <span className="h-2 flex-1 rounded-[2px] bg-primary/70" />
        </span>
      </div>
    </div>
  ),
  // A two-column table of hairline rows — the same picture in both designs;
  // what differs is the heading above it, which the tile shows as a bar.
  "product-specification": () => (
    <div className="flex h-full flex-col justify-center gap-1.5">
      {Array.from({ length: 4 }).map((_, index) => (
        <span
          key={index}
          className="flex items-center gap-2 border-b border-foreground/15 pb-1"
        >
          <Line w="w-1/4" />
          <Line w="w-1/2" strong />
        </span>
      ))}
    </div>
  ),
  "product-reviews": () => (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <span className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 w-1.5 rounded-[2px]",
              index < 4 ? "bg-amber-400/80" : "bg-foreground/20",
            )}
          />
        ))}
      </span>
      <Line w="w-full" />
      <Line w="w-2/3" />
    </div>
  ),
  "product-related:classic": () => (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <Line w="w-1/3" strong />
      <CardRow />
    </div>
  ),
  "product-related:electronics": () => (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <span className="flex justify-center">
        <Line w="w-1/2" strong />
      </span>
      <span className="block h-px w-full bg-foreground/20" />
      <CardRow />
    </div>
  ),
  "product-sponsored": () => (
    <div className="relative h-full">
      <CardRow />
      <span className="absolute right-0 top-0 rounded-full bg-amber-400/80 px-1 text-[6px] font-bold leading-[10px] text-black">
        AD
      </span>
    </div>
  ),
  "product-related": () => <CardRow />,
  "products-main": () => (
    <div className="flex h-full gap-1.5">
      <div className="flex w-5 shrink-0 flex-col gap-1 rounded-[3px] bg-foreground/8 p-1">
        <Line w="w-full" />
        <Line w="w-2/3" />
        <Line w="w-full" />
      </div>
      <div className="grid flex-1 grid-cols-3 gap-1">
        {Array.from({ length: 6 }).map((_, index) => (
          <ImgBlock key={index} className="h-full w-full" />
        ))}
      </div>
    </div>
  ),
  "category-header": () => (
    <div className="flex h-full items-center gap-2 rounded-[3px] border border-foreground/15 px-2">
      <ImgBlock className="aspect-square h-3/4" />
      <div className="flex flex-1 flex-col gap-1">
        <Line w="w-1/2" strong />
        <Line w="w-3/4" />
      </div>
    </div>
  ),
  "category-main": () => (
    <div className="grid h-full grid-cols-4 gap-1">
      {Array.from({ length: 8 }).map((_, index) => (
        <ImgBlock key={index} className="h-full w-full" />
      ))}
    </div>
  ),
  "collection-header": () => (
    <div className="relative h-full">
      <ImgBlock className="h-full w-full" />
      <div className="absolute bottom-1.5 left-2 flex flex-col gap-1">
        <Line w="w-10" strong />
        <Line w="w-7" />
      </div>
    </div>
  ),
  "collection-main": () => (
    <div className="grid h-full grid-cols-4 gap-1">
      {Array.from({ length: 8 }).map((_, index) => (
        <ImgBlock key={index} className="h-full w-full" />
      ))}
    </div>
  ),
  "cart-main": () => (
    <div className="flex h-full gap-1.5">
      <div className="flex flex-1 flex-col gap-1">
        {[0, 1].map((index) => (
          <span key={index} className="flex flex-1 items-center gap-1.5">
            <ImgBlock className="aspect-square h-full" />
            <span className="flex flex-1 flex-col gap-1">
              <Line w="w-3/4" strong />
              <Line w="w-1/3" />
            </span>
          </span>
        ))}
      </div>
      <div className="flex w-1/3 flex-col gap-1 rounded-[3px] bg-foreground/8 p-1.5">
        <Line w="w-full" />
        <Line w="w-2/3" />
        <span className="mt-auto">
          <Cta />
        </span>
      </div>
    </div>
  ),
  "header-bar": () => (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-6 rounded-sm bg-foreground/70" />
        <span className="h-2 flex-1 rounded-full border border-foreground/25" />
        <span className="flex gap-0.5">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="h-1.5 w-1.5 rounded-full bg-foreground/40"
            />
          ))}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Chip w="w-6" />
        <Line w="w-1/2" />
      </div>
    </div>
  ),
  "footer-bar": () => (
    <div className="flex h-full gap-2 rounded-[3px] bg-foreground/8 p-2">
      {[0, 1, 2].map((index) => (
        <span key={index} className="flex flex-1 flex-col gap-1">
          <Line w="w-2/3" strong />
          <Line w="w-1/2" />
          <Line w="w-1/2" />
        </span>
      ))}
    </div>
  ),
  "announcement-bar": () => (
    <div className="flex h-full flex-col justify-center gap-1">
      <span className="grid h-2.5 place-items-center rounded-[3px] bg-primary/70">
        <span className="h-0.5 w-1/3 rounded-full bg-background/90" />
      </span>
      <span className="h-2 rounded-[3px] bg-foreground/10" />
    </div>
  ),
  "top-tags": () => (
    <div className="flex h-full items-center gap-1">
      {["w-8", "w-6", "w-9", "w-7", "w-6"].map((w, index) => (
        <span
          key={index}
          className={cn(
            "block h-2.5 rounded-full border border-foreground/25 bg-foreground/8",
            w,
          )}
        />
      ))}
    </div>
  ),
};

/**
 * True when a DEDICATED scene exists for this exact key. The picker's
 * fallback keeps a missing scene from breaking, but a variant sharing its
 * section's picture defeats the visual picker — a test walks the registry
 * against this to force every design to bring its own drawing.
 */
export function hasSectionScene(type: string): boolean {
  return Boolean(SCENES[type]);
}

/**
 * A section's picture. `type` is either a section type ("category-list") or a
 * variant address ("category-list:circles") — a variant without a scene of
 * its own falls back to the section's, so adding a design never leaves a
 * blank tile in the picker.
 */
export function SectionThumbnail({
  type,
  fallbackIcon: FallbackIcon,
}: {
  type: string;
  fallbackIcon?: LucideIcon;
}) {
  const Scene = SCENES[type] ?? SCENES[type.split(":")[0]];
  return (
    <span
      aria-hidden="true"
      className="block w-full rounded-md border border-border/60 bg-muted/40 p-2"
    >
      <span className="block h-14">
        {Scene ? (
          <Scene />
        ) : (
          <span className="grid h-full w-full place-items-center text-foreground/60">
            {FallbackIcon ? <FallbackIcon className="h-5 w-5" /> : null}
          </span>
        )}
      </span>
    </span>
  );
}
