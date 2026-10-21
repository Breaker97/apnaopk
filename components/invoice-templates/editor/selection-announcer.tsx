"use client";

/**
 * Says selection changes out loud (§7 Phase 4 step 7): "Header selected",
 * "3 elements selected", "Selection cleared", in a polite live region.
 * Silent until something has been selected once.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useShallow } from "zustand/react/shallow";
import { useEditor } from "./editor-store";

export function SelectionAnnouncer() {
  const t = useTranslations("admin.invoiceTemplates.editor.announce");
  const names = useEditor(
    useShallow((state) => {
      const byId = new Map(state.design.elements.map((element) => [element.id, element.name]));
      return state.selection.map((id) => byId.get(id) ?? id);
    }),
  );
  const [touched, setTouched] = useState(false);
  if (names.length > 0 && !touched) setTouched(true);
  const message =
    names.length === 0 ? (touched ? t("none") : "") : names.length === 1 ? t("one", { name: names[0]! }) : t("many", { count: names.length });
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true" data-editor-announcer="">
      {message}
    </div>
  );
}
