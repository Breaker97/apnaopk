"use client";

/**
 * A built-in preset the category has no saved template from yet, drawn as a
 * template card is (template-card.tsx) so every tab lists its templates the
 * same way: the name with a Preset chip and Set as default beside them, its
 * thumbnail, its size, Edit and Preview as links, and Save as template in the
 * menu. Edit opens an unsaved draft; Set as default and Save as template save
 * the preset as a template first. Writing actions are off when read-only.
 *
 * The standard preset (`standard`) is the card of what the category prints
 * with no default (presets.ts `STANDARD_PRESETS`), shown even once saved. It
 * is the Default while no template is — on the admin's side; a vendor's falls
 * back to the marketplace's default first, so theirs is never marked and has
 * no Set as default. Its Set as default goes back to the standard print. Its
 * picture and preview are in English, as the standard print is.
 */
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Eye, MoreHorizontal, Pencil, Save, Star } from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { buildPresetDesign, presetName, type PresetKey } from "@/lib/invoice-templates/presets";
import type { TemplateCategory } from "@/lib/invoice-templates/types";
import { cn } from "@/lib/utils";
import { useTemplateScope } from "../template-scope";
import { CardHeader, CardPicture } from "./card-parts";
import { CARD_CLASS, CARD_HOVER_CLASS, PILL_BUTTON_CLASS, THUMBNAIL_HEIGHT_CLASS } from "./card-styles";
import { useDraftLanguage } from "./new-template-button";
import { useSizeLabel } from "./template-card";
import { TemplateThumbnail } from "./template-thumbnail";

export type PresetAction = "setDefault" | "save";

export interface PresetCardProps {
  presetKey: PresetKey;
  category: TemplateCategory;
  /** Nothing that writes can start (demo mode). */
  readOnly: boolean;
  /** The category is full: nothing can be saved into it. */
  full: boolean;
  /** An action on this preset is running. */
  busy: boolean;
  /** The category's standard print: whether it is the default, and whether this side can make it so. */
  standard?: { isDefault: boolean; canSetDefault: boolean };
  onAction: (action: PresetAction, presetKey: PresetKey) => void;
}

export function PresetCard({ presetKey, category, readOnly, full, busy, standard, onAction }: PresetCardProps) {
  const t = useTranslations("admin.invoiceTemplates.manager");
  const lang = useDraftLanguage();
  const templateHref = useTemplateScope().href;
  const shownIn = standard ? "en" : lang;
  // Memoized: the thumbnail lays the page out again whenever the design changes.
  const design = useMemo(() => buildPresetDesign(presetKey, shownIn), [presetKey, shownIn]);
  const sizeLabel = useSizeLabel()(design.canvas);
  const name = presetName(presetKey, lang);
  const draftHref = templateHref.create(category, { preset: presetKey, lang });
  const isDefault = Boolean(standard?.isDefault);
  // Going back to the standard print saves nothing, so a full category allows it.
  const canSetDefault = standard ? standard.canSetDefault && !isDefault : true;
  const setDefaultOff = readOnly || busy || (!standard && full);
  const saveOff = readOnly || busy || full;

  return (
    <article
      className={cn(
        CARD_CLASS,
        CARD_HOVER_CLASS,
        isDefault && "border-primary/50 ring-1 ring-primary/20",
        busy && "opacity-60",
      )}
      data-preset={presetKey}
      data-standard={standard ? "true" : undefined}
      data-default={isDefault ? "true" : "false"}
      aria-busy={busy}
    >
      <CardHeader
        name={name}
        chip={
          isDefault
            ? { label: t("defaultBadge"), tone: "default" }
            : { label: standard ? t("builtInBadge") : t("presetBadge"), tone: "muted" }
        }
        action={
          canSetDefault && (
            <Button
              size="sm"
              variant="outline"
              className={PILL_BUTTON_CLASS}
              disabled={setDefaultOff}
              onClick={() => onAction("setDefault", presetKey)}
            >
              <Star aria-hidden />
              {t("actions.setDefault")}
            </Button>
          )
        }
      />

      <CardPicture
        href={draftHref}
        label={t("openTemplate", { name })}
        hint={t("actions.edit")}
        busy={busy}
        highlighted={isDefault}
      >
        <TemplateThumbnail design={design} category={category} className={cn(THUMBNAIL_HEIGHT_CLASS, "w-full")} />
      </CardPicture>

      <div className="mt-3 space-y-0.5">
        <p className="text-xs text-muted-foreground">{sizeLabel}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground" title={t(`presets.${presetKey}`)}>
          {t(`presets.${presetKey}`)}
        </p>
      </div>

      <div className="mt-auto pt-4">
        <div className="flex items-center gap-2">
          <Button asChild size="sm" className={cn(PILL_BUTTON_CLASS, "flex-1")}>
            <Link href={draftHref}>
              <Pencil aria-hidden />
              {t("actions.edit")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className={cn(PILL_BUTTON_CLASS, "flex-1")}>
            <Link href={templateHref.previewPreset(presetKey, shownIn)}>
              <Eye aria-hidden />
              {t("actions.preview")}
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="outline" className="rounded-full" aria-label={t("actions.more", { name })}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={saveOff} onSelect={() => onAction("save", presetKey)}>
                <Save aria-hidden />
                {t("actions.saveAsTemplate")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}
