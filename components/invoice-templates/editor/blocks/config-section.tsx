"use client";

/**
 * The shell and the writing seam of a block's settings section (`config`).
 * A block component renders its controls inside `ConfigSection` and writes
 * through `useConfigEdit(element)`:
 *
 *   const { set } = useConfigEdit(element);
 *   set({ logoPlacement: "top" });                 // a pick: one undo step
 *   set({ title }, "title");                        // typing: grouped per field, 600 ms
 *
 * Both go through `editElement`, so a change builds on the element's latest
 * copy, never on what the panel last rendered.
 */
import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { withConfig } from "@/lib/invoice-templates/editor/block-config";
import type { ElementConfigMap, TemplateElement } from "@/lib/invoice-templates/types";
import { PropertySection } from "../properties/property-section";
import { useElementEdit } from "../properties/use-element-edit";

export function ConfigSection({ element, children, hint }: { element: TemplateElement; children: ReactNode; hint?: string }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.titles");
  return (
    <PropertySection id="config" title={t(element.type)} hint={hint} data-config-type={element.type}>
      {children}
    </PropertySection>
  );
}

export interface ConfigEdit<T extends TemplateElement["type"]> {
  /** Changes some of the block's settings. A `group` makes typing into that field one undo step. */
  set: (patch: Partial<ElementConfigMap[T]>, group?: string) => void;
  /** Changes the block's settings as a function of their latest value (lists). */
  update: (change: (config: ElementConfigMap[T]) => Partial<ElementConfigMap[T]>, group?: string) => void;
  /** Any change to the element itself (an orientation that also turns the box). */
  edit: (change: (element: TemplateElement) => TemplateElement, group?: string) => void;
}

export function useConfigEdit<T extends TemplateElement["type"]>(element: Extract<TemplateElement, { type: T }>): ConfigEdit<T> {
  const { edit } = useElementEdit(element.id);
  return useMemo(
    () => ({
      set: (patch, group) => edit((each) => withConfig(each, patch as never), group && `config.${group}`),
      update: (change, group) =>
        edit((each) => withConfig(each, change(each.config as ElementConfigMap[T]) as never), group && `config.${group}`),
      edit: (change, group) => edit(change, group && `config.${group}`),
    }),
    [edit],
  );
}
