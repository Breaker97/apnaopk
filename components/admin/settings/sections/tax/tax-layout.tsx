import type { ReactNode } from "react";
import { Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A quiet line with its icon: what a tab is for, or a fact about it. */
export function TaxNote(props: { icon?: LucideIcon; children: ReactNode }) {
  const Icon = props.icon ?? Info;
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-sm">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{props.children}</span>
    </p>
  );
}

/**
 * A titled part of a tab, for a tab that holds more than one: the tabs share
 * one card, so a part is a heading with its note, not a card of its own.
 */
export function TaxSection(props: {
  title: string;
  description?: string;
  /** A control that belongs to the whole part, beside its title. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("space-y-3", props.className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <h3 className="text-sm font-semibold">{props.title}</h3>
          {props.description ? <p className="text-muted-foreground text-sm">{props.description}</p> : null}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}
