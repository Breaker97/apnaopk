import { cn } from "@/lib/utils";

/**
 * A count on a dashboard sidebar entry — the unread tally on Inbox.
 *
 * Render it twice per entry: once at the end of the row (`rail` false), shown
 * while the sidebar is expanded, and once inside a `relative` wrapper around
 * the icon (`rail` true), shown only on the collapsed icon rail, where there is
 * no row end to sit at. Each hides itself in the other state, so exactly one
 * is ever in the accessibility tree and a screen reader hears "Inbox 12".
 *
 * `isApparent` is the brand-coloured sidebar: a primary-tinted pill would
 * vanish into a primary ground there, so it inverts to white.
 */
export function SidebarCountBadge({
  count,
  isApparent,
  rail = false,
}: {
  count: number;
  isApparent: boolean;
  rail?: boolean;
}) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);

  if (rail) {
    return (
      <span
        className={cn(
          "absolute -top-1.5 -end-2.5 hidden h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none tabular-nums group-data-[collapsible=icon]:flex",
          isApparent
            ? "bg-white text-sidebar"
            : "bg-primary text-primary-foreground",
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "ms-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold leading-none tabular-nums group-data-[collapsible=icon]:hidden",
        isApparent
          ? "border-white/25 bg-white/20 text-white"
          : "border-primary/15 bg-primary/10 text-primary dark:border-white/20 dark:bg-white/15 dark:text-white",
      )}
    >
      {label}
    </span>
  );
}
