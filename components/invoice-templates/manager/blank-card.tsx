"use client";

/**
 * The first card in every tab: a blank page with a plus, as a document app
 * offers "Blank document" before its templates (owner, 2026-10-13). It links
 * to the unsaved blank draft, as New template does, so it works in
 * demo mode too; it is off only when the category is full.
 */
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import { blankDesign } from "@/lib/invoice-templates/presets";
import type { TemplateCategory } from "@/lib/invoice-templates/types";
import { cn } from "@/lib/utils";
import { useTemplateScope } from "../template-scope";
import { CardHeader, CardPicture } from "./card-parts";
import { CARD_CLASS, CARD_HOVER_CLASS, PAPER_SHADOW, PILL_BUTTON_CLASS, THUMBNAIL_HEIGHT_CLASS } from "./card-styles";
import { useDraftLanguage } from "./new-template-button";
import { useSizeLabel } from "./template-card";

export interface BlankCardProps {
  category: TemplateCategory;
  /** The category is full: no new template can be saved into it. */
  disabled: boolean;
}

export function BlankCard({ category, disabled }: BlankCardProps) {
  const t = useTranslations("admin.invoiceTemplates.manager");
  const lang = useDraftLanguage();
  const templateHref = useTemplateScope().href;
  const { canvas } = useMemo(() => blankDesign(category, lang), [category, lang]);
  const sizeLabel = useSizeLabel()(canvas);
  const href = templateHref.create(category, { lang });
  const name = t("actions.blank");

  // An empty page in the category's proportions, as the thumbnails draw theirs.
  const page = (
    <div className={cn(THUMBNAIL_HEIGHT_CLASS, "flex w-full items-center justify-center")} aria-hidden>
      <div
        className="flex h-full max-w-full items-center justify-center bg-white"
        style={{ aspectRatio: `${canvas.widthMm} / ${canvas.heightMm}`, boxShadow: PAPER_SHADOW }}
      >
        <Plus className={cn("h-12 w-12", disabled ? "text-muted-foreground" : "text-primary")} strokeWidth={1.5} />
      </div>
    </div>
  );

  return (
    <article className={cn(CARD_CLASS, CARD_HOVER_CLASS)} data-blank={category}>
      <CardHeader name={name} />

      <CardPicture href={disabled ? undefined : href} label={t("openTemplate", { name })}>
        {page}
      </CardPicture>

      <div className="mt-3 space-y-0.5">
        <p className="text-xs text-muted-foreground">{sizeLabel}</p>
        <p className="text-xs text-muted-foreground">{t("blankCard.description")}</p>
      </div>

      <div className="mt-auto pt-4">
        {disabled ? (
          <Button size="sm" className={cn(PILL_BUTTON_CLASS, "w-full")} disabled>
            <Plus aria-hidden />
            {t("blankCard.create")}
          </Button>
        ) : (
          <Button asChild size="sm" className={cn(PILL_BUTTON_CLASS, "w-full")}>
            <Link href={href}>
              <Plus aria-hidden />
              {t("blankCard.create")}
            </Link>
          </Button>
        )}
      </div>
    </article>
  );
}
