import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The Electronics theme's numbered pager: round 32px chips, the current page
 * inverted, chevron arrows that stay in the row even when they lead nowhere.
 * Pure links — every page is server-rendered and shareable, so the pager has
 * no state of its own. Shared by the categories index and the category
 * listing so the two cannot drift apart.
 */
export function ElectronicsPager({
  page,
  totalPages,
  pageHref,
  previousLabel,
  nextLabel,
}: {
  page: number;
  totalPages: number;
  pageHref: (page: number) => string;
  previousLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <PagerArrow
        direction="prev"
        href={page > 1 ? pageHref(page - 1) : null}
        label={previousLabel}
      />
      {pagerPages(page, totalPages).map((item, index) =>
        item === "gap" ? (
          <span
            key={`gap-${index}`}
            className="px-0.5 text-sm text-muted-foreground"
          >
            …
          </span>
        ) : item === page ? (
          <span
            key={item}
            aria-current="page"
            className="grid size-8 place-items-center rounded-full bg-foreground text-sm font-bold text-background"
          >
            {item}
          </span>
        ) : (
          <Link
            key={item}
            href={pageHref(item)}
            className="grid size-8 place-items-center rounded-full bg-muted text-sm font-bold text-foreground transition-colors hover:bg-muted/70"
          >
            {item}
          </Link>
        ),
      )}
      <PagerArrow
        direction="next"
        href={page < totalPages ? pageHref(page + 1) : null}
        label={nextLabel}
      />
    </div>
  );
}

function PagerArrow({
  direction,
  href,
  label,
}: {
  direction: "prev" | "next";
  href: string | null;
  label: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const icon = <Icon className="size-3.5 rtl:rotate-180" aria-hidden />;
  // The dead-end arrow stays in the row, so the pager never shifts sideways
  // between the first page and the rest.
  if (!href) {
    return (
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-full bg-muted text-foreground opacity-40"
      >
        {icon}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="grid size-8 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted/70"
    >
      {icon}
    </Link>
  );
}

/** 1 … around-current … last, few enough to render as round chips. */
function pagerPages(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const wanted = [1, current - 1, current, current + 1, total];
  const pages = [...new Set(wanted)]
    .filter((value) => value >= 1 && value <= total)
    .sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  let previous = 0;
  for (const value of pages) {
    if (previous && value - previous > 1) items.push("gap");
    items.push(value);
    previous = value;
  }
  return items;
}
