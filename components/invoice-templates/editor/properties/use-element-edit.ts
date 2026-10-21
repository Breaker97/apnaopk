"use client";

/**
 * How a property section writes (notes/P4.md "The store"): a function of the
 * element's latest copy through `editElement`, in a group per field so typing
 * is one undo step (600 ms) and a pick, switch or colour is a step of its own.
 */
import { useMemo } from "react";
import { withStyle } from "@/lib/invoice-templates/editor/properties";
import type { ElementStyle, TemplateElement } from "@/lib/invoice-templates/types";
import { useEditorApi } from "../editor-store";

export interface ElementEdit {
  /** Applies `edit` to the element. A `group` makes edits to that field within 600 ms one step. */
  edit: (edit: (element: TemplateElement) => TemplateElement, group?: string) => void;
  style: (patch: Partial<ElementStyle>, group?: string) => void;
}

export function useElementEdit(id: string): ElementEdit {
  const api = useEditorApi();
  return useMemo(() => {
    const edit: ElementEdit["edit"] = (change, group) =>
      api.getState().editElement(id, change, group ? { group: `prop:${id}:${group}` } : undefined);
    return { edit, style: (patch, group) => edit((element) => withStyle(element, patch), group) };
  }, [api, id]);
}
