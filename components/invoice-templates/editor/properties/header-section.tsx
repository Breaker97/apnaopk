"use client";

/**
 * Header (§5.6): the element's name and kind, whether it prints, whether it
 * is locked, and Duplicate and Delete. The name is one undo step per burst of
 * typing; an emptied name is not written (it reverts when the field is left),
 * as in Layers.
 */
import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { TemplateElement } from "@/lib/invoice-templates/types";
import { cn } from "@/lib/utils";
import { useEditorApi } from "../editor-store";
import { EDITOR_CARD_CLASS, EDITOR_HINT_CLASS } from "../editor-styles";
import { Field } from "../panel-fields";
import { useElementEdit } from "./use-element-edit";

const NAME_MAX = 80;

/** Duplicate and Delete: the Slider editor's small square-cornered buttons. */
const ACTION_CLASS = "h-8 gap-1.5 rounded-[8px] px-3 text-xs";

export function HeaderSection({ element }: { element: TemplateElement }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.header");
  const tTypes = useTranslations("admin.invoiceTemplates.editor.types");
  const api = useEditorApi();
  const { edit } = useElementEdit(element.id);
  const [draft, setDraft] = useState<string | null>(null);
  const locked = Boolean(element.locked);

  return (
    <section data-property-section="header" aria-label={t("title")} className={cn(EDITOR_CARD_CLASS, "space-y-3 p-3")}>
      <Field label={t("name")}>
        {(id) => (
          <Input
            id={id}
            data-field="name"
            className="h-8"
            maxLength={NAME_MAX}
            value={draft ?? element.name}
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              const name = value.trim();
              if (name) edit((each) => (each.name === name ? each : ({ ...each, name } as TemplateElement)), "name");
            }}
            onBlur={() => setDraft(null)}
          />
        )}
      </Field>
      <p className={EDITOR_HINT_CLASS}>{tTypes(element.type)}</p>
      <label className="flex items-center justify-between gap-3 text-xs font-medium">
        <span>{t("visible")}</span>
        <Switch
          data-field="visible"
          checked={!element.hidden}
          onCheckedChange={(visible) => api.getState().setFlag([element.id], "hidden", !visible)}
          aria-label={t("visible")}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-xs font-medium">
        <span>{t("locked")}</span>
        <Switch
          data-field="locked"
          checked={locked}
          onCheckedChange={(value) => api.getState().setFlag([element.id], "locked", value)}
          aria-label={t("locked")}
        />
      </label>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" className={cn(ACTION_CLASS, "flex-1")} data-action="duplicate" onClick={() => api.getState().duplicateIds([element.id])}>
          <Copy aria-hidden className="size-4" />
          {t("duplicate")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(ACTION_CLASS, "flex-1 text-destructive hover:text-destructive")}
          data-action="delete"
          disabled={locked}
          title={locked ? t("unlockToDelete") : undefined}
          onClick={() => {
            // The panel shows one element only when it is the selection.
            api.getState().deleteSelection();
          }}
        >
          <Trash2 aria-hidden className="size-4" />
          {t("delete")}
        </Button>
      </div>
    </section>
  );
}
