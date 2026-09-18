"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one shape every block editor takes, the slider editor's: what the
 * block looks like on the left, its short properties in a panel on the
 * right — numbers, switches, dropdowns, swatches, in named groups that
 * fold — and everything wide (copy, pickers, lists of rows) under the two
 * at full width. A block with no picture of itself keeps one column.
 *
 * The panel sticks under the row's own pinned header and scrolls on its
 * own, so a long list of properties never takes the preview off screen.
 */
/**
 * The panel's groups open one at a time: the shell keeps which, and each
 * group asks. `null` is untouched — the first group is open — and `""`
 * is every group folded by hand.
 */
interface PanelAccordion {
  open: string | null;
  first: string | null;
  setOpen: (id: string | null) => void;
  register: (id: string) => () => void;
}
const PanelAccordionContext = createContext<PanelAccordion | null>(null);

function PanelAccordionProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const order = useRef<string[]>([]);
  const value = useMemo<PanelAccordion>(
    () => ({
      open,
      first,
      setOpen,
      register: (id) => {
        order.current = [...order.current, id];
        setFirst(order.current[0] ?? null);
        return () => {
          order.current = order.current.filter((entry) => entry !== id);
          setFirst(order.current[0] ?? null);
        };
      },
    }),
    [open, first],
  );
  return (
    <PanelAccordionContext.Provider value={value}>{children}</PanelAccordionContext.Provider>
  );
}

export function EditorShell({
  preview,
  panel,
  children,
}: {
  /** The storefront's render, or the editor's own picture of the block. */
  preview?: ReactNode;
  /** The property groups; `PanelGroup`s, usually. */
  panel?: ReactNode;
  /** The wide fields, the block rows. */
  children?: ReactNode;
}) {
  const stage = Boolean(preview) || Boolean(panel);
  return (
    <div className="space-y-5">
      {stage ? (
        <div
          className={cn(
            "space-y-4",
            preview && panel &&
              "xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start xl:gap-5 xl:space-y-0",
          )}
        >
          {preview ? <div className="min-w-0">{preview}</div> : null}
          {panel ? (
            <aside
              className={cn(
                "space-y-2",
                preview &&
                  "xl:sticky xl:top-[calc(var(--dashboard-header-height,4rem)+var(--builder-bar-h,0px)+4.5rem)] xl:max-h-[calc(100dvh-var(--dashboard-header-height,4rem)-var(--builder-bar-h,0px)-5.5rem)] xl:overflow-y-auto",
              )}
            >
              <PanelAccordionProvider>{panel}</PanelAccordionProvider>
            </aside>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * One group of the panel: a title that says what it holds, an optional
 * line on what it is for, and its rows — folded away until wanted, with a
 * badge for the state worth seeing while folded.
 */
export function PanelGroup({
  title,
  hint,
  badge,
  action,
  defaultOpen = true,
  children,
}: {
  title: string;
  hint?: string;
  badge?: string;
  /** A small control in the header — a reset, say. */
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  // Inside a shell the groups form an accordion; alone, a group keeps its
  // own fold.
  const accordion = useContext(PanelAccordionContext);
  const id = useId();
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const register = accordion?.register;
  useEffect(() => (register ? register(id) : undefined), [register, id]);
  const open = accordion
    ? accordion.open === null
      ? accordion.first === id
      : accordion.open === id
    : ownOpen;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(open) : next;
    if (accordion) accordion.setOpen(resolved ? id : "");
    else setOwnOpen(resolved);
  };
  return (
    <section className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-3 py-2.5 text-left transition hover:bg-accent/50"
        >
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {badge}
            </span>
          ) : null}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {action}
      </div>
      {open ? (
        <div className="space-y-2.5 border-t border-border px-3 py-3">
          {hint ? (
            <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
          ) : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One row of a panel group: its name on the left, its control on the
 * right, and a footnote under the two only where the name cannot carry
 * the meaning alone.
 */
export function PanelRow({
  label,
  hint,
  children,
  stacked = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  /** A control too wide for the right half sits under its name instead. */
  stacked?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div
        className={cn(
          stacked
            ? "space-y-1.5"
            // Wrapping, not truncating: a long name keeps its words and the
            // control drops under it when the panel is too narrow for both.
            : "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5",
        )}
      >
        <span className="text-xs font-medium">{label}</span>
        {stacked ? <div>{children}</div> : <div className="shrink-0">{children}</div>}
      </div>
      {hint ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
