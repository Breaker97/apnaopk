"use client";

/**
 * One template in the manager, drawn as a slider card is on the Sliders page:
 * its name and Default chip, with Set as default beside them (the one that is
 * not the default yet), its thumbnail, its size, Edit and Preview as links
 * (they work in demo mode too) and the rest of the actions in a menu,
 * switched off when the page is read-only.
 */
import { useLocale, useTranslations } from "next-intl";
import { Copy, Eye, MoreHorizontal, Pencil, RotateCcw, Star, StarOff, TextCursorInput, Trash2 } from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isPresetKey } from "@/lib/invoice-templates/presets";
import type { InvoiceTemplate } from "@/lib/invoice-templates/types";
import { cn } from "@/lib/utils";
import { useTemplateScope } from "../template-scope";
import { CardHeader, CardPicture } from "./card-parts";
import { CARD_CLASS, CARD_HOVER_CLASS, PILL_BUTTON_CLASS, THUMBNAIL_HEIGHT_CLASS } from "./card-styles";
import { TemplateThumbnail } from "./template-thumbnail";

export type TemplateAction = "rename" | "duplicate" | "setDefault" | "removeDefault" | "restorePreset" | "delete";

export interface TemplateCardProps {
  template: InvoiceTemplate;
  readOnly: boolean;
  /** An action on this template is running. */
  busy: boolean;
  onAction: (action: TemplateAction, template: InvoiceTemplate) => void;
}

const KNOWN_SIZES = new Set([
  "a4-portrait",
  "a4-landscape",
  "a5-portrait",
  "a5-landscape",
  "thermal-80",
  "thermal-58",
  "sticker-100x150",
  "sticker-76x102",
  "sticker-51x76",
]);

/** "A4 portrait · 210 × 297 mm", or "80 mm roll" for a roll. */
export function useSizeLabel() {
  const t = useTranslations("admin.invoiceTemplates.manager");
  return (canvas: InvoiceTemplate["canvas"]) => {
    const name = KNOWN_SIZES.has(canvas.preset) ? t(`sizeNames.${canvas.preset}`) : t("sizeNames.custom");
    const size =
      canvas.heightMode === "auto"
        ? t("rollSize", { width: canvas.widthMm })
        : t("pageSize", { width: canvas.widthMm, height: canvas.heightMm });
    return `${name} · ${size}`;
  };
}

export function TemplateCard({ template, readOnly, busy, onAction }: TemplateCardProps) {
  const t = useTranslations("admin.invoiceTemplates.manager");
  const locale = useLocale();
  const templateHref = useTemplateScope().href;
  const sizeLabel = useSizeLabel()(template.canvas);
  const canRestore = isPresetKey(template.presetKey);
  const updated = template.updatedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(template.updatedAt))
    : null;
  const disabled = readOnly || busy;

  return (
    <article
      className={cn(
        CARD_CLASS,
        CARD_HOVER_CLASS,
        template.isDefault && "border-primary/50 ring-1 ring-primary/20",
        busy && "opacity-60",
      )}
      data-template-id={template.id}
      data-default={template.isDefault ? "true" : "false"}
      aria-busy={busy}
    >
      {/* The name and its status over the picture, with Set as default beside
          them as a slider card has its Duplicate. */}
      <CardHeader
        name={template.name}
        chip={template.isDefault ? { label: t("defaultBadge"), tone: "default" } : undefined}
        action={
          !template.isDefault && (
            <Button
              size="sm"
              variant="outline"
              className={PILL_BUTTON_CLASS}
              disabled={disabled}
              onClick={() => onAction("setDefault", template)}
            >
              <Star aria-hidden />
              {t("actions.setDefault")}
            </Button>
          )
        }
      />

      <CardPicture
        href={templateHref.edit(template.id)}
        label={t("openTemplate", { name: template.name })}
        hint={t("actions.edit")}
        busy={busy}
        highlighted={template.isDefault}
      >
        <TemplateThumbnail design={template} category={template.category} className={cn(THUMBNAIL_HEIGHT_CLASS, "w-full")} />
      </CardPicture>

      <div className="mt-3 space-y-0.5">
        <p className="text-xs text-muted-foreground">{sizeLabel}</p>
        {updated && <p className="text-xs text-muted-foreground">{t("updated", { date: updated })}</p>}
      </div>

      <div className="mt-auto pt-4">
        <div className="flex items-center gap-2">
          <Button asChild size="sm" className={cn(PILL_BUTTON_CLASS, "flex-1")}>
            <Link href={templateHref.edit(template.id)}>
              <Pencil aria-hidden />
              {t("actions.edit")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className={cn(PILL_BUTTON_CLASS, "flex-1")}>
            <Link href={templateHref.preview(template.id)}>
              <Eye aria-hidden />
              {t("actions.preview")}
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="outline"
                className="rounded-full"
                aria-label={t("actions.more", { name: template.name })}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={disabled} onSelect={() => onAction("rename", template)}>
                <TextCursorInput aria-hidden />
                {t("actions.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={disabled} onSelect={() => onAction("duplicate", template)}>
                <Copy aria-hidden />
                {t("actions.duplicate")}
              </DropdownMenuItem>
              {template.isDefault && (
                <DropdownMenuItem disabled={disabled} onSelect={() => onAction("removeDefault", template)}>
                  <StarOff aria-hidden />
                  {t("actions.removeDefault")}
                </DropdownMenuItem>
              )}
              {canRestore && (
                <DropdownMenuItem disabled={disabled} onSelect={() => onAction("restorePreset", template)}>
                  <RotateCcw aria-hidden />
                  {t("actions.restorePreset")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={disabled} onSelect={() => onAction("delete", template)}>
                <Trash2 aria-hidden />
                {t("actions.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}
