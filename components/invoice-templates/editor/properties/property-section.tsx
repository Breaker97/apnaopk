"use client";

/**
 * A collapsible titled section of the property panel (§5.6). Which sections
 * are folded lives in the editor store (`collapsedSections`): a view setting,
 * kept while another element is selected, never saved and never an undo
 * step. `data-property-section` names the section for tests and for the
 * capability-map check.
 */
import { useId, type HTMLAttributes, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditor, useEditorApi } from "../editor-store";
import { EDITOR_CARD_CLASS, EDITOR_HINT_CLASS, EDITOR_TITLE_CLASS } from "../editor-styles";

export function PropertySection({
  id,
  title,
  hint,
  children,
  ...props
}: { id: string; title: string; hint?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLElement>, "title">) {
  const api = useEditorApi();
  const collapsed = useEditor((state) => state.collapsedSections.includes(id));
  const bodyId = useId();
  return (
    <section data-property-section={id} data-collapsed={collapsed ? "true" : undefined} aria-label={title} className={EDITOR_CARD_CLASS} {...props}>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => api.getState().toggleSection(id)}
          className={cn(
            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] px-3 py-2.5 text-start transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none",
            EDITOR_TITLE_CLASS,
          )}
        >
          <span>{title}</span>
          <ChevronDown aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-180")} />
        </button>
      </h3>
      {!collapsed && (
        <div id={bodyId} className="space-y-3 border-t border-border px-3 py-3">
          {hint && <p className={EDITOR_HINT_CLASS}>{hint}</p>}
          {children}
        </div>
      )}
    </section>
  );
}
