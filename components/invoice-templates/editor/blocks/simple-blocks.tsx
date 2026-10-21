"use client";

/**
 * The blocks with a handful of settings (§5.7): COD Badge, Notes and Line.
 */
import { useTranslations } from "next-intl";
import { useTemplateScope } from "@/components/invoice-templates/template-scope";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { withLineOrientation } from "@/lib/invoice-templates/editor/block-config";
import type { TemplateElementOf } from "@/lib/invoice-templates/types";
import { ChoiceSelect, Field, Segmented } from "../panel-fields";
import { ConfigSection, useConfigEdit } from "./config-section";

export function CodBadgeConfig({ element }: { element: TemplateElementOf<"codBadge"> }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.cod");
  const { set } = useConfigEdit<"codBadge">(element);
  const { amountSource, label, whenPaid, paidLabel } = element.config;
  return (
    <ConfigSection element={element}>
      <Field label={t("amountSource")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="config.amountSource"
            value={amountSource}
            options={(["cod", "due", "total"] as const).map((value) => ({ value, label: t(`sources.${value}`) }))}
            onChange={(next) => set({ amountSource: next })}
          />
        )}
      </Field>
      <Field label={t("label")}>
        {(id) => (
          <Input
            id={id}
            data-field="config.label"
            className="h-8"
            maxLength={60}
            placeholder={t("labelPlaceholder")}
            value={label}
            onChange={(event) => set({ label: event.target.value }, "label")}
          />
        )}
      </Field>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t("whenPaid")}</p>
        <Segmented
          label={t("whenPaid")}
          field="config.whenPaid"
          value={whenPaid}
          options={(["showPaid", "hide"] as const).map((value) => ({ value, label: t(`paid.${value}`) }))}
          onChange={(next) => set({ whenPaid: next })}
        />
      </div>
      {whenPaid === "showPaid" && (
        <Field label={t("paidLabel")}>
          {(id) => (
            <Input
              id={id}
              data-field="config.paidLabel"
              className="h-8"
              maxLength={60}
              placeholder={t("paidPlaceholder")}
              value={paidLabel}
              onChange={(event) => set({ paidLabel: event.target.value }, "paidLabel")}
            />
          )}
        </Field>
      )}
    </ConfigSection>
  );
}

export function NotesConfig({ element }: { element: TemplateElementOf<"notes"> }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.notes");
  const { set } = useConfigEdit<"notes">(element);
  const { source, text, title } = element.config;
  // A vendor's papers never print the internal note (review H1): not offered, but kept (and said so) when already chosen.
  const vendor = useTemplateScope().kind === "vendor";
  const sources = (["customerNote", "internalNote", "fixed"] as const).filter((value) => !vendor || value !== "internalNote" || source === value);
  return (
    <ConfigSection element={element}>
      <Field label={t("source")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="config.source"
            value={source}
            options={sources.map((value) => ({ value, label: t(`sources.${value}`) }))}
            onChange={(next) => set({ source: next })}
          />
        )}
      </Field>
      {source === "internalNote" && (
        <p role="note" data-warning={vendor ? "internal-note-not-printed" : "internal-note"} className="text-xs text-amber-700 dark:text-amber-400">
          {t(vendor ? "internalVendorWarning" : "internalWarning")}
        </p>
      )}
      {source === "fixed" && (
        <Field label={t("text")}>
          {(id) => (
            <Textarea
              id={id}
              data-field="config.text"
              className="min-h-16 text-sm"
              maxLength={2000}
              value={text ?? ""}
              onChange={(event) => set({ text: event.target.value }, "text")}
            />
          )}
        </Field>
      )}
      <Field label={t("title")}>
        {(id) => (
          <Input
            id={id}
            data-field="config.title"
            className="h-8"
            maxLength={80}
            placeholder={t("titlePlaceholder")}
            value={title}
            onChange={(event) => set({ title: event.target.value }, "title")}
          />
        )}
      </Field>
    </ConfigSection>
  );
}

export function LineConfig({ element }: { element: TemplateElementOf<"line"> }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.line");
  const { edit } = useConfigEdit<"line">(element);
  return (
    <ConfigSection element={element} hint={t("hint")}>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t("orientation")}</p>
        <Segmented
          label={t("orientation")}
          field="config.orientation"
          value={element.config.orientation}
          options={(["horizontal", "vertical"] as const).map((value) => ({ value, label: t(value) }))}
          onChange={(orientation) => edit((each) => withLineOrientation(each, orientation))}
        />
        <p className="text-xs text-muted-foreground">{t("turnsBox")}</p>
      </div>
    </ConfigSection>
  );
}
