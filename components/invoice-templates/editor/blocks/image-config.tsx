"use client";

/**
 * The Image settings (§5.7): the store's logo (from Settings) or a picture
 * from the media library, and how it fits its box. The library is the
 * admin's one picker (`MediaUploader` with the library on): choose a stored
 * file or upload a new one. Templates may only use pictures from the store's
 * own storage; the server checks that on Save (D-18 / §4.14).
 *
 * Choosing a picture, replacing it, removing it and the fit are each one undo
 * step.
 */
import { useState } from "react";
import { ImageIcon, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MediaUploader } from "@/components/ui/media-uploader";
import { withoutConfigKey } from "@/lib/invoice-templates/editor/block-config";
import type { TemplateElementOf } from "@/lib/invoice-templates/types";
import { ChoiceSelect, Field, Segmented } from "../panel-fields";
import { ConfigSection, useConfigEdit } from "./config-section";

/** One picture: a preview with Replace and Remove, or the library / upload zone when there is none. */
export function TemplateImageField({
  value,
  onChange,
  onRemove,
}: {
  value: string | undefined;
  onChange: (url: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.image");
  const [replacing, setReplacing] = useState(false);

  if (value && !replacing) {
    return (
      <div className="space-y-2" data-image-field="chosen">
        <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
          {/* eslint-disable-next-line @next/next/no-img-element -- any storage host */}
          <img src={value} alt="" draggable={false} className="max-h-full max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" data-action="image-replace" onClick={() => setReplacing(true)}>
            <RefreshCw aria-hidden className="size-4" />
            {t("replace")}
          </Button>
          <Button type="button" variant="ghost" size="sm" data-action="image-remove" className="text-destructive hover:text-destructive" onClick={onRemove}>
            <Trash2 aria-hidden className="size-4" />
            {t("remove")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-image-field="empty">
      <MediaUploader
        value={[]}
        onChange={(next) => {
          const url = next[0]?.url;
          if (!url) return;
          onChange(url);
          setReplacing(false);
        }}
        maxFiles={1}
        acceptTypes={["image"]}
        allowMediaLibrary
        uploadTitle={t("choose")}
        showCoverBadge={false}
        coverHint={false}
        hideUploadZoneWhenFull
      />
      {replacing && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(false)}>
          {t("cancel")}
        </Button>
      )}
    </div>
  );
}

export function ImageConfig({ element }: { element: TemplateElementOf<"image"> }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.image");
  const { set, edit } = useConfigEdit<"image">(element);
  const { source, src, fit, nameWhenNoLogo } = element.config;

  return (
    <ConfigSection element={element}>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t("source")}</p>
        <Segmented
          label={t("source")}
          field="config.source"
          value={source}
          options={(["storeLogo", "media"] as const).map((value) => ({ value, label: t(`sources.${value}`) }))}
          onChange={(next) => set({ source: next })}
        />
      </div>
      {source === "storeLogo" ? (
        <>
          <p className="flex items-start gap-2 text-xs text-muted-foreground" data-image-hint="logo">
            <ImageIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t(nameWhenNoLogo ? "logoHintName" : "logoHint")}
          </p>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t("nameWhenNoLogo")}</span>
            <Switch
              data-field="config.nameWhenNoLogo"
              checked={Boolean(nameWhenNoLogo)}
              onCheckedChange={(next) => (next ? set({ nameWhenNoLogo: true }) : edit((each) => withoutConfigKey(each, "nameWhenNoLogo")))}
              aria-label={t("nameWhenNoLogo")}
            />
          </label>
        </>
      ) : (
        <TemplateImageField value={src} onChange={(url) => set({ src: url })} onRemove={() => edit((each) => withoutConfigKey(each, "src"))} />
      )}
      <Field label={t("fit")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="config.fit"
            value={fit}
            options={(["contain", "cover", "stretch"] as const).map((value) => ({ value, label: t(`fits.${value}`) }))}
            onChange={(next) => set({ fit: next })}
          />
        )}
      </Field>
    </ConfigSection>
  );
}
