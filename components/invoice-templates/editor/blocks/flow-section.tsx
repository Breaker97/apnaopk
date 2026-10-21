"use client";

/**
 * Page flow of a repeating block (§4.5, §5.7): whether its rows continue on
 * the next page, whether the table heading repeats there, where the
 * continuation starts, and how many lines each kind of page holds. Empty
 * numbers are "automatic" (what fits, measured at print size). Each change is
 * one undo step; typing a number is grouped per field.
 */
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { withFlow, withRowsPerPage } from "@/lib/invoice-templates/editor/block-config";
import { roundMm } from "@/lib/invoice-templates/units";
import type { TemplateElement } from "@/lib/invoice-templates/types";
import { Field, OptionalNumber } from "../panel-fields";
import { PropertySection } from "../properties/property-section";
import { useElementEdit } from "../properties/use-element-edit";

const PAGES = ["first", "middle", "last"] as const;

export function FlowSection({ element }: { element: TemplateElement }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.flow");
  const { edit } = useElementEdit(element.id);
  const flow = element.flow;
  if (!flow) return null;
  const hasHeader = element.type === "productTable" && element.config.showHeader;

  return (
    <PropertySection id="flow" title={t("title")} hint={t("hint")}>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{t("enabled")}</span>
        <Switch data-field="flow.enabled" checked={flow.enabled} onCheckedChange={(enabled) => edit((each) => withFlow(each, { enabled }))} aria-label={t("enabled")} />
      </label>
      {flow.enabled && (
        <>
          {element.type === "productTable" && (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className={hasHeader ? undefined : "text-muted-foreground"}>{t("repeatHeader")}</span>
              <Switch
                data-field="flow.repeatHeader"
                checked={flow.repeatHeader}
                disabled={!hasHeader}
                onCheckedChange={(repeatHeader) => edit((each) => withFlow(each, { repeatHeader }))}
                aria-label={t("repeatHeader")}
              />
            </label>
          )}
          <Field label={t("continuationTop")}>
            {(id) => (
              <OptionalNumber
                id={id}
                field="flow.continuationTopMm"
                unit={t("unitMm")}
                placeholder={t("automatic")}
                value={flow.continuationTopMm}
                min={0}
                max={1000}
                step={0.5}
                normalize={roundMm}
                onChange={(value) => edit((each) => withFlow(each, { continuationTopMm: value }), "flow.continuationTopMm")}
              />
            )}
          </Field>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("rowsPerPage")}</p>
            <div className="grid grid-cols-3 gap-2">
              {PAGES.map((page) => (
                <Field key={page} label={t(`pages.${page}`)}>
                  {(id) => (
                    <OptionalNumber
                      id={id}
                      field={`flow.rowsPerPage.${page}`}
                      // Three boxes to a row: "Automatic" doesn't fit one (review F).
                      placeholder={t("auto")}
                      value={flow.rowsPerPage?.[page]}
                      min={1}
                      max={500}
                      normalize={Math.round}
                      onChange={(value) => edit((each) => withRowsPerPage(each, page, value), `flow.rowsPerPage.${page}`)}
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>
        </>
      )}
    </PropertySection>
  );
}
