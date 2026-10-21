"use client";

import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { MediaUploader } from "@/components/ui/media-uploader";

/**
 * One image for a Campaign Banner. The shared uploader holds a list of media;
 * a banner holds a single URL, so this is the seam between the two. The
 * uploader is the sliders' one, so a vendor's uploads land in their own
 * folder and the library shows only theirs.
 *
 * The uploader draws a picked image as a product-gallery tile: a small square
 * with a select box, a drag handle and a delete cross that only appear on
 * hover and crowd each other at that size. A banner has one picture, so once
 * there is one it is drawn here instead: a large preview with its size in
 * pixels and plain "Replace" and "Remove" buttons. The uploader is used for
 * what it is good at, picking or uploading a file; "Replace" brings it back
 * while the current picture stays until a new one arrives.
 */
export function CampaignBannerImageField({
  value,
  onChange,
  disabled,
  title,
  description,
}: {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  title: string;
  description?: string;
}) {
  const t = useTranslations("admin.campaignBanners.form.upload");
  const [replacing, setReplacing] = useState(false);
  // The picture's own size, remembered with the address it was read from so a
  // new picture never shows the old one's numbers.
  const [measured, setMeasured] = useState<{ url: string; width: number; height: number } | null>(null);

  if (value && !replacing) {
    return (
      <div className="space-y-2">
        <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
          {/* eslint-disable-next-line @next/next/no-img-element -- any storage host, and the natural size is measured */}
          <img
            src={value}
            alt=""
            draggable={false}
            className="max-h-full max-w-full"
            onLoad={(event) =>
              setMeasured({
                url: value,
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        </div>
        {measured?.url === value ? (
          <p className="text-xs tabular-nums text-muted-foreground">
            {measured.width} × {measured.height} px
          </p>
        ) : null}
        {!disabled ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setReplacing(true)}>
              <RefreshCw />
              {t("replace")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onChange("")}
            >
              <Trash2 />
              {t("remove")}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
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
        disabled={disabled}
        uploadTitle={title}
        uploadDescription={description}
        showCoverBadge={false}
        coverHint={false}
        hideUploadZoneWhenFull
      />
      {replacing ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(false)}>
          {t("cancel")}
        </Button>
      ) : null}
    </div>
  );
}
